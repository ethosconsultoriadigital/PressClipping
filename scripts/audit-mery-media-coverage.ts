/**
 * Auditoría de cobertura de medios para CLI-MERY-TEST (Mery Pozos).
 *
 * Lee las menciones de Mery Pozos (30d y 90d) y las contrasta contra el
 * catálogo de 200 medios de Supabase. Reporta: qué medios mencionaron a la
 * diputada, si están en el catálogo, si tienen cron activo y cuál es la calidad
 * de extracción. Read-only — no escribe nada en Supabase ni en Sheets.
 *
 * Uso:
 *   npm run audit-mery-media-coverage
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';

const CLI_ID = 'CLI-MERY-TEST';

const MEDIOS_PRIORITARIOS = [
  'Milenio',
  'Político MX',
  'El Informador',
  'Telediario Monterrey',
  'El Heraldo de México',
];

interface MedioStats {
  medio_nombre: string;
  medio_id: string | null;
  conteo_menciones_30d: number;
  conteo_menciones_90d: number;
  esta_en_catalogo: boolean;
  activo: boolean | null;
  en_cron_daily_validated: boolean | null;
  metodo_extraccion: string | null;
  estado_fuente: string | null;
  ultimo_crawl: string | null;
  texto_limpio_ok: boolean | null;
  accion_recomendada: string;
}

async function main() {
  const sb = getSupabase();
  const ahora = Date.now();
  const iso30d = new Date(ahora - 30 * 24 * 60 * 60 * 1000).toISOString();
  const iso90d = new Date(ahora - 90 * 24 * 60 * 60 * 1000).toISOString();

  logger.info({ cli: CLI_ID }, '=== Auditoría de cobertura de medios CLI-MERY-TEST ===');

  // ── Menciones 30d ──────────────────────────────────────────────────────────
  const { data: raw30, error: err30 } = await sb
    .from('menciones')
    .select(`noticia_id, noticias!inner(url_original, medios!inner(medio_id, nombre_medio))`)
    .eq('cliente_id', CLI_ID)
    .gte('created_at', iso30d)
    .limit(2000);

  if (err30) { logger.error({ error: err30.message }, 'Error leyendo menciones 30d'); process.exit(1); }

  // ── Menciones 90d ──────────────────────────────────────────────────────────
  const { data: raw90, error: err90 } = await sb
    .from('menciones')
    .select(`noticia_id, noticias!inner(url_original, medios!inner(medio_id, nombre_medio))`)
    .eq('cliente_id', CLI_ID)
    .gte('created_at', iso90d)
    .limit(2000);

  if (err90) { logger.error({ error: err90.message }, 'Error leyendo menciones 90d'); process.exit(1); }

  // ── Agrupar por noticia_id para evitar doble conteo por keywords múltiples ─
  const noticias30 = new Map<string, { medio_id: string; nombre_medio: string }>();
  for (const m of (raw30 ?? []) as any[]) {
    if (!noticias30.has(m.noticia_id)) {
      noticias30.set(m.noticia_id, {
        medio_id: m.noticias?.medios?.medio_id ?? '',
        nombre_medio: m.noticias?.medios?.nombre_medio ?? '',
      });
    }
  }

  const noticias90 = new Map<string, { medio_id: string; nombre_medio: string }>();
  for (const m of (raw90 ?? []) as any[]) {
    if (!noticias90.has(m.noticia_id)) {
      noticias90.set(m.noticia_id, {
        medio_id: m.noticias?.medios?.medio_id ?? '',
        nombre_medio: m.noticias?.medios?.nombre_medio ?? '',
      });
    }
  }

  // ── Conteo de artículos distintos por medio ────────────────────────────────
  const conteo30 = new Map<string, { medio_id: string; count: number }>();
  for (const v of noticias30.values()) {
    const key = v.nombre_medio || v.medio_id;
    const e = conteo30.get(key) ?? { medio_id: v.medio_id, count: 0 };
    e.count++;
    conteo30.set(key, e);
  }

  const conteo90 = new Map<string, { medio_id: string; count: number }>();
  for (const v of noticias90.values()) {
    const key = v.nombre_medio || v.medio_id;
    const e = conteo90.get(key) ?? { medio_id: v.medio_id, count: 0 };
    e.count++;
    conteo90.set(key, e);
  }

  const mediosEncontrados = new Set([...conteo30.keys(), ...conteo90.keys()]);
  const medioIds = new Set<string>();
  for (const m of [...conteo30.values(), ...conteo90.values()]) {
    if (m.medio_id) medioIds.add(m.medio_id);
  }

  logger.info(
    { articulos_distintos_30d: noticias30.size, articulos_distintos_90d: noticias90.size, medios_detectados: mediosEncontrados.size },
    'Dedupe por noticia_id completada',
  );

  // ── Catálogo de medios de Supabase ─────────────────────────────────────────
  const { data: catalogo, error: errCat } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, activo, metodo_extraccion, estado_fuente, ultimo_crawl, en_cron_daily_validated, texto_limpio_ok')
    .order('medio_id');

  if (errCat) { logger.error({ error: errCat.message }, 'Error leyendo catálogo medios'); process.exit(1); }

  const catalogoMap = new Map<string, any>();
  for (const m of (catalogo ?? []) as any[]) {
    catalogoMap.set(m.nombre_medio?.toLowerCase()?.trim() ?? '', m);
    catalogoMap.set(m.medio_id ?? '', m);
  }

  // ── Construir reporte ──────────────────────────────────────────────────────
  const reporte: MedioStats[] = [];

  for (const nombreMedio of mediosEncontrados) {
    const c30 = conteo30.get(nombreMedio);
    const c90 = conteo90.get(nombreMedio);
    const medio_id = c30?.medio_id || c90?.medio_id || '';

    const catalogoEntry =
      catalogoMap.get(nombreMedio.toLowerCase().trim()) ??
      catalogoMap.get(medio_id) ??
      null;

    const esta_en_catalogo = catalogoEntry != null;
    const activo: boolean | null = esta_en_catalogo ? (catalogoEntry.activo ?? null) : null;
    const en_cron = esta_en_catalogo ? (catalogoEntry.en_cron_daily_validated ?? null) : null;
    const metodo = esta_en_catalogo ? (catalogoEntry.metodo_extraccion ?? null) : null;
    const estado = esta_en_catalogo ? (catalogoEntry.estado_fuente ?? null) : null;
    const crawl = esta_en_catalogo ? (catalogoEntry.ultimo_crawl ?? null) : null;
    const texto_ok = esta_en_catalogo ? (catalogoEntry.texto_limpio_ok ?? null) : null;

    let accion: string;
    if (!esta_en_catalogo) {
      accion = 'GAP — medio no está en catálogo de 200 medios, agregar';
    } else if (!activo) {
      accion = 'INACTIVO — medio en catálogo pero marcado inactivo, revisar';
    } else if (!en_cron) {
      accion = 'SIN_CRON — medio activo pero fuera de daily-validated, evaluar inclusión';
    } else if (texto_ok === false) {
      accion = 'CALIDAD — en cron pero texto_limpio_ok=false, revisar extractor';
    } else {
      accion = 'OK — medio activo en cron con texto limpio';
    }

    reporte.push({
      medio_nombre: nombreMedio,
      medio_id: medio_id || null,
      conteo_menciones_30d: c30?.count ?? 0,
      conteo_menciones_90d: c90?.count ?? 0,
      esta_en_catalogo,
      activo,
      en_cron_daily_validated: en_cron,
      metodo_extraccion: metodo,
      estado_fuente: estado,
      ultimo_crawl: crawl,
      texto_limpio_ok: texto_ok,
      accion_recomendada: accion,
    });
  }

  reporte.sort((a, b) => b.conteo_menciones_30d - a.conteo_menciones_30d);

  // ── Salida ─────────────────────────────────────────────────────────────────
  logger.info({ total_medios_con_menciones: reporte.length }, '── Reporte de cobertura ──');

  for (const r of reporte) {
    logger.info(r, `[medio] ${r.medio_nombre}`);
  }

  // ── Medios prioritarios: verificación especial ─────────────────────────────
  logger.info({}, '── Verificación medios prioritarios ──');
  for (const nombre of MEDIOS_PRIORITARIOS) {
    const encontrado = reporte.find(
      (r) => r.medio_nombre.toLowerCase().includes(nombre.toLowerCase()),
    );
    if (encontrado) {
      logger.info(
        {
          medio: encontrado.medio_nombre,
          menciones_30d: encontrado.conteo_menciones_30d,
          menciones_90d: encontrado.conteo_menciones_90d,
          en_catalogo: encontrado.esta_en_catalogo,
          activo: encontrado.activo,
          en_cron: encontrado.en_cron_daily_validated,
          texto_ok: encontrado.texto_limpio_ok,
          accion: encontrado.accion_recomendada,
        },
        `[prioritario] ${nombre}`,
      );
    } else {
      logger.warn({ nombre_buscado: nombre }, `[GAP PRIORITARIO] No encontrado en menciones — medio sin cobertura en ventana`);
    }
  }

  // ── Resumen ejecutivo ──────────────────────────────────────────────────────
  const ok = reporte.filter((r) => r.accion_recomendada.startsWith('OK')).length;
  const gaps = reporte.filter((r) => r.accion_recomendada.startsWith('GAP')).length;
  const sin_cron = reporte.filter((r) => r.accion_recomendada.startsWith('SIN_CRON')).length;
  const inactivos = reporte.filter((r) => r.accion_recomendada.startsWith('INACTIVO')).length;
  const calidad = reporte.filter((r) => r.accion_recomendada.startsWith('CALIDAD')).length;

  logger.info(
    {
      total: reporte.length,
      ok, gaps, sin_cron, inactivos, calidad,
      total_catalogo: (catalogo ?? []).length,
    },
    '=== Auditoría completada — read-only, sin cambios en Supabase ni Sheets ===',
  );
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { main };
export type { MedioStats };
