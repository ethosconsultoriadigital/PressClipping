/**
 * Crea/puebla 08_Ruteo_Menciones en el Control Plane.
 * No toca 02_Keywords, 03_Clientes, MASTER ni Fast Lane.
 */
import 'dotenv/config';
import { loadMentionRoutesV1 } from '../src/routing/loadMentionRoutesV1.js';
import {
  ROUTING_HEADERS,
  ROUTING_TAB,
  validateMentionRoutes,
} from '../src/routing/mentionPresentation.js';
import { getSpreadsheet, withSheetsRetry } from '../src/sheets/client.js';
import { ensureTab } from '../src/sheets/ensureTab.js';
import { logger } from '../src/utils/logger.js';

const replace = process.argv.includes('--replace');

async function main() {
  const routes = loadMentionRoutesV1();
  const validation = validateMentionRoutes(routes);
  if (!validation.ok) {
    console.log(JSON.stringify({ ok: false, validation }, null, 2));
    process.exit(1);
  }

  const sheet = await ensureTab(ROUTING_TAB, [...ROUTING_HEADERS]);
  const rows = await withSheetsRetry(() => sheet.getRows(), 'getRows 08_Ruteo_Menciones');
  if (rows.length > 0 && !replace) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'TAB_ALREADY_HAS_ROWS',
        existing: rows.length,
        seed: routes.length,
      }),
    );
    return;
  }
  if (rows.length > 0 && replace) {
    await withSheetsRetry(() => sheet.clear(`A2:H`), 'clear 08 data');
  }

  const payload = routes.map((r) => ({
    route_id: r.route_id,
    keyword_id: r.keyword_id,
    detection_scope_id: r.detection_scope_id,
    vista_tipo: r.vista_tipo,
    vista_nombre: r.vista_nombre,
    activo: r.activo ? 'TRUE' : 'FALSE',
    prioridad: r.prioridad,
    notas: r.notas ?? '',
  }));
  await withSheetsRetry(() => sheet.addRows(payload), 'addRows 08_Ruteo_Menciones');
  logger.info({ count: payload.length }, '08_Ruteo_Menciones poblada');
  console.log(JSON.stringify({ ok: true, written: payload.length, skipped: false }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
