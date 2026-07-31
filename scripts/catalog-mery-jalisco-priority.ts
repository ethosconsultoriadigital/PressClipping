/**
 * Catálogo de medios prioritarios Jalisco/Mery Pozos — lote "MERY JALISCO
 * PRIORITY" (2026-07-29).
 *
 * FASE 1 (ACTIVAR_EN_CRON): Consulta Supabase para encontrar los medio_ids de
 * UDG TV/Canal 44, Notisistema, Tráfico ZMG, Vallarta Independiente y
 * Partidero. Estos ya existen en el catálogo pero no están en ningún cron.
 *
 * FASE 2 (AGREGAR_A_CATALOGO): Inserta 4 medios Jalisco nuevos con IDs
 * MED-0201 a MED-0204 (Semanario Conciencia Pública, A Fondo Jalisco, Siker,
 * Página 24 Jalisco). AFmedios ya existe como MED-0187.
 *
 * Con `--patch-shadowmedia`: actualiza src/config/shadowMedia.ts automáticamente
 * con todos los medios encontrados + nuevos, con un bloque de comentario
 * que documenta el lote.
 *
 * MURAL queda como D_PAGO_CONVENIO_API — NO se toca.
 *
 * Uso:
 *   npm run catalog-mery-jalisco-priority -- --dry-run
 *   npm run catalog-mery-jalisco-priority -- --upsert --patch-shadowmedia
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import type { Medio } from '../src/types/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHADOWMEDIA_PATH = path.join(__dirname, '..', 'src', 'config', 'shadowMedia.ts');

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 — Medios ya en catálogo que necesitan activarse en cron
// ─────────────────────────────────────────────────────────────────────────────

interface ActivarEnCronEntry {
  canonical: string;
  /** Variantes de nombre a buscar en Supabase (ilike). */
  supabase_variants: string[];
  max_notas_shadow: number;
  region: string;
}

const ACTIVAR_EN_CRON: ActivarEnCronEntry[] = [
  {
    canonical: 'UDG TV / Canal 44',
    supabase_variants: ['UDG TV', 'UDG TV / Canal 44', 'Canal 44'],
    max_notas_shadow: 20,
    region: 'Jalisco',
  },
  {
    canonical: 'Notisistema',
    supabase_variants: ['Notisistema'],
    max_notas_shadow: 15,
    region: 'Jalisco',
  },
  {
    canonical: 'Tráfico ZMG',
    supabase_variants: ['Tráfico ZMG', 'Trafico ZMG', 'Tráfico'],
    max_notas_shadow: 15,
    region: 'Jalisco',
  },
  {
    canonical: 'Vallarta Independiente',
    supabase_variants: ['Vallarta Independiente'],
    max_notas_shadow: 15,
    region: 'Jalisco / Costa Occidental',
  },
  {
    canonical: 'Partidero',
    supabase_variants: ['Partidero'],
    max_notas_shadow: 10,
    region: 'Jalisco',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FASE 2 — Medios nuevos para insertar en catálogo
// ─────────────────────────────────────────────────────────────────────────────

export const NUEVOS_MEDIOS_JALISCO: Medio[] = [
  {
    medio_id: 'MED-0201',
    nombre_medio: 'Semanario Conciencia Pública',
    grupo_medio: null,
    url_base: 'https://www.concienciapublica.com.mx',
    pais: 'MX',
    estado: 'Jalisco',
    municipio: 'Guadalajara',
    region: 'Jalisco',
    categoria: 'Noticias / Local',
    prioridad: 'Alta',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.concienciapublica.com.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-29 (MERY JALISCO PRIORITY). Cobertura política Jalisco/Congreso. ' +
      'WordPress estándar — RSS /feed/ candidato A_PUBLICO_FACIL, verificar en vivo.',
  },
  {
    medio_id: 'MED-0202',
    nombre_medio: 'A Fondo Jalisco',
    grupo_medio: null,
    url_base: 'https://afondojalisco.com',
    pais: 'MX',
    estado: 'Jalisco',
    municipio: 'Guadalajara',
    region: 'Jalisco',
    categoria: 'Noticias / Local',
    prioridad: 'Alta',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://afondojalisco.com/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-29 (MERY JALISCO PRIORITY). Periodismo local Jalisco. ' +
      'WordPress — RSS /feed/ candidato A_PUBLICO_FACIL, verificar en vivo.',
  },
  {
    medio_id: 'MED-0203',
    nombre_medio: 'Siker',
    grupo_medio: null,
    url_base: 'https://www.siker.com.mx',
    pais: 'MX',
    estado: 'Jalisco',
    municipio: 'Guadalajara',
    region: 'Jalisco',
    categoria: 'Noticias / Local',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.siker.com.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-29 (MERY JALISCO PRIORITY). Noticias Jalisco. ' +
      'WordPress — RSS /feed/ candidato A_PUBLICO_FACIL, verificar en vivo.',
  },
  {
    medio_id: 'MED-0204',
    nombre_medio: 'Página 24 Jalisco',
    grupo_medio: null,
    url_base: 'https://www.pagina24jalisco.com.mx',
    pais: 'MX',
    estado: 'Jalisco',
    municipio: 'Guadalajara',
    region: 'Jalisco',
    categoria: 'Noticias / Local',
    prioridad: 'Media',
    activo: true,
    metodo_extraccion: 'RSS',
    rss_url: 'https://www.pagina24jalisco.com.mx/feed/',
    sitemap_url: null,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas:
      'Alta 2026-07-29 (MERY JALISCO PRIORITY). Cobertura política Jalisco. ' +
      'WordPress — RSS /feed/ candidato A_PUBLICO_FACIL, verificar en vivo.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Busca un medio en Supabase por variantes de nombre (ilike). Devuelve el primero que coincida. */
async function buscarMedioPorNombre(
  sb: ReturnType<typeof getSupabase>,
  variantes: string[],
): Promise<{ medio_id: string; nombre_medio: string } | null> {
  for (const v of variantes) {
    const { data, error } = await sb
      .from('medios')
      .select('medio_id, nombre_medio')
      .ilike('nombre_medio', `%${v}%`)
      .limit(1);
    if (!error && data && data.length > 0) return data[0] as { medio_id: string; nombre_medio: string };
  }
  return null;
}

/** Verifica si un medio_id ya existe en SHADOW_MEDIOS_DAILY_VALIDATED (leyendo shadowMedia.ts). */
function estaEnShadowMedia(medioId: string): boolean {
  try {
    const content = fs.readFileSync(SHADOWMEDIA_PATH, 'utf8');
    return content.includes(`'${medioId}'`);
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch shadowMedia.ts
// ─────────────────────────────────────────────────────────────────────────────

interface NuevoCronEntry {
  medio_id: string;
  nombre: string;
  max_notas_shadow: number;
  comentario: string;
}

function patchShadowMedia(nuevosEntries: NuevoCronEntry[]): void {
  if (nuevosEntries.length === 0) {
    logger.info({}, 'shadowMedia.ts: sin entradas nuevas que agregar');
    return;
  }

  const content = fs.readFileSync(SHADOWMEDIA_PATH, 'utf8');

  // Buscar el cierre del array SHADOW_MEDIOS_DAILY_VALIDATED
  const CLOSE_MARKER = '] as const;';
  // El último '] as const;' en el archivo es el cierre de SHADOW_MEDIOS_DAILY_VALIDATED
  const lastIdx = content.lastIndexOf(CLOSE_MARKER);
  if (lastIdx === -1) {
    logger.error({}, 'No se encontró el cierre de SHADOW_MEDIOS_DAILY_VALIDATED en shadowMedia.ts');
    return;
  }

  const lines: string[] = [
    '  // ── Mery Jalisco Priority (2026-07-29) ────────────────────────────────────',
    '  // Medios Jalisco con señal histórica de Mery Pozos activados en cron.',
    '  // Nuevos (MED-0201..0204) insertados vía catalog-mery-jalisco-priority.ts.',
    '  // ACTIVAR_EN_CRON: IDs descubiertos en Supabase por el mismo script.',
  ];
  for (const e of nuevosEntries) {
    lines.push(`  // ${e.comentario}`);
    lines.push(`  { medio_id: '${e.medio_id}', nombre: '${e.nombre}', fuente: 'rss' as const, max_notas_shadow: ${e.max_notas_shadow}, activo_shadow: true },`);
  }

  const bloque = '\n' + lines.join('\n') + '\n';
  const patched = content.slice(0, lastIdx) + bloque + content.slice(lastIdx);

  fs.writeFileSync(SHADOWMEDIA_PATH, patched, 'utf8');
  logger.info({ count: nuevosEntries.length }, `shadowMedia.ts actualizado con ${nuevosEntries.length} nuevas entradas`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const upsert = argv.includes('--upsert');
  const patchShadow = argv.includes('--patch-shadowmedia');

  logger.info({ dryRun, upsert, patchShadow }, '=== Mery Jalisco Priority — catálogo medios ===');

  const sb = getSupabase();

  // ── FASE 1: Buscar IDs de ACTIVAR_EN_CRON ──────────────────────────────────
  logger.info({}, '[FASE 1] Buscando medios ACTIVAR_EN_CRON en Supabase…');
  const activarResults: Array<{ canonical: string; medio_id: string | null; nombre_encontrado: string; en_shadow: boolean; max_notas: number }> = [];

  for (const entry of ACTIVAR_EN_CRON) {
    const found = await buscarMedioPorNombre(sb, entry.supabase_variants);
    const enShadow = found ? estaEnShadowMedia(found.medio_id) : false;
    activarResults.push({
      canonical: entry.canonical,
      medio_id: found?.medio_id ?? null,
      nombre_encontrado: found?.nombre_medio ?? '(no encontrado)',
      en_shadow: enShadow,
      max_notas: entry.max_notas_shadow,
    });
    logger.info(
      { canonical: entry.canonical, medio_id: found?.medio_id, en_shadow: enShadow },
      `[FASE 1] ${entry.canonical}`,
    );
  }

  // ── FASE 2: Verificar e insertar nuevos medios ────────────────────────────
  logger.info({}, '[FASE 2] Verificando medios AGREGAR_A_CATALOGO…');

  const { data: existentes, error: errExist } = await sb
    .from('medios')
    .select('medio_id, nombre_medio')
    .in('medio_id', NUEVOS_MEDIOS_JALISCO.map((m) => m.medio_id));
  if (errExist) logger.warn({ error: errExist.message }, 'No se pudo verificar existentes');

  const existentesIds = new Set((existentes ?? []).map((m: any) => m.medio_id));
  const paraInsertar = NUEVOS_MEDIOS_JALISCO.filter((m) => !existentesIds.has(m.medio_id));

  logger.info(
    { total: NUEVOS_MEDIOS_JALISCO.length, ya_existen: existentesIds.size, para_insertar: paraInsertar.length },
    '[FASE 2] Estado catálogo',
  );

  if (!dryRun && upsert && paraInsertar.length > 0) {
    const { error: errInsert } = await sb.from('medios').insert(paraInsertar);
    if (errInsert) {
      logger.error({ error: errInsert.message }, '[FASE 2] Error insertando nuevos medios');
    } else {
      logger.info({ count: paraInsertar.length }, '[FASE 2] Nuevos medios insertados en Supabase');
    }
  } else if (dryRun) {
    logger.info({ paraInsertar: paraInsertar.map((m) => m.medio_id) }, '[FASE 2] DRY-RUN: se insertarían estos medios');
  }

  // ── FASE 3: Patch shadowMedia.ts ──────────────────────────────────────────
  if (patchShadow) {
    const nuevasEntries: NuevoCronEntry[] = [];

    for (const r of activarResults) {
      if (!r.medio_id) {
        logger.warn({ canonical: r.canonical }, '[PATCH] No se encontró medio_id — omitiendo');
        continue;
      }
      if (r.en_shadow) {
        logger.info({ medio_id: r.medio_id, canonical: r.canonical }, '[PATCH] Ya está en shadowMedia — omitiendo');
        continue;
      }
      nuevasEntries.push({
        medio_id: r.medio_id,
        nombre: r.nombre_encontrado,
        max_notas_shadow: r.max_notas,
        comentario: `ACTIVAR_EN_CRON: ${r.canonical} (descubierto en Supabase 2026-07-29)`,
      });
    }

    for (const m of NUEVOS_MEDIOS_JALISCO) {
      if (estaEnShadowMedia(m.medio_id)) {
        logger.info({ medio_id: m.medio_id }, '[PATCH] Ya está en shadowMedia — omitiendo');
        continue;
      }
      nuevasEntries.push({
        medio_id: m.medio_id,
        nombre: m.nombre_medio,
        max_notas_shadow: 15,
        comentario: `AGREGAR_A_CATALOGO: ${m.nombre_medio} (nuevo, ${m.url_base})`,
      });
    }

    if (!dryRun) {
      patchShadowMedia(nuevasEntries);
    } else {
      logger.info({ nuevasEntries }, '[DRY-RUN] Se agregarían al shadowMedia.ts estas entradas');
    }
  }

  // ── Resumen ──────────────────────────────────────────────────────────────
  logger.info({ activarResults, nuevos_insertados: upsert && !dryRun ? paraInsertar.length : 0 }, '=== Resumen final ===');

  logger.info({},
    [
      '',
      '─── ACTIVAR_EN_CRON encontrados ──────────────────────────────────────',
      ...activarResults.map((r) =>
        `  ${r.canonical.padEnd(30)} medio_id=${r.medio_id ?? 'NO_ENCONTRADO'}  en_shadow=${r.en_shadow}`,
      ),
      '',
      '─── AGREGAR_A_CATALOGO (nuevos) ────────────────────────────────────',
      ...NUEVOS_MEDIOS_JALISCO.map((m) =>
        `  ${m.nombre_medio.padEnd(30)} ${m.medio_id}  ${m.rss_url}`,
      ),
      '',
      'MURAL → D_PAGO_CONVENIO_API — NO ACTIVADO (requiere acceso autorizado).',
      '',
      upsert ? 'Próximo paso: verificar RSS de MED-0201..0204 en vivo y crawl real.' : 'Correr con --upsert --patch-shadowmedia para aplicar cambios.',
    ].join('\n'),
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
