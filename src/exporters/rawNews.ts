/**
 * Núcleo de la exportación RAW de noticias a 01_Noticias_Raw.
 *
 * La orquestación recibe sus dependencias (lectura, escritura, marcado) por
 * inyección, para poder probarla sin tocar Supabase ni Google Sheets. El script
 * `export-raw-news` cablea las dependencias reales.
 *
 * Garantías:
 *   - En modo dry-run NO escribe en Sheets NI marca como exportado.
 *   - Solo marca como exportado DESPUÉS de una escritura exitosa (si append
 *     falla, no se marca y el error se propaga).
 */
import type { OutRow } from '../sheets/write.js';
import type { NoticiaRawRow } from '../types/noticia.js';
import { noticiaToOutputRow } from './sheetRows.js';

export interface ExportRawOpts {
  limit?: number;
  since?: string;
  onlyNew: boolean;
  dryRun: boolean;
}

export interface ExportRawDeps {
  fetchNoticias: (opts: { limit?: number; since?: string; onlyNew: boolean }) => Promise<NoticiaRawRow[]>;
  appendRows: (rows: OutRow[]) => Promise<number>;
  markExportadas: (ids: string[]) => Promise<void>;
}

export interface ExportRawResult {
  leidas: number;
  escritas: number;
  marcadas: number;
  dryRun: boolean;
  noticias: NoticiaRawRow[];
}

export async function exportRawNews(
  deps: ExportRawDeps,
  opts: ExportRawOpts,
): Promise<ExportRawResult> {
  const noticias = await deps.fetchNoticias({
    limit: opts.limit,
    since: opts.since,
    onlyNew: opts.onlyNew,
  });

  if (opts.dryRun) {
    return { leidas: noticias.length, escritas: 0, marcadas: 0, dryRun: true, noticias };
  }
  if (noticias.length === 0) {
    return { leidas: 0, escritas: 0, marcadas: 0, dryRun: false, noticias };
  }

  const rows = noticias.map(noticiaToOutputRow);
  // Si la escritura falla, lanza aquí y NUNCA marcamos como exportado.
  const escritas = await deps.appendRows(rows);

  const ids = noticias.map((n) => n.noticia_id);
  await deps.markExportadas(ids);

  return { leidas: noticias.length, escritas, marcadas: ids.length, dryRun: false, noticias };
}
