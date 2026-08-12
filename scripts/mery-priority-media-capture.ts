/**
 * Captura de medios prioritarios Mery Pozos (Jalisco).
 *
 * Resuelve los medio_id de los 10 medios prioritarios CONTRA EL CATÁLOGO REAL de
 * Supabase (una sola lectura), decide qué es capturable y solo entonces invoca
 * crawl + enrich sobre los que pasan el gate.
 *
 * Antes esta lista estaba hardcodeada a MED-0201..MED-0204, así que los cinco
 * medios "ACTIVAR_EN_CRON" (UDG TV, Notisistema, Tráfico ZMG, Vallarta
 * Independiente, Partidero) y AFmedios quedaban fuera de la captura. Ahora la
 * cobertura es completa y el estado de cada medio se reporta explícitamente.
 *
 * MURAL nunca se captura: queda documentado como D_PAGO_CONVENIO_API.
 *
 * Acciones posibles por medio:
 *   CAPTURAR                   → en catálogo, activo, con fuente pública viable.
 *   ACTIVAR_EN_CATALOGO        → existe pero `activo=false` (crawl lo ignora).
 *   AGREGAR_A_CATALOGO         → no está en el catálogo de Supabase.
 *   NECESITA_DIRECT_EXTRACTOR  → requiere JS/proxy: no hay fuente RSS/sitemap usable.
 *   NO_VIABLE                  → en catálogo pero sin RSS ni sitemap ni método directo.
 *   D_PAGO_CONVENIO_API        → acceso de pago/convenio: NO se toca.
 *
 * En modo real (sin --dry-run), después de crawl + enrich corre detect-mentions
 * ACOTADO a CLI-MERY-TEST y a los medio_id capturados en esta corrida (nunca al
 * backlog global). Al usar `--client`, detect-mentions NO marca las noticias
 * como `menciones_procesado=true`, así que el detect global de otros clientes
 * sigue viéndolas normalmente después.
 *
 * NO activa envíos. NO modifica alertas_activas. NO escribe en Sheets.
 * NO exporta resultados, NO genera XML, NO corre classify-ia.
 *
 * Uso:
 *   npm run mery:priority-media:capture -- --dry-run --max-notas=20
 *   npm run mery:priority-media:capture -- --max-notas=20
 *   npm run mery:priority-media:capture -- --max-notas=20 --enrich-limit=50 --detect-limit=100 --max-inserts=50
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import {
  retryPostgrest,
  describeSupabaseError,
  hintForSupabaseError,
} from '../src/supabase/errors.js';
import { mediosEnCualquierCron } from '../src/config/shadowMedia.js';
import { foldText } from '../src/matchers/text.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

/** Único cliente para el que este pipeline detecta menciones. */
const CLI_ID_MERY = 'CLI-MERY-TEST';

// ─────────────────────────────────────────────────────────────────────────────
// Los 10 medios prioritarios de Mery Pozos
// ─────────────────────────────────────────────────────────────────────────────

export type MeryOrigen = 'ACTIVAR_O_VALIDAR' | 'NUEVO_O_VALIDAR';

export interface MeryPriorityMedio {
  canonical: string;
  /**
   * ID esperado. Para los nuevos (MED-0201..0204) y AFmedios (MED-0187) es
   * conocido. Para los demás es una PISTA documentada en
   * docs/NATIONAL_MEDIA_ACCESS_MATRIX.md que se verifica contra la base; si no
   * coincide, se resuelve por nombre. Nunca se asume sin verificar.
   */
  medio_id_esperado: string | null;
  /** Variantes de nombre para resolver por catálogo (comparación folded). */
  variantes: string[];
  origen: MeryOrigen;
  /** Si el acceso no es público, se documenta y NUNCA se captura. */
  bloqueo?: 'D_PAGO_CONVENIO_API';
  nota?: string;
}

export const MERY_PRIORITY_MEDIOS: MeryPriorityMedio[] = [
  // ── Ya catalogados / activar o validar ───────────────────────────────────
  {
    canonical: 'UDG TV / Canal 44',
    medio_id_esperado: 'MED-0040',
    variantes: ['udg tv', 'udgtv', 'canal 44', 'udg tv / canal 44'],
    origen: 'ACTIVAR_O_VALIDAR',
    nota: 'ID documentado en NATIONAL_MEDIA_ACCESS_MATRIX (Canal 44/UDG TV = MED-0040).',
  },
  {
    canonical: 'Notisistema',
    medio_id_esperado: 'MED-0112',
    variantes: ['notisistema'],
    origen: 'ACTIVAR_O_VALIDAR',
    nota: 'La matriz documenta MED-0112/MED-0129 (posible duplicado); se resuelve por catálogo.',
  },
  {
    canonical: 'Tráfico ZMG',
    medio_id_esperado: null,
    variantes: ['trafico zmg', 'traficozmg', 'trafico gdl'],
    origen: 'ACTIVAR_O_VALIDAR',
    nota: 'Sin ID documentado localmente: se resuelve por nombre contra Supabase.',
  },
  {
    canonical: 'Vallarta Independiente',
    medio_id_esperado: null,
    variantes: ['vallarta independiente', 'vallartaindependiente'],
    origen: 'ACTIVAR_O_VALIDAR',
    nota: 'Sin ID documentado localmente: se resuelve por nombre contra Supabase.',
  },
  {
    canonical: 'Partidero',
    medio_id_esperado: 'MED-0042',
    variantes: ['partidero'],
    origen: 'ACTIVAR_O_VALIDAR',
    nota: 'ID documentado en NATIONAL_MEDIA_ACCESS_MATRIX (Partidero = MED-0042).',
  },

  // ── Nuevos / agregados o validar ─────────────────────────────────────────
  {
    canonical: 'Semanario Conciencia Pública',
    medio_id_esperado: 'MED-0201',
    variantes: ['semanario conciencia publica', 'conciencia publica'],
    origen: 'NUEVO_O_VALIDAR',
  },
  {
    canonical: 'A Fondo Jalisco',
    medio_id_esperado: 'MED-0202',
    variantes: ['a fondo jalisco', 'afondo jalisco'],
    origen: 'NUEVO_O_VALIDAR',
  },
  {
    canonical: 'AFmedios',
    medio_id_esperado: 'MED-0187',
    variantes: ['afmedios', 'af medios'],
    origen: 'NUEVO_O_VALIDAR',
    nota: 'Ya existía en catálogo como MED-0187 (AF Medios); antes quedaba fuera de la captura.',
  },
  {
    canonical: 'Siker',
    medio_id_esperado: 'MED-0203',
    variantes: ['siker'],
    origen: 'NUEVO_O_VALIDAR',
  },
  {
    canonical: 'Página 24 Jalisco',
    medio_id_esperado: 'MED-0204',
    variantes: ['pagina 24 jalisco', 'pagina24 jalisco', 'pagina 24'],
    origen: 'NUEVO_O_VALIDAR',
  },
];

/**
 * Medios prioritarios EXCLUIDOS a propósito. MURAL es de pago/convenio (grupo
 * Reforma): no se activa ni se captura salvo fuente autorizada.
 */
export const MERY_EXCLUIDOS: MeryPriorityMedio[] = [
  {
    canonical: 'MURAL',
    medio_id_esperado: null,
    variantes: ['mural'],
    origen: 'ACTIVAR_O_VALIDAR',
    bloqueo: 'D_PAGO_CONVENIO_API',
    nota: 'Grupo Reforma — paywall/convenio. NO se activa sin fuente autorizada.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Resolución contra el catálogo
// ─────────────────────────────────────────────────────────────────────────────

export type MeryAccion =
  | 'CAPTURAR'
  | 'ACTIVAR_EN_CATALOGO'
  | 'AGREGAR_A_CATALOGO'
  | 'NECESITA_DIRECT_EXTRACTOR'
  | 'NO_VIABLE'
  | 'D_PAGO_CONVENIO_API';

export interface CatalogoMedioRow {
  medio_id: string;
  nombre_medio: string | null;
  activo: boolean | null;
  metodo_extraccion: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  requiere_javascript: boolean | null;
  requiere_proxy: boolean | null;
  ultimo_estado: string | null;
}

export interface MeryMedioResuelto {
  canonical: string;
  medio_id: string | null;
  nombre: string;
  origen: MeryOrigen;
  en_catalogo: boolean;
  activo: boolean | null;
  en_cron: boolean | null;
  metodo: string | null;
  accion: MeryAccion;
  detalle: string;
}

const norm = (s: string | null | undefined): string => foldText(String(s ?? '')).replace(/\s+/g, ' ').trim();

/** Busca la fila del catálogo: primero por ID esperado, luego por nombre. */
export function resolverEnCatalogo(
  medio: MeryPriorityMedio,
  catalogo: CatalogoMedioRow[],
): CatalogoMedioRow | null {
  if (medio.medio_id_esperado) {
    const porId = catalogo.find((c) => c.medio_id === medio.medio_id_esperado);
    if (porId) return porId;
  }
  const variantes = medio.variantes.map(norm).filter((v) => v.length > 0);
  // Coincidencia exacta primero para no capturar un medio equivocado.
  for (const v of variantes) {
    const exacto = catalogo.find((c) => norm(c.nombre_medio) === v);
    if (exacto) return exacto;
  }
  for (const v of variantes) {
    const parcial = catalogo.find((c) => norm(c.nombre_medio).includes(v));
    if (parcial) return parcial;
  }
  return null;
}

/** ¿Tiene una fuente de ingesta que crawl.ts pueda usar? */
function tieneFuenteViable(row: CatalogoMedioRow): boolean {
  if (row.rss_url && row.rss_url.trim()) return true;
  if (row.sitemap_url && row.sitemap_url.trim()) return true;
  return norm(row.metodo_extraccion).includes('direct');
}

/** Clasifica un medio prioritario según el catálogo real. */
export function clasificarMedio(
  medio: MeryPriorityMedio,
  catalogo: CatalogoMedioRow[],
  enCron: Set<string>,
): MeryMedioResuelto {
  if (medio.bloqueo === 'D_PAGO_CONVENIO_API') {
    return {
      canonical: medio.canonical,
      medio_id: null,
      nombre: medio.canonical,
      origen: medio.origen,
      en_catalogo: false,
      activo: null,
      en_cron: null,
      metodo: null,
      accion: 'D_PAGO_CONVENIO_API',
      detalle: medio.nota ?? 'Acceso de pago/convenio: no se captura.',
    };
  }

  const row = resolverEnCatalogo(medio, catalogo);
  if (!row) {
    return {
      canonical: medio.canonical,
      medio_id: null,
      nombre: medio.canonical,
      origen: medio.origen,
      en_catalogo: false,
      activo: null,
      en_cron: null,
      metodo: null,
      accion: 'AGREGAR_A_CATALOGO',
      detalle:
        'No aparece en el catálogo de Supabase (ni por ID esperado ni por nombre). ' +
        'Correr catalog-mery-jalisco-priority antes de capturar.',
    };
  }

  const base = {
    canonical: medio.canonical,
    medio_id: row.medio_id,
    nombre: row.nombre_medio ?? medio.canonical,
    origen: medio.origen,
    en_catalogo: true,
    activo: row.activo ?? null,
    en_cron: enCron.has(row.medio_id),
    metodo: row.metodo_extraccion ?? null,
  };

  if (row.requiere_javascript || row.requiere_proxy) {
    return {
      ...base,
      accion: 'NECESITA_DIRECT_EXTRACTOR',
      detalle: 'Marcado requiere_javascript/requiere_proxy: crawl.ts lo excluye por política.',
    };
  }
  if (!tieneFuenteViable(row)) {
    return {
      ...base,
      accion: 'NO_VIABLE',
      detalle: 'Sin rss_url ni sitemap_url ni método DIRECT: no hay fuente pública que ingestar.',
    };
  }
  if (row.activo !== true) {
    return {
      ...base,
      accion: 'ACTIVAR_EN_CATALOGO',
      detalle: 'Existe en catálogo pero activo != true; getMediosActivos no lo devuelve.',
    };
  }
  return {
    ...base,
    accion: 'CAPTURAR',
    detalle: `Fuente viable (${row.rss_url ? 'rss' : row.sitemap_url ? 'sitemap' : 'direct'}).`,
  };
}

/** Lee el catálogo completo (una sola query, con reintentos). */
async function leerCatalogo(): Promise<CatalogoMedioRow[]> {
  const { data, error } = await retryPostgrest('mery:catalogo-medios', () =>
    getSupabase()
      .from('medios')
      .select(
        'medio_id, nombre_medio, activo, metodo_extraccion, rss_url, sitemap_url, requiere_javascript, requiere_proxy, ultimo_estado',
      )
      .order('medio_id'),
  );
  if (error) {
    throw new Error(
      `No se pudo leer el catálogo de medios: ${describeSupabaseError(error)}. ${hintForSupabaseError(error)}`,
    );
  }
  return (data ?? []) as unknown as CatalogoMedioRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface CaptureArgs {
  dryRun: boolean;
  maxNotas: number;
  enrichLimit: number;
  /** Tope de noticias a analizar en detect-mentions (--client=CLI-MERY-TEST). */
  detectLimit: number;
  /** Tope de menciones nuevas a insertar en detect-mentions (safety cap). */
  maxInserts: number;
  /**
   * Analizar solo noticias con texto_cuerpo_nota ya extraído. Default true:
   * justo terminamos de correr crawl+enrich sobre estos medios, así que
   * exigir texto evita marcar como "sin mención" noticias que en realidad
   * todavía no tienen cuerpo (falla de extracción) — mejor dejarlas
   * pendientes para el siguiente detect global que sí reintente con texto.
   */
  onlyWithText: boolean;
}

export function parseArgs(argv: string[]): CaptureArgs {
  const out: CaptureArgs = {
    dryRun: false,
    maxNotas: 20,
    enrichLimit: 50,
    detectLimit: 100,
    maxInserts: 50,
    onlyWithText: true,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'max-notas') out.maxNotas = parseIntOrNull(val) ?? out.maxNotas;
    if (key === 'enrich-limit') out.enrichLimit = parseIntOrNull(val) ?? out.enrichLimit;
    if (key === 'detect-limit') out.detectLimit = parseIntOrNull(val) ?? out.detectLimit;
    if (key === 'max-inserts') out.maxInserts = parseIntOrNull(val) ?? out.maxInserts;
    // Boolean negable: bare flag o `=true` → true; solo `=false` la apaga.
    if (key === 'only-with-text') out.onlyWithText = val === '' ? true : val !== 'false';
  }
  return out;
}

function spawnAsync(cmd: string, args: string[]): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

/** Reporte tabular legible en consola. */
function imprimirReporte(resueltos: MeryMedioResuelto[]): void {
  const lineas = [
    '',
    '─── Medios prioritarios Mery Pozos ─────────────────────────────────────────',
    `${'medio_id'.padEnd(10)} ${'nombre'.padEnd(30)} ${'acción'.padEnd(26)} ${'cat'.padEnd(4)} ${'act'.padEnd(4)} ${'cron'.padEnd(5)} método`,
  ];
  for (const r of resueltos) {
    lineas.push(
      [
        (r.medio_id ?? '—').padEnd(10),
        (r.nombre.length > 29 ? `${r.nombre.slice(0, 28)}…` : r.nombre).padEnd(30),
        r.accion.padEnd(26),
        String(r.en_catalogo).padEnd(4),
        String(r.activo ?? '—').padEnd(4),
        String(r.en_cron ?? '—').padEnd(5),
        r.metodo ?? '—',
      ].join(' '),
    );
  }
  lineas.push('');
  lineas.push('MURAL → D_PAGO_CONVENIO_API — NO se activa (grupo Reforma, paywall/convenio).');
  lineas.push('');
  logger.info({}, lineas.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  logger.info(
    {
      dry_run: args.dryRun,
      max_notas: args.maxNotas,
      enrich_limit: args.enrichLimit,
      detect_limit: args.detectLimit,
      max_inserts: args.maxInserts,
      only_with_text: args.onlyWithText,
      client: CLI_ID_MERY,
    },
    '=== Mery Priority Media Capture ===',
  );

  const catalogo = await leerCatalogo();
  const enCron = mediosEnCualquierCron();
  logger.info({ medios_en_catalogo: catalogo.length, medios_en_cron: enCron.size }, 'Catálogo leído');

  const resueltos = [
    ...MERY_PRIORITY_MEDIOS.map((m) => clasificarMedio(m, catalogo, enCron)),
    ...MERY_EXCLUIDOS.map((m) => clasificarMedio(m, catalogo, enCron)),
  ];

  for (const r of resueltos) {
    const payload = {
      medio_id: r.medio_id,
      nombre: r.nombre,
      accion: r.accion,
      en_catalogo: r.en_catalogo,
      activo: r.activo,
      en_cron: r.en_cron,
      metodo: r.metodo,
      origen: r.origen,
      detalle: r.detalle,
    };
    if (r.accion === 'CAPTURAR') logger.info(payload, `[medio] ${r.canonical}`);
    else logger.warn(payload, `[medio] ${r.canonical} → ${r.accion}`);
  }

  imprimirReporte(resueltos);

  const capturables = resueltos.filter((r) => r.accion === 'CAPTURAR' && r.medio_id);
  const pendientes = resueltos.filter((r) => r.accion !== 'CAPTURAR');

  logger.info(
    {
      total: resueltos.length,
      capturables: capturables.length,
      pendientes: pendientes.length,
      por_accion: pendientes.reduce<Record<string, number>>((acc, r) => {
        acc[r.accion] = (acc[r.accion] ?? 0) + 1;
        return acc;
      }, {}),
    },
    'Resumen de clasificación',
  );

  if (capturables.length === 0) {
    logger.error(
      {},
      'Ningún medio prioritario es capturable ahora. Revisa las acciones de arriba ' +
        '(AGREGAR_A_CATALOGO / ACTIVAR_EN_CATALOGO / NO_VIABLE) antes de reintentar.',
    );
    process.exit(1);
  }

  const ids = capturables.map((r) => r.medio_id!);

  if (args.dryRun) {
    logger.info(
      { ids, max_notas: args.maxNotas },
      'DRY-RUN: se capturarían estos medios. No se descarga ni se escribe nada.',
    );
    return;
  }

  const medioIdsArg = `--medio-ids=${ids.join(',')}`;

  // ── Crawl ─────────────────────────────────────────────────────────────────
  // crawl.ts no exporta a Sheets ni genera XML, así que no acepta (ni necesita)
  // --no-export-results / --no-generate-xml: pasarlos solo producía warnings de
  // "Flag desconocido ignorado".
  logger.info({ ids }, '[1] Crawl de medios prioritarios…');
  const crawlResult = await spawnAsync('npx', [
    'tsx', 'scripts/crawl.ts',
    medioIdsArg,
    `--max-notas=${args.maxNotas}`,
  ]);
  if (crawlResult.code !== 0) {
    logger.error({ code: crawlResult.code }, 'Crawl falló — abortando');
    process.exit(crawlResult.code);
  }

  // ── Enrich ────────────────────────────────────────────────────────────────
  logger.info({ ids }, '[2] Enrich de notas capturadas…');
  const enrichResult = await spawnAsync('npx', [
    'tsx', 'scripts/enrich-news.ts',
    medioIdsArg,
    `--limit=${args.enrichLimit}`,
  ]);
  if (enrichResult.code !== 0) {
    logger.warn({ code: enrichResult.code }, 'Enrich finalizó con código distinto de 0');
  }

  // ── Detect ────────────────────────────────────────────────────────────────
  // Acotado a CLI-MERY-TEST y a los medio_id de esta corrida (nunca backlog
  // global). `--client` hace que detect-mentions NO marque las noticias como
  // procesadas, así que el detect global de otros clientes las sigue viendo.
  // Sin export-results / generate-xml / classify-ia / Sheets / alertas: solo
  // inserta menciones en Supabase.
  logger.info(
    {
      ids,
      client: CLI_ID_MERY,
      detect_limit: args.detectLimit,
      max_inserts: args.maxInserts,
      only_with_text: args.onlyWithText,
    },
    '[3] Detectar menciones CLI-MERY-TEST…',
  );
  const detectArgs = [
    'tsx', 'scripts/detect-mentions.ts',
    `--client=${CLI_ID_MERY}`,
    medioIdsArg,
    `--limit=${args.detectLimit}`,
    `--max-inserts=${args.maxInserts}`,
  ];
  if (args.onlyWithText) detectArgs.push('--only-with-text');
  const detectResult = await spawnAsync('npx', detectArgs);
  if (detectResult.code !== 0) {
    logger.warn({ code: detectResult.code }, 'Detect-mentions finalizó con código distinto de 0');
  }

  logger.info({ ids }, '=== Mery Priority Media Capture completado (crawl + enrich + detect CLI-MERY-TEST) ===');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'Error fatal en mery-priority-media-capture');
    process.exit(1);
  });
}

export { main };
