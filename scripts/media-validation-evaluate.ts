/**
 * Media Validation & Certification — FASE 1E — Shadow Validator CLI.
 *
 * Adaptador delgado: consume un `RunValidationEvidence` (Fase 1C) y,
 * opcionalmente, un `CalibrationProfile` (Fase 1E, `media-validation-calibrate.ts`
 * + aprobación humana posterior), y produce `ShadowValidationReport[]`
 * REPORT-ONLY por `medio_id`. NUNCA promueve, NUNCA escribe Supabase/Sheets/
 * cron, NUNCA envía alertas (§33/§62 del prompt).
 *
 * Sin `--profile`, el resultado es `evaluation_status='CALIBRATION_REQUIRED'`
 * para todos los medios — comportamiento CORRECTO cuando aún no existe
 * calibración aprobada (§59: "ENGINE READY + CALIBRATION RUN REQUIRED").
 *
 * Uso:
 *   npm run media-validation:evaluate -- \
 *     --evidence=data/run-validation-evidence.json \
 *     --profile=data/calibration-profile-APPROVED.json \
 *     --out=data/shadow-validation-report.json
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeQualityMetricsForRun } from '../src/mediaValidation/qualityMetrics.js';
import type { RunValidationEvidence } from '../src/mediaValidation/runValidationEvidence.js';
import type { CalibrationProfile } from '../src/mediaValidation/calibration.js';
import { evaluateRun } from '../src/mediaValidation/shadowValidator.js';
import {
  validateRunValidationEvidenceEnvelope,
  validateCalibrationProfile,
  validateShadowValidationReport,
} from '../src/mediaValidation/calibrationSchemas.js';
import { logger } from '../src/utils/logger.js';

export interface EvaluateCliArgs {
  evidence: string | null;
  profile: string | null;
  out: string | null;
}

export function parseArgs(argv: string[]): EvaluateCliArgs {
  const out: EvaluateCliArgs = { evidence: null, profile: null, out: null };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'evidence':
        out.evidence = val;
        break;
      case 'profile':
        out.profile = val;
        break;
      case 'out':
        out.out = val;
        break;
      default:
        logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.evidence) {
    logger.error({}, 'Requerido: --evidence=<archivo.json> (RunValidationEvidence de Fase 1C).');
    process.exit(1);
  }

  let evidence: RunValidationEvidence;
  try {
    const raw = JSON.parse(readFileSync(args.evidence, 'utf-8'));
    validateRunValidationEvidenceEnvelope(raw); // envelope mínimo — ver JSDoc de calibrationSchemas.ts
    evidence = raw as RunValidationEvidence;
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'RunValidationEvidence inválido — ABORTADO.');
    process.exit(1);
  }

  let profile: CalibrationProfile | null = null;
  if (args.profile) {
    try {
      profile = validateCalibrationProfile(JSON.parse(readFileSync(args.profile, 'utf-8'))) as CalibrationProfile;
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'CalibrationProfile inválido — ABORTADO.');
      process.exit(1);
    }
    if (profile.status === 'DRAFT') {
      logger.warn(
        { calibration_id: profile.calibration_id },
        "profile status='DRAFT' — ningún medio puede recibir recommendation='ELIGIBLE_FOR_PROMOTION' en esta corrida (§30/§58/AH).",
      );
    }
  } else {
    logger.warn({}, 'Sin --profile: todos los medios quedarán evaluation_status=CALIBRATION_REQUIRED (§59, comportamiento correcto).');
  }

  const metrics = computeQualityMetricsForRun(evidence);
  const reports = evaluateRun(metrics, profile);

  // Self-check (defensivo, §74): cada report se valida contra su propio
  // contrato antes de escribirse.
  for (const r of reports) validateShadowValidationReport(r);

  const byResult: Record<string, number> = {};
  for (const r of reports) {
    const key = r.validation_result ?? 'null';
    byResult[key] = (byResult[key] ?? 0) + 1;
  }
  logger.info(
    { context_id: evidence.context.context_id, total_medios: reports.length, por_resultado: byResult },
    'Shadow Validation completada (REPORT-ONLY — ninguna promoción real, §33/§62).',
  );

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(reports, null, 2));
    logger.info({ archivo: args.out }, 'ShadowValidationReport[] escrito a disco.');
  } else {
    process.stdout.write(JSON.stringify(reports, null, 2) + '\n');
  }

  // Exit semantics: útil para que un pipeline detecte sin re-parsear JSON
  // que hubo al menos un FAIL con evidencia suficiente, o que no hubo
  // ninguna calibración disponible (CALIBRATION_REQUIRED generalizado).
  const anyFail = reports.some((r) => r.validation_result === 'FAIL');
  const allCalibrationRequired = reports.length > 0 && reports.every((r) => r.evaluation_status === 'CALIBRATION_REQUIRED');
  if (anyFail || allCalibrationRequired) {
    process.exitCode = 1;
  }
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en media-validation-evaluate');
    process.exit(1);
  });
}

export { main };
