/**
 * Auditoría READ-ONLY de readiness de MEDIOS IMPORTANTES para Patrón (CLI-0002).
 *
 * Audita TODOS los medios relevantes (no solo los que están en cron): parte de
 * una lista curada de medios importantes + catálogo + cron + los que ya generaron
 * menciones CLI-0002. Para cada uno clasifica catálogo/cron/scraping/texto/
 * menciones/estado/importancia/acción. NO escribe en Supabase ni Sheets; opcional
 * `--json` vuelca a data/ (no commitear).
 *
 * Uso:
 *   npm run audit-patron-important-media-readiness
 *   npm run audit-patron-important-media-readiness -- --json
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { foldText } from '../src/matchers/text.js';
import { logger } from '../src/utils/logger.js';
import {
  SHADOW_MEDIOS, SHADOW_MEDIOS_NACIONALES_B, SHADOW_MEDIOS_CRISIS, SHADOW_MEDIOS_DAILY_VALIDATED,
} from '../src/config/shadowMedia.js';

const CLI_ID = 'CLI-0002';

/** Lista mínima de medios importantes a verificar (del brief). importancia por nombre. */
const MEDIOS_IMPORTANTES: { nombre: string; importancia: 'P1_CRITICO' | 'P2_IMPORTANTE' | 'P3_OBSERVAR'; region: string }[] = [
  { nombre: 'El Universal', importancia: 'P1_CRITICO', region: 'nacional' },
  { nombre: 'Reforma', importancia: 'P1_CRITICO', region: 'nacional' },
  { nombre: 'Milenio', importancia: 'P1_CRITICO', region: 'nacional' },
  { nombre: 'Excélsior', importancia: 'P1_CRITICO', region: 'nacional' },
  { nombre: 'El Financiero', importancia: 'P1_CRITICO', region: 'nacional' },
  { nombre: 'El Economista', importancia: 'P1_CRITICO', region: 'nacional' },
  { nombre: 'Forbes México', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: 'Expansión', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: 'El Heraldo de México', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: 'La Jornada', importancia: 'P1_CRITICO', region: 'nacional' },
  { nombre: 'La Razón de México', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: '24 Horas', importancia: 'P3_OBSERVAR', region: 'nacional' },
  { nombre: 'Proceso', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: 'Animal Político', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: 'Aristegui Noticias', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: 'LatinUS', importancia: 'P3_OBSERVAR', region: 'nacional' },
  { nombre: 'Uno TV', importancia: 'P3_OBSERVAR', region: 'nacional' },
  { nombre: 'Publimetro', importancia: 'P3_OBSERVAR', region: 'nacional' },
  { nombre: 'El Sol de México', importancia: 'P2_IMPORTANTE', region: 'nacional' },
  { nombre: 'El Informador', importancia: 'P1_CRITICO', region: 'jalisco' },
  { nombre: 'Mural', importancia: 'P1_CRITICO', region: 'jalisco' },
  { nombre: 'NTR Guadalajara', importancia: 'P2_IMPORTANTE', region: 'jalisco' },
  { nombre: 'Milenio Jalisco', importancia: 'P2_IMPORTANTE', region: 'jalisco' },
  { nombre: 'Quadratín Jalisco', importancia: 'P3_OBSERVAR', region: 'jalisco' },
  { nombre: 'AF Medios', importancia: 'P3_OBSERVAR', region: 'jalisco' },
  { nombre: 'Líder Informativo', importancia: 'P3_OBSERVAR', region: 'guanajuato' },
  { nombre: 'Periódico Correo', importancia: 'P1_CRITICO', region: 'guanajuato' },
  { nombre: 'El Sol de Irapuato', importancia: 'P2_IMPORTANTE', region: 'guanajuato' },
  { nombre: 'AM León', importancia: 'P2_IMPORTANTE', region: 'guanajuato' },
  { nombre: 'Zona Franca', importancia: 'P3_OBSERVAR', region: 'guanajuato' },
  { nombre: 'Milenio Guanajuato', importancia: 'P3_OBSERVAR', region: 'guanajuato' },
  { nombre: 'Food & Pleasure', importancia: 'P3_OBSERVAR', region: 'sectorial' },
  { nombre: 'Xataka México', importancia: 'P3_OBSERVAR', region: 'sectorial' },
  { nombre: 'Revista Espejo', importancia: 'P3_OBSERVAR', region: 'sinaloa' },
  { nombre: 'Vanguardia', importancia: 'P2_IMPORTANTE', region: 'coahuila' },
];

function cronSet(): Set<string> {
  return new Set<string>([
    ...SHADOW_MEDIOS,
    ...SHADOW_MEDIOS_NACIONALES_B.map((m) => m.medio_id),
    ...SHADOW_MEDIOS_CRISIS.map((m) => m.medio_id),
    ...SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id),
  ]);
}

/** Empareja un nombre esperado contra el catálogo por nombre normalizado (subcadena). */
function resolverMedio(nombreEsperado: string, catalogo: any[]): any | undefined {
  const f = foldText(nombreEsperado).replace(/\s+/g, ' ').trim();
  // Coincidencia exacta normalizada primero.
  let hit = catalogo.find((m) => foldText(m.nombre_medio).replace(/\s+/g, ' ').trim() === f);
  if (hit) return hit;
  // Subcadena en cualquiera de las dos direcciones (p.ej. "Forbes México" ~ "Forbes Mexico").
  hit = catalogo.find((m) => {
    const fm = foldText(m.nombre_medio).replace(/\s+/g, ' ').trim();
    return fm.includes(f) || f.includes(fm);
  });
  return hit;
}

async function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const sb = getSupabase();
  logger.info({ cliente: CLI_ID, medios_a_verificar: MEDIOS_IMPORTANTES.length }, '=== Auditoría de medios importantes Patrón (SOLO LECTURA) ===');

  const cron = cronSet();
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: catalogo } = await sb.from('medios').select('medio_id, nombre_medio, url_base, region, estado, prioridad, activo, ultimo_estado');

  // Resuelve primero los medio_id de los 35 medios curados y consulta noticias/menciones
  // UN MEDIO A LA VEZ: la tabla noticias tiene >10k filas en 7d incluso acotada a estos
  // 35 medios (>1000 en total), y PostgREST trunca silenciosamente cualquier .limit(N)
  // por encima de su tope real de filas por página — un medio de bajo volumen histórico
  // (recién agregado) puede quedar fuera del sub-conjunto devuelto por una consulta en
  // bloque aunque SÍ tenga noticias reales en la ventana. Confirmado en vivo (2026-07-17):
  // AM León/CRT con notas reales de ayer aparecían como noticias_7d=0 por este motivo,
  // incluso ya acotando con .in('medio_id', [...]) a solo estos 35 medios.
  const medioIdsRelevantes = Array.from(
    new Set(
      MEDIOS_IMPORTANTES
        .map((imp) => resolverMedio(imp.nombre, catalogo ?? [])?.medio_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const PAGINA = 1000;
  const noticiasRaw: any[] = [];
  for (const medioId of medioIdsRelevantes) {
    let offset = 0;
    for (;;) {
      const { data, count } = await sb
        .from('noticias')
        .select('medio_id, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_extraido', { count: 'exact' })
        .eq('medio_id', medioId)
        .gte('fecha_publicacion', hace7d)
        .order('noticia_id', { ascending: true })
        .range(offset, offset + PAGINA - 1);
      if (data) noticiasRaw.push(...data);
      offset += PAGINA;
      if (!data || data.length < PAGINA || offset >= (count ?? 0)) break;
    }
  }
  const mencionesRaw: any[] = [];
  for (const medioId of medioIdsRelevantes) {
    const { data } = await sb
      .from('menciones')
      .select('keyword, created_at, noticias!inner(medio_id)')
      .eq('cliente_id', CLI_ID)
      .eq('noticias.medio_id', medioId)
      .gte('created_at', hace7d)
      .limit(PAGINA);
    if (data) mencionesRaw.push(...data);
  }

  const noticiasPorMedio = new Map<string, any[]>();
  for (const n of (noticiasRaw ?? []) as any[]) {
    const arr = noticiasPorMedio.get(n.medio_id) ?? []; arr.push(n); noticiasPorMedio.set(n.medio_id, arr);
  }
  const MARCA = ['patron', 'tequila patron', 'casa patron', 'bacardi', 'atotonilco'];
  const mencionesPorMedio = new Map<string, { marca: number; sector: number }>();
  for (const m of (mencionesRaw ?? []) as any[]) {
    const medioId = m.noticias?.medio_id; if (!medioId) continue;
    const cur = mencionesPorMedio.get(medioId) ?? { marca: 0, sector: 0 };
    if (MARCA.some((b) => foldText(m.keyword ?? '').includes(b))) cur.marca++; else cur.sector++;
    mencionesPorMedio.set(medioId, cur);
  }

  const filas: any[] = [];
  for (const imp of MEDIOS_IMPORTANTES) {
    const medio = resolverMedio(imp.nombre, catalogo ?? []);
    const enCatalogo = Boolean(medio);
    const enCron = medio ? cron.has(medio.medio_id) : false;
    const notas = medio ? (noticiasPorMedio.get(medio.medio_id) ?? []) : [];
    const notas24h = notas.filter((n) => n.fecha_publicacion >= hace24h);
    const conTexto = notas.filter((n) => n.texto_cuerpo_nota || n.texto_nota_limpia);
    const textoOkPct = notas.length > 0 ? Math.round((conTexto.length / notas.length) * 1000) / 10 : 0;
    const cuerpoVacioPct = notas.length > 0 ? Math.round(((notas.length - conTexto.length) / notas.length) * 1000) / 10 : 0;
    const men = medio ? (mencionesPorMedio.get(medio.medio_id) ?? { marca: 0, sector: 0 }) : { marca: 0, sector: 0 };
    const ultimoEstado = medio?.ultimo_estado ?? null;

    let estado: string;
    if (!enCatalogo) estado = 'NO_CATALOGADO';
    else if (/error|blocked|403|404/i.test(ultimoEstado ?? '')) estado = 'BLOQUEADO';
    else if (!enCron) estado = 'CATALOGO_NO_CRON';
    else if (notas.length === 0) estado = 'EN_CRON_SIN_NOTICIAS';
    else if (textoOkPct < 30) estado = 'NECESITA_REENRICH';
    else if (textoOkPct < 70) estado = 'EN_CRON_TEXTO_MALO';
    else estado = 'LISTO_LEYENDO';

    let accion: string;
    switch (estado) {
      case 'NO_CATALOGADO': accion = imp.importancia === 'P1_CRITICO' ? 'CATALOGAR (P1)' : 'evaluar alta a catálogo'; break;
      case 'BLOQUEADO': accion = 'reparar fuente / revisar bloqueo'; break;
      case 'CATALOGO_NO_CRON': accion = imp.importancia === 'P1_CRITICO' ? 'AGREGAR A CRON (P1)' : 'candidato a cron'; break;
      case 'EN_CRON_SIN_NOTICIAS': accion = 'revisar fuente (en cron pero sin noticias)'; break;
      case 'NECESITA_REENRICH': accion = 're-enrich (cuerpo vacío)'; break;
      case 'EN_CRON_TEXTO_MALO': accion = 're-enrich parcial'; break;
      default: accion = 'mantener';
    }

    const fila = {
      medio: imp.nombre, medio_id: medio?.medio_id ?? null, dominio: medio?.url_base ?? null,
      region: imp.region, importancia: imp.importancia, en_catalogo: enCatalogo, en_cron: enCron,
      noticias_24h: notas24h.length, noticias_7d: notas.length, texto_ok_pct: textoOkPct,
      cuerpo_vacio_pct: cuerpoVacioPct, menciones_marca_7d: men.marca, menciones_sector_7d: men.sector,
      ultimo_estado: ultimoEstado, estado, accion_recomendada: accion,
    };
    filas.push(fila);
    logger.info(fila, '[medio importante]');
  }

  // ── Resumen ──────────────────────────────────────────────────────────────────
  const p1 = filas.filter((f) => f.importancia === 'P1_CRITICO');
  const resumen = {
    total_auditados: filas.length,
    p1_criticos: p1.length,
    p1_listo_leyendo: p1.filter((f) => f.estado === 'LISTO_LEYENDO').length,
    p1_catalogo_no_cron: p1.filter((f) => f.estado === 'CATALOGO_NO_CRON').length,
    p1_no_catalogados: p1.filter((f) => f.estado === 'NO_CATALOGADO').length,
    p1_necesita_reenrich: p1.filter((f) => f.estado === 'NECESITA_REENRICH' || f.estado === 'EN_CRON_TEXTO_MALO').length,
    p1_bloqueados: p1.filter((f) => f.estado === 'BLOQUEADO').length,
    p1_sin_noticias: p1.filter((f) => f.estado === 'EN_CRON_SIN_NOTICIAS').length,
    por_estado: filas.reduce((acc: Record<string, number>, f) => { acc[f.estado] = (acc[f.estado] ?? 0) + 1; return acc; }, {}),
  };
  logger.info(resumen, '=== RESUMEN readiness medios importantes Patrón ===');

  const topGaps = filas
    .filter((f) => f.importancia === 'P1_CRITICO' && f.estado !== 'LISTO_LEYENDO')
    .map((f) => `${f.medio} [${f.estado}] → ${f.accion_recomendada}`);
  logger.info({ top_gaps_p1: topGaps }, 'Top gaps P1 (no LISTO_LEYENDO)');

  if (wantJson) {
    try { mkdirSync('data', { recursive: true }); } catch { /* existe */ }
    writeFileSync('data/patron-important-media-readiness.json', JSON.stringify({ generado: new Date().toISOString(), resumen, filas }, null, 2), 'utf8');
    logger.info({ archivo: 'data/patron-important-media-readiness.json' }, 'JSON escrito (no commitear data/).');
  }

  logger.info({ nota: 'SOLO LECTURA — nada modificado.' }, '=== Fin auditoría medios importantes ===');
  return { resumen, filas };
}

main().catch((e) => { console.error(e); process.exit(1); });
