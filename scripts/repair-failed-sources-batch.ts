/**
 * Reparación mínima de fuentes públicas — lote medios fallidos News Lake
 * (rol B, 2026-09-02). SOLO actualiza rss_url / sitemap_url / metodo_extraccion
 * de los medio_id listados. No toca clientes, keywords ni lógica global.
 *
 * Por defecto es --dry: imprime el plan y NO escribe en Supabase.
 * Para aplicar (solo tras autorización por medio): --apply [--only=MED-XXXX]
 *
 * Uso:
 *   npm run repair-failed-sources-batch
 *   npm run repair-failed-sources-batch -- --dry
 *   npm run repair-failed-sources-batch -- --apply --only=MED-0115
 *   npm run repair-failed-sources-batch -- --sync-sheet
 *     (alinea 01_Medios: actualiza las 11 filas; si falta una clave, la agrega
 *      desde Supabase. No toca keywords/clientes ni otras pestañas)
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { getTab, withSheetsRetry, SHEET_TABS } from '../src/sheets/client.js';
import { appendRows, type OutRow } from '../src/sheets/write.js';
import { planMergeByKey, type MergeUpdate } from '../src/sheets/mergePlan.js';
import { normalizeHeader } from '../src/utils/parse.js';

export type MetodoReparacion = 'RSS' | 'SITEMAP';

export interface RepairPatch {
  medio_id: string;
  nombre_medio: string;
  metodo_extraccion: MetodoReparacion;
  rss_url?: string | null;
  sitemap_url?: string | null;
  motivo: string;
}

/**
 * Fuentes públicas verificadas en vivo 2026-09-02 (probe local, sin proxy).
 * No incluye medios NXDOMAIN / timeout / sin feed.
 */
export const REPAIR_PATCHES: RepairPatch[] = [
  {
    medio_id: 'MED-0103',
    nombre_medio: 'El Peninsular Digital',
    metodo_extraccion: 'SITEMAP',
    sitemap_url: 'https://peninsulardigital.com/post-sitemap100.xml',
    motivo:
      'sitemap.xml no entrega items recientes (índice Yoast empieza por archivo 2010). ' +
      'post-sitemap100.xml tiene 757 URLs, 326 de los últimos 30d, última nota 2026-09-02. ' +
      'Riesgo: Yoast puede abrir post-sitemap101.xml más adelante.',
  },
  {
    medio_id: 'MED-0105',
    nombre_medio: 'Radar Político BCS',
    metodo_extraccion: 'SITEMAP',
    sitemap_url: 'https://www.radarpolitico.com.mx/wp-sitemap-posts-post-45.xml',
    motivo:
      'sitemap.xml configurado hace fetch failed. wp-sitemap-posts-post-45.xml tiene 1981 URLs, ' +
      '254 recientes, última 2026-08-31. Riesgo: paginación WP (post-46).',
  },
  {
    medio_id: 'MED-0099',
    nombre_medio: 'BCS Noticias',
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.bcsnoticias.mx/feed/',
    motivo:
      'sitemap.xml devolvió HTTP 415 en oleada (WAF). /feed/ responde RSS WordPress con 30/30 notas recientes.',
  },
  {
    medio_id: 'MED-0107',
    nombre_medio: 'Diario Humano',
    metodo_extraccion: 'SITEMAP',
    sitemap_url: 'https://diariohumano.com.mx/post-sitemap21.xml',
    motivo:
      'sitemap.xml devolvió HTTP 415 en oleada. post-sitemap21.xml (Yoast) tiene 119/119 notas recientes, última 2026-09-02.',
  },
  {
    medio_id: 'MED-0109',
    nombre_medio: 'Canal 8 BCS',
    metodo_extraccion: 'RSS',
    rss_url: 'https://iert.bcs.gob.mx/feed',
    motivo:
      'metodo HTML sin rss/sitemap: News Lake lo excluye. /feed/ de iert.bcs.gob.mx entrega 10/10 notas recientes (sitio IERT, no solo Canal 8).',
  },
  {
    medio_id: 'MED-0114',
    nombre_medio: 'Radio Universidad de Guadalajara',
    metodo_extraccion: 'RSS',
    rss_url: 'https://udgtv.com/feed/',
    motivo:
      'metodo HTML y url_base /radio-udeg sin feed. El RSS raíz udgtv.com/feed/ entrega 30/30 notas recientes (UDG TV completo, no solo radio).',
  },
  {
    medio_id: 'MED-0115',
    nombre_medio: 'DK 1250',
    metodo_extraccion: 'RSS',
    rss_url: 'https://dk1250.mx/feed',
    motivo: 'sitemap.xml fetch failed. /feed WordPress entrega 12/12 notas del día (2026-09-02).',
  },
  {
    medio_id: 'MED-0126',
    nombre_medio: 'Noticias PV',
    metodo_extraccion: 'RSS',
    rss_url: 'https://noticiaspv.com.mx/feed',
    motivo: 'sitemap.xml 404. /feed WordPress entrega 10/10 notas recientes.',
  },
  {
    medio_id: 'MED-0127',
    nombre_medio: 'Semanario Laguna',
    metodo_extraccion: 'RSS',
    rss_url: 'https://semanariolaguna.com/rss',
    motivo: 'sitemap.xml 404. /rss entrega 50/50 notas recientes.',
  },
  {
    medio_id: 'MED-0191',
    nombre_medio: 'La Silla Rota',
    metodo_extraccion: 'SITEMAP',
    sitemap_url: 'https://lasillarota.com/sitemaps/news.xml',
    motivo:
      'DIRECT no entra a news-lake-capture. sitemaps/news.xml es news-sitemap público con 295/295 notas recientes. ' +
      'El extractor crawl-direct-lasillarota.ts sigue como respaldo; no se borra.',
  },
  {
    medio_id: 'MED-0029',
    nombre_medio: 'La Jornada',
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.jornada.com.mx/rss/edicion.xml',
    motivo:
      'sitemap.xml da 403 intermitente (WAF). /rss/edicion.xml entrega RSS público con 104/104 notas del día (2026-09-02). ' +
      'No se toca Grupo Reforma (Mural/Reforma/El Norte): D_PAGO_CONVENIO_API.',
  },
];

export interface RepairBatchArgs {
  dry: boolean;
  only?: string[];
  syncSheet: boolean;
}

export function parseArgs(argv: string[]): RepairBatchArgs {
  const out: RepairBatchArgs = { dry: true, syncSheet: false };
  for (const arg of argv) {
    if (arg === '--dry') {
      out.dry = true;
      continue;
    }
    if (arg === '--apply' || arg === '--no-dry-run') {
      out.dry = false;
      continue;
    }
    if (arg === '--sync-sheet') {
      out.syncSheet = true;
      continue;
    }
    if (arg.startsWith('--only=')) {
      out.only = arg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    }
  }
  return out;
}

export function seleccionarPatches(args: RepairBatchArgs): RepairPatch[] {
  if (!args.only || args.only.length === 0) return [...REPAIR_PATCHES];
  const set = new Set(args.only);
  return REPAIR_PATCHES.filter((p) => set.has(p.medio_id));
}

/** Celdas de 01_Medios a alinear (nunca keywords/clientes). */
export function camposSheetUpdate(p: RepairPatch): MergeUpdate {
  const update: MergeUpdate = {
    medio_id: p.medio_id,
    metodo_extraccion: p.metodo_extraccion,
    activo: true,
  };
  if (p.metodo_extraccion === 'RSS') update.rss_url = p.rss_url ?? '';
  else update.sitemap_url = p.sitemap_url ?? '';
  return update;
}

const SELECT_MEDIO_SHEET =
  'medio_id, nombre_medio, grupo_medio, url_base, pais, estado, municipio, region, categoria, prioridad, activo, metodo_extraccion, rss_url, sitemap_url, secciones_urls, buscador_url, requiere_javascript, requiere_proxy, frecuencia_minutos, notas_tecnicas';

/** Fila nueva para 01_Medios: catálogo actual en Supabase + patch de fuente. */
export function filaNueva01Medios(
  row: Record<string, unknown>,
  p: RepairPatch,
): OutRow {
  return {
    ...row,
    ...camposSheetUpdate(p),
    notas_tecnicas: `Repair batch 2026-09-02: ${p.motivo}`,
  };
}

export async function sync01Medios(patches: RepairPatch[], dry: boolean): Promise<{
  filas_actualizadas: number;
  claves_no_encontradas: string[];
  mismatch: boolean;
}> {
  const sheet = await getTab(SHEET_TABS.MEDIOS);
  await withSheetsRetry(() => sheet.loadHeaderRow(), 'loadHeaderRow 01_Medios');
  const headersAntes = [...sheet.headerValues];
  const rows = await withSheetsRetry(() => sheet.getRows(), 'getRows 01_Medios');
  const keyHeader = headersAntes.find((h) => normalizeHeader(h) === 'medio_id');
  if (!keyHeader) throw new Error('01_Medios no tiene columna medio_id');
  const claves = rows.map((r) => String(r.get(keyHeader) ?? '').trim());
  const updates = patches.map(camposSheetUpdate);
  const plan = planMergeByKey(headersAntes, 'medio_id', updates, claves, []);

  if (plan.columnas_agregadas.length > 0) {
    throw new Error(
      `01_Medios no tiene columnas esperadas: ${plan.columnas_agregadas.join(', ')}. No se agregó nada.`,
    );
  }

  console.log(
    `01_Medios plan: actualizar ${plan.ediciones.length} filas; no encontradas: ${plan.claves_no_encontradas.join(',') || 'ninguna'}`,
  );

  if (dry) {
    console.log('--dry: no se escribió 01_Medios.');
    return {
      filas_actualizadas: 0,
      claves_no_encontradas: plan.claves_no_encontradas,
      mismatch: false,
    };
  }

  const rowByKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = String(r.get(plan.key_header_real) ?? '').trim();
    if (k) rowByKey.set(k, r);
  }
  const rowNumbers = plan.ediciones
    .map((ed) => rowByKey.get(ed.clave)?.rowNumber)
    .filter((n): n is number => typeof n === 'number');
  if (rowNumbers.length > 0) {
    await withSheetsRetry(
      () =>
        sheet.loadCells({
          startRowIndex: Math.min(...rowNumbers) - 1,
          endRowIndex: Math.max(...rowNumbers),
          startColumnIndex: 0,
          endColumnIndex: plan.headers_despues.length,
        }),
      'loadCells 01_Medios',
    );
    for (const ed of plan.ediciones) {
      const r = rowByKey.get(ed.clave);
      if (!r) continue;
      for (const celda of ed.celdas) {
        sheet.getCell(r.rowNumber - 1, celda.col_index).value = celda.value;
      }
    }
    await withSheetsRetry(() => sheet.saveUpdatedCells(), 'saveUpdatedCells 01_Medios');
  }

  let filasAgregadas = 0;
  let pendientes = [...plan.claves_no_encontradas];
  if (pendientes.length > 0) {
    const patchById = new Map(patches.map((p) => [p.medio_id, p]));
    const { data, error } = await getSupabase()
      .from('medios')
      .select(SELECT_MEDIO_SHEET)
      .in('medio_id', pendientes);
    if (error) throw new Error(`No se pudo leer Supabase para altas 01_Medios: ${error.message}`);
    const nuevas: OutRow[] = [];
    for (const row of data ?? []) {
      const p = patchById.get(String(row.medio_id));
      if (!p) continue;
      nuevas.push(filaNueva01Medios(row as Record<string, unknown>, p));
    }
    if (nuevas.length > 0) {
      filasAgregadas = await appendRows(SHEET_TABS.MEDIOS, nuevas);
      console.log(`01_Medios: se agregaron ${filasAgregadas} filas que no estaban (${nuevas.map((n) => n.medio_id).join(', ')})`);
    }
    const agregadas = new Set(nuevas.map((n) => String(n.medio_id)));
    pendientes = pendientes.filter((id) => !agregadas.has(id));
  }

  const sheetRb = await getTab(SHEET_TABS.MEDIOS);
  await withSheetsRetry(() => sheetRb.loadHeaderRow(), 'loadHeaderRow readback 01_Medios');
  const rb = await withSheetsRetry(() => sheetRb.getRows(), 'getRows(readback) 01_Medios');
  const keysRb = new Set(
    rb.map((r) => String(r.get(keyHeader) ?? '').trim()).filter(Boolean),
  );
  const ausentes = patches.map((p) => p.medio_id).filter((id) => !keysRb.has(id));
  return {
    filas_actualizadas: plan.ediciones.length + filasAgregadas,
    claves_no_encontradas: ausentes.length > 0 ? ausentes : pendientes,
    mismatch: ausentes.length > 0,
  };
}

function camposUpdate(p: RepairPatch): Record<string, unknown> {
  const update: Record<string, unknown> = {
    metodo_extraccion: p.metodo_extraccion,
    activo: true,
    ultimo_estado: 'pendiente',
    ultimo_error: null,
    notas_tecnicas: `Repair batch 2026-09-02: ${p.motivo}`,
  };
  if (p.metodo_extraccion === 'RSS') {
    update.rss_url = p.rss_url;
  } else {
    update.sitemap_url = p.sitemap_url;
  }
  return update;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const patches = seleccionarPatches(args);

  if (patches.length === 0) {
    console.log('Ningún patch seleccionado. Nada que hacer.');
    return;
  }

  const sb = getSupabase();
  const ids = patches.map((p) => p.medio_id);
  const { data: antes, error: errAntes } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, metodo_extraccion, rss_url, sitemap_url, activo, ultimo_estado, ultimo_error')
    .in('medio_id', ids);
  if (errAntes) {
    console.error(errAntes.message);
    process.exit(1);
  }

  console.log('=== Estado actual ===');
  console.log(JSON.stringify(antes, null, 2));
  console.log('\n=== Plan de reparación ===');
  for (const p of patches) {
    console.log(
      `${p.medio_id} ${p.nombre_medio} → ${p.metodo_extraccion} ${p.rss_url ?? p.sitemap_url}`,
    );
  }

  if (args.syncSheet) {
    const sheetDry = process.argv.slice(2).includes('--dry');
    const sheetRes = await sync01Medios(patches, sheetDry);
    console.log('01_Medios:', JSON.stringify(sheetRes));
    if (sheetRes.claves_no_encontradas.length > 0 || sheetRes.mismatch) process.exitCode = 1;
    if (!process.argv.slice(2).includes('--apply')) return;
  }

  if (args.dry) {
    console.log(
      `\n--dry (default): no se escribió Supabase. Para DB: --apply. Para Sheet: --sync-sheet (sin --dry).`,
    );
    return;
  }

  let actualizados = 0;
  for (const p of patches) {
    const { error } = await sb.from('medios').update(camposUpdate(p)).eq('medio_id', p.medio_id);
    if (error) {
      console.error(`${p.medio_id}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    actualizados += 1;
    console.log(`Actualizado ${p.medio_id}`);
  }
  console.log(`Update DB: ${actualizados}/${patches.length}`);
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { main, camposUpdate };
