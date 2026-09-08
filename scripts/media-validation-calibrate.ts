/**
 * Media Validation & Certification — FASE 1D/1E — Calibration CLI.
 *
 * Adaptador delgado: consume artifacts ya generados por fuera de este
 * script (NUNCA ejecuta Supabase/crawl/enrich/auditor legacy):
 *
 *   - uno o más `RunValidationEvidence` (Fase 1C, `media-validation-compose.ts`);
 *   - un `ReferenceLabelManifest` curado a mano (§17-19 del prompt).
 *
 * Produce, en memoria y por escrito, `CalibrationReport` + `CalibrationProfile`
 * (SIEMPRE `status='DRAFT'`, `rules=[]` — §27/§30/§58: NUNCA se auto-aprueba
 * ni se auto-eligen thresholds operativos). Aprobar un profile (rellenar
 * `rules` y cambiar `status` a `APPROVED`) es SIEMPRE una acción humana
 * posterior fuera de este script.
 *
 * Uso:
 *   npm run media-validation:calibrate -- \
 *     --evidence=data/rve-context-A.json,data/rve-context-B.json \
 *     --labels=data/reference-labels.json \
 *     --calibration-id=CAL-20260908-001 \
 *     --out=data/calibration-CAL-20260908-001.json
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeQualityMetricsForRun, type MediaQualityMetrics } from '../src/mediaValidation/qualityMetrics.js';
import type { RunValidationEvidence } from '../src/mediaValidation/runValidationEvidence.js';
import {
  buildCalibrationReport,
  buildDraftCalibrationProfile,
  type LabeledObservation,
} from '../src/mediaValidation/calibration.js';
import { resolveReferenceLabelManifest } from '../src/mediaValidation/referenceLabels.js';
import {
  validateReferenceLabelManifest,
  validateRunValidationEvidenceEnvelope,
  validateCalibrationReport,
  validateCalibrationProfile,
} from '../src/mediaValidation/calibrationSchemas.js';
import { logger } from '../src/utils/logger.js';

export interface CalibrateCliArgs {
  evidence: string[];
  labels: string | null;
  calibrationId: string | null;
  out: string | null;
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseArgs(argv: string[]): CalibrateCliArgs {
  const out: CalibrateCliArgs = { evidence: [], labels: null, calibrationId: null, out: null };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'evidence':
        out.evidence = splitList(val);
        break;
      case 'labels':
        out.labels = val;
        break;
      case 'calibration-id':
        out.calibrationId = val;
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

/**
 * Carga y valida (envelope mínimo, §74) un `RunValidationEvidence` desde
 * disco. Lanza si el artifact es inválido — NUNCA devuelve un objeto
 * parcialmente construido.
 */
function loadRunValidationEvidence(path: string): RunValidationEvidence {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  validateRunValidationEvidenceEnvelope(raw); // lanza si el envelope es inválido; el contrato completo de 1B/1C no se vuelve a espejar (ver JSDoc de calibrationSchemas.ts)
  return raw as RunValidationEvidence;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.evidence.length === 0) {
    logger.error({}, 'Requerido: --evidence=<archivo1.json>[,archivo2.json,...] (uno o más RunValidationEvidence de Fase 1C).');
    process.exit(1);
  }
  if (!args.labels) {
    logger.error({}, 'Requerido: --labels=<archivo.json> (ReferenceLabelManifest curado a mano — nunca se infiere del auditor legacy).');
    process.exit(1);
  }
  if (!args.calibrationId || args.calibrationId.trim().length === 0) {
    logger.error({}, 'Requerido: --calibration-id=<valor> (identidad explícita de esta calibración — §48).');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = validateReferenceLabelManifest(JSON.parse(readFileSync(args.labels, 'utf-8')));
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'ReferenceLabelManifest inválido — ABORTADO.');
    process.exit(1);
  }

  const resolution = resolveReferenceLabelManifest(manifest);
  if (resolution.rejected.length > 0) {
    logger.warn(
      { rejected: resolution.rejected },
      `${resolution.rejected.length} medio_id con labels CONTRADICTORIOS en el manifest — excluidos de la calibración (§20).`,
    );
  }
  if (resolution.deduplicated_medio_ids.length > 0) {
    logger.info(
      { medio_ids: resolution.deduplicated_medio_ids },
      `${resolution.deduplicated_medio_ids.length} medio_id con entradas duplicadas pero label idéntico — deduplicados de forma determinista.`,
    );
  }
  const labelByMedio = new Map(resolution.resolved.map((r) => [r.medio_id, r.label]));

  const allMetrics: { evidence: RunValidationEvidence; metrics: MediaQualityMetrics[] }[] = [];
  for (const file of args.evidence) {
    let evidence: RunValidationEvidence;
    try {
      evidence = loadRunValidationEvidence(file);
    } catch (err) {
      logger.error({ file, error: err instanceof Error ? err.message : String(err) }, 'RunValidationEvidence inválido — ABORTADO.');
      process.exit(1);
    }
    allMetrics.push({ evidence, metrics: computeQualityMetricsForRun(evidence) });
  }

  const observations: LabeledObservation[] = [];
  const seenMedioIds = new Set<string>();
  for (const { metrics } of allMetrics) {
    for (const m of metrics) {
      const label = labelByMedio.get(m.medio_id);
      if (label === undefined) continue; // sin label de referencia: no participa en la calibración (no es un error).
      seenMedioIds.add(m.medio_id);
      observations.push({ medio_id: m.medio_id, context_id: m.context_id, label, label_source: manifest.label_source, metrics: m });
    }
  }

  const labeledButUnobserved = [...labelByMedio.keys()].filter((id) => !seenMedioIds.has(id));
  if (labeledButUnobserved.length > 0) {
    logger.warn(
      { medio_ids: labeledButUnobserved },
      `${labeledButUnobserved.length} medio_id tienen label de referencia pero no aparecen en ningún --evidence provisto — excluidos (sin métrica que asociar).`,
    );
  }

  let report;
  try {
    // Hardening B3DE: `buildCalibrationReport` rechaza (nunca dedupe en
    // silencio) identidades de observación (context_id, medio_id)
    // duplicadas — p.ej. el mismo --evidence pasado dos veces.
    report = buildCalibrationReport(observations, { calibrationId: args.calibrationId });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Observaciones de calibración inválidas — ABORTADO (Hardening B3DE).');
    process.exit(1);
  }
  const profile = buildDraftCalibrationProfile(report, { calibrationId: args.calibrationId });

  // Self-check (defensivo, §74): un bug de construcción debe fallar aquí, nunca escribirse a disco silenciosamente.
  validateCalibrationReport(report);
  validateCalibrationProfile(profile);

  logger.info(
    {
      calibration_id: args.calibrationId,
      number_of_media: report.input_summary.number_of_media,
      number_of_observations: report.input_summary.number_of_observations,
      class_balance: report.class_balance,
    },
    'Calibración completada (report + DRAFT profile) — DRAFT NO es autorización operativa (§27/§30).',
  );

  const output = { calibration_report: report, calibration_profile: profile };
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(output, null, 2));
    logger.info({ archivo: args.out }, 'CalibrationReport + DRAFT CalibrationProfile escritos a disco.');
  } else {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  }

  if (report.input_summary.number_of_observations === 0) {
    logger.warn({}, 'CERO observaciones etiquetadas — nada que calibrar todavía (CALIBRATION RUN REQUIRED). Exit code non-zero.');
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
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en media-validation-calibrate');
    process.exit(1);
  });
}

export { main };
