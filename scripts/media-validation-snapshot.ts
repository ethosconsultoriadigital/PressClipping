/**
 * Media Validation & Certification — FASE 1C — Collector fino: BEFORE/AFTER
 * snapshot CLI (HARDENING FINAL: identidad de contexto + ventana anclada).
 *
 * Adaptador delgado alrededor de `buildNewsLakeSnapshot()`
 * (`src/mediaValidation/newsLakeSnapshot.ts`): SOLO LECTURA de `noticias`,
 * NO ejecuta crawl/enrich, NO escribe en Supabase/Sheets.
 *
 * Uso (flujo recomendado, con identidad de contexto + ventana anclada):
 *   npm run media-validation:snapshot -- \
 *     --context-id=VAL-20260907-001 --role=before \
 *     --medio-ids=MED-0001,MED-0002 --window-days=30 \
 *     --window-anchor=2026-09-07T22:00:00.000Z --out=data/before.json
 *
 *   ... ejecutar crawl/enrich externamente y de forma controlada ...
 *
 *   npm run media-validation:snapshot -- \
 *     --context-id=VAL-20260907-001 --role=after \
 *     --medio-ids=MED-0001,MED-0002 --window-days=30 \
 *     --window-anchor=2026-09-07T22:00:00.000Z --out=data/after.json
 *
 * IMPORTANTE: `--context-id`, `--medio-ids` (mismo conjunto), `--window-days`
 * y `--window-anchor` deben ser IDÉNTICOS entre el snapshot "before" y el
 * "after" — de lo contrario `checkRunContextIdentity()` marcará MISMATCH al
 * componer la evidencia final, y `persistence.status` nunca podrá ser
 * `'VERIFIED'` (B5C).
 *
 * `--window-anchor` es OBLIGATORIO si se usa `--window-days` — nunca se
 * deriva de `Date.now()` (B1C). Nunca se infiere `--role` del nombre del
 * archivo de salida: siempre debe declararse explícitamente (§22-23).
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildNewsLakeSnapshot, createSupabaseFetchNoticiasPage, type SnapshotRole } from '../src/mediaValidation/newsLakeSnapshot.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

export interface SnapshotCliArgs {
  contextId: string | null;
  role: SnapshotRole | null;
  medioIds: string[];
  windowDays: number | null;
  windowAnchor: string | null;
  out: string | null;
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseRole(v: string): SnapshotRole | null {
  const norm = v.trim().toUpperCase();
  return norm === 'BEFORE' || norm === 'AFTER' ? (norm as SnapshotRole) : null;
}

export function parseArgs(argv: string[]): SnapshotCliArgs {
  const out: SnapshotCliArgs = {
    contextId: null,
    role: null,
    medioIds: [],
    windowDays: null,
    windowAnchor: null,
    out: null,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'context-id': out.contextId = val; break;
      case 'role': out.role = parseRole(val); break;
      case 'medio-ids': out.medioIds = splitList(val); break;
      case 'window-days': out.windowDays = parseIntOrNull(val); break;
      case 'window-anchor': out.windowAnchor = val; break;
      case 'out': out.out = val; break;
      default: logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.contextId || args.contextId.trim().length === 0) {
    logger.error({}, 'Falta --context-id=<valor> (requerido — identidad explícita del intento de validación, B4C).');
    process.exit(1);
  }
  if (!args.role) {
    logger.error({}, "Falta --role=before|after (requerido — nunca se infiere del nombre del archivo, §22-23).");
    process.exit(1);
  }
  if (args.medioIds.length === 0) {
    logger.error({}, 'Falta --medio-ids=MED-0001,MED-0002,... (requerido — no se deriva del cron ni de un universo desconocido, §11).');
    process.exit(1);
  }
  if (args.windowDays !== null && !args.windowAnchor) {
    logger.error({}, 'Falta --window-anchor (requerido cuando --window-days está activo — nunca se deriva de Date.now(), B1C).');
    process.exit(1);
  }

  logger.info(
    {
      context_id: args.contextId,
      role: args.role,
      medio_ids: args.medioIds,
      window_days: args.windowDays,
      window_anchor: args.windowAnchor,
    },
    '=== Media Validation Snapshot (Fase 1C, SOLO LECTURA) ===',
  );

  const snapshot = await buildNewsLakeSnapshot({
    contextId: args.contextId,
    snapshotRole: args.role,
    mediaIds: args.medioIds,
    windowDays: args.windowDays,
    windowAnchor: args.windowAnchor,
    fetchPage: createSupabaseFetchNoticiasPage(),
  });

  const porEstado: Record<string, number> = {};
  const porConsistencia: Record<string, number> = {};
  for (const m of snapshot.media) {
    porEstado[m.status] = (porEstado[m.status] ?? 0) + 1;
    porConsistencia[m.consistency] = (porConsistencia[m.consistency] ?? 0) + 1;
  }
  logger.info(
    { requested: snapshot.requested_media_ids.length, por_estado: porEstado, por_consistencia: porConsistencia },
    'Snapshot completado',
  );

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(snapshot, null, 2));
    logger.info({ archivo: args.out }, 'Snapshot escrito a disco');
  } else {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
  }

  // Exit semantics (§36): el artifact SIEMPRE se conserva (ya se escribió
  // arriba); el código de salida solo señala si hubo algo no-COMPLETE para
  // que un pipeline/operador lo detecte sin tener que re-parsear el JSON.
  const hayError = snapshot.media.some((m) => m.status === 'ERROR');
  const hayParcial = snapshot.media.some((m) => m.status === 'PARTIAL');
  if (hayError || hayParcial) {
    logger.warn(
      { hay_error: hayError, hay_parcial: hayParcial },
      'Al menos un medio_id no quedó en status=COMPLETE — exit code non-zero (artifact conservado igualmente).',
    );
    process.exitCode = 1;
  }

  logger.info({}, '=== Fin — SOLO LECTURA, nada modificado en Supabase ===');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en media-validation-snapshot');
    process.exit(1);
  });
}

export { main };
