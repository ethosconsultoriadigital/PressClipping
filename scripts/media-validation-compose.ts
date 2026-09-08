/**
 * Media Validation & Certification — FASE 1C — Collector fino: composición
 * final de evidencia (HARDENING FINAL: validación runtime de artifacts +
 * exit semantics operativas).
 *
 * Adaptador delgado que une, desde artefactos ya generados por fuera de
 * este script (NO orquesta crawl/enrich):
 *
 *   - un log de una corrida de News Lake → `aggregateRunEvidence()` (Fase
 *     1B, SIN modificar `runEvidenceAggregator.ts`);
 *   - un snapshot "before" y un snapshot "after" ya capturados con
 *     `scripts/media-validation-snapshot.ts`, AHORA VALIDADOS EN RUNTIME
 *     contra `snapshotResultSchema` (B3C) antes de tocar cualquier lógica
 *     de delta/persistencia — un artifact corrupto, truncado, de otra
 *     versión de schema, o con `snapshot_role` incorrecto NUNCA llega a
 *     `composeRunValidationEvidence`.
 *
 * Uso:
 *   npm run media-validation:compose -- \
 *     --run-log=data/run.log --before=data/before.json --after=data/after.json \
 *     --context-id=VAL-20260907-001 --medio-ids=MED-0001,MED-0002 \
 *     --window-days=30 --window-anchor=2026-09-07T22:00:00.000Z \
 *     --run-id=$GITHUB_RUN_ID --out=data/run-validation-evidence.json
 *
 * EXIT SEMANTICS (§37): este script termina con código distinto de cero si
 * — y solo si — algo impide confiar en la composición (artifact inválido,
 * schema_version incompatible, roles intercambiados, `context_identity` en
 * MISMATCH). El artifact de salida se escribe igualmente cuando la
 * composición pudo calcularse (para diagnóstico), pero el exit code señala
 * el fallo operativo — nunca se imprime "Composición completada" como si
 * fuera un éxito normal en ese caso.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { aggregateRunEvidence } from '../src/mediaValidation/runEvidenceAggregator.js';
import { buildRunContextFromRunEvidence } from '../src/mediaValidation/runContext.js';
import { composeRunValidationEvidence } from '../src/mediaValidation/runValidationEvidence.js';
import { validateSnapshotArtifact } from '../src/mediaValidation/artifactSchemas.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

export interface ComposeCliArgs {
  runLog: string | null;
  before: string | null;
  after: string | null;
  contextId: string | null;
  medioIds: string[] | undefined;
  runId: string | null;
  windowDays: number | null;
  windowAnchor: string | null;
  maxNotas: number | null;
  enrichLimit: number | null;
  out: string | null;
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseArgs(argv: string[]): ComposeCliArgs {
  const out: ComposeCliArgs = {
    runLog: null,
    before: null,
    after: null,
    contextId: null,
    medioIds: undefined,
    runId: null,
    windowDays: null,
    windowAnchor: null,
    maxNotas: null,
    enrichLimit: null,
    out: null,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'run-log': out.runLog = val; break;
      case 'before': out.before = val; break;
      case 'after': out.after = val; break;
      case 'context-id': out.contextId = val; break;
      case 'medio-ids': out.medioIds = splitList(val); break;
      case 'run-id': out.runId = val; break;
      case 'window-days': out.windowDays = parseIntOrNull(val); break;
      case 'window-anchor': out.windowAnchor = val; break;
      case 'max-notas': out.maxNotas = parseIntOrNull(val); break;
      case 'enrich-limit': out.enrichLimit = parseIntOrNull(val); break;
      case 'out': out.out = val; break;
      default: logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.runLog || !args.before || !args.after) {
    logger.error({}, 'Requeridos: --run-log=<archivo> --before=<archivo.json> --after=<archivo.json>');
    process.exit(1);
  }
  if (!args.contextId || args.contextId.trim().length === 0) {
    logger.error({}, 'Falta --context-id=<valor> (requerido — identidad explícita del intento de validación, B4C).');
    process.exit(1);
  }

  // B3C: validación runtime — un artifact inválido lanza aquí y NUNCA llega
  // a aggregateRunEvidence/composeRunValidationEvidence/computeMediaDelta.
  let before, after;
  try {
    before = validateSnapshotArtifact(JSON.parse(readFileSync(args.before, 'utf-8')));
    after = validateSnapshotArtifact(JSON.parse(readFileSync(args.after, 'utf-8')));
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Artifact de snapshot inválido — composición ABORTADA (B3C). No se produce ningún output.',
    );
    process.exit(1);
  }

  // Validación de roles ANTES de componer (§39 — "no inferir"): un swap
  // before/after debe fallar aquí de forma explícita, no dentro del cálculo.
  if (before.snapshot_role !== 'BEFORE') {
    logger.error({ role: before.snapshot_role }, "--before no tiene snapshot_role='BEFORE' — posible swap de artifacts.");
    process.exit(1);
  }
  if (after.snapshot_role !== 'AFTER') {
    logger.error({ role: after.snapshot_role }, "--after no tiene snapshot_role='AFTER' — posible swap de artifacts.");
    process.exit(1);
  }

  const logText = readFileSync(args.runLog, 'utf-8');
  const runEvidence = aggregateRunEvidence({
    logLines: logText,
    runId: args.runId,
    requestedMediaIds: args.medioIds,
  });

  const context = buildRunContextFromRunEvidence(runEvidence, {
    contextId: args.contextId,
    windowAnchor: args.windowAnchor,
    windowDays: args.windowDays,
    maxNotas: args.maxNotas,
    enrichLimit: args.enrichLimit,
  });

  const evidence = composeRunValidationEvidence({ context, runEvidence, before, after });

  const verifiedCount = evidence.media.filter((m) => m.persistence.status === 'VERIFIED').length;
  logger.info(
    {
      context_identity: evidence.context_identity.status,
      medios_compuestos: evidence.media.length,
      medios_verified: verifiedCount,
      warnings: evidence.warnings.length,
    },
    evidence.context_identity.status === 'MATCH'
      ? 'Composición de Run Validation Evidence completada (Fase 1C)'
      : 'Composición completada CON context_identity=MISMATCH — ningún medio puede ser VERIFIED (fallo operativo, B5C)',
  );

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(evidence, null, 2));
    logger.info({ archivo: args.out }, 'Evidencia compuesta escrita a disco (para diagnóstico, incluso si hay MISMATCH)');
  } else {
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  }

  // Exit semantics (§37): MISMATCH de contexto es un fallo operativo, no un
  // resultado normal — el artifact ya se escribió arriba para diagnóstico,
  // pero el exit code debe permitir que un pipeline lo detecte.
  if (evidence.context_identity.status !== 'MATCH') {
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
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en media-validation-compose');
    process.exit(1);
  });
}

export { main };
