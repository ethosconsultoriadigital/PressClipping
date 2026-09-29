/**
 * Control Plane Sync V2 — CLI delgado.
 *
 * Default: DRY-RUN de 03_Clientes + 02_Keywords. Cero writes.
 *
 *   npm run sync-sheets
 *   npm run sync-sheets -- --apply --expected-hash=<CONTROL_PLANE_HASH>
 *
 * No sincroniza 01_Medios ni 04_Configuracion.
 * Ausente en Sheet no borra filas de Supabase.
 */
import { SHEET_TABS } from '../src/sheets/client.js';
import { readTabRows } from '../src/sheets/read.js';
import {
  getAllClientes,
  getAllKeywords,
  upsertClientes,
  upsertKeywords,
} from '../src/supabase/repositories.js';
import {
  formatControlPlaneReport,
  parseControlPlaneArgs,
  runControlPlaneSync,
  type ControlPlaneResult,
} from '../src/sync/controlPlaneSync.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const parsed = parseControlPlaneArgs(process.argv.slice(2));
  if ('error' in parsed) {
    const result: ControlPlaneResult = {
      ok: false,
      verdict:
        parsed.error === 'UNSUPPORTED_IN_CONTROL_PLANE_V2'
          ? 'UNSUPPORTED_IN_CONTROL_PLANE_V2'
          : 'PLAN_ABORTED',
      plan: {
        aborted: true,
        abort_reason: parsed.error,
        mode: 'DRY_RUN',
        invalid_rows: [],
        duplicate_client_ids: [],
        duplicate_keyword_ids: [],
        orphan_keywords: [],
        clientes: {
          sheet: 0,
          db: 0,
          create: [],
          update: [],
          unchanged: [],
          db_only_preserved: [],
          semantic_conflicts: [],
        },
        keywords: {
          sheet: 0,
          db: 0,
          create: [],
          update: [],
          unchanged: [],
          db_only_preserved: [],
          semantic_conflicts: [],
        },
        client_writes: [],
        keyword_writes: [],
        control_plane_hash: '',
        plan_hash: '',
      },
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count: 0,
    };
    console.log(formatControlPlaneReport(result));
    process.exit(1);
  }

  logger.info(
    { mode: parsed.apply ? 'APPLY' : 'DRY_RUN', entities: parsed.entities },
    'Control Plane Sync V2',
  );

  const result = await runControlPlaneSync(parsed, {
    readClientesSheet: () => readTabRows(SHEET_TABS.CLIENTES),
    readKeywordsSheet: () => readTabRows(SHEET_TABS.KEYWORDS),
    loadDbClientes: getAllClientes,
    loadDbKeywords: getAllKeywords,
    writeClientes: upsertClientes,
    writeKeywords: upsertKeywords,
  });

  console.log(formatControlPlaneReport(result));
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  logger.error(err, 'Error fatal en sync-sheets (control plane V2).');
  process.exit(1);
});
