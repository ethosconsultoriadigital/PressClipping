/**
 * AUDIT MERY GAP SOURCES — auditoría read-only de fuentes candidatas para
 * cerrar el gap de cobertura CLI-MERY-TEST (Mery Pozos) frente a la alerta
 * legacy de Google RSS.
 *
 * IMPORTANTE (política editorial): esta auditoría es 100% sobre FUENTES
 * (catálogo/cron/extracción de cuerpo completo). NO evalúa ni propone
 * keywords temáticas (SIAPA, agua, IEPC, promoción, etc.) — el cierre del
 * gap se hace ampliando de dónde se capturan notas generales, nunca de qué
 * se busca. La validación de cliente sigue dependiendo exclusivamente de que
 * aparezca "Mery Pozos" o una variante autorizada en título/descripción/cuerpo
 * (ver `src/editorial/meryCriteria.ts` y las 12 keywords KEY-0040..0051).
 *
 * Para cada fuente candidata reporta:
 *   - si existe en el catálogo de Supabase (medio_id, activo, metodo_extraccion)
 *   - si está en algún cron shadow (mediosEnCualquierCron / tiers específicos)
 *   - capturabilidad en vivo (probe RSS/sitemap declarado, sin guardar nada)
 *   - si captura cuerpo completo (muestra de noticias con texto limpio >100 chars)
 *   - recomendación y riesgo
 *
 * Read-only: no inserta, no actualiza, no borra nada en Supabase ni en Sheets.
 *
 * Uso:
 *   npm run audit-mery-gap-sources
 *   npm run audit-mery-gap-sources -- --skip-probe   (omite fetch en vivo de RSS/sitemap)
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { probeMedio } from '../src/validation/probe.js';
import type { MedioInput } from '../src/validation/diagnostics.js';
import {
  SHADOW_MEDIOS,
  SHADOW_MEDIOS_NACIONALES_B,
  SHADOW_MEDIOS_CRISIS,
  SHADOW_MEDIOS_DAILY_VALIDATED,
  mediosEnCualquierCron,
} from '../src/config/shadowMedia.js';

/** Fuente candidata a auditar (declarada a mano por nombre/variantes de búsqueda). */
interface FuenteCandidata {
  nombre_canonico: string;
  /** Variantes de nombre a buscar en Supabase (ilike). */
  variantes: string[];
  region: string;
  /** Contexto de por qué está en el gap (solo informativo, NO es keyword). */
  motivo_gap: string;
}

const FUENTES_GAP: FuenteCandidata[] = [
  { nombre_canonico: 'A Fondo Jalisco', variantes: ['A Fondo Jalisco', 'AFondoJalisco'], region: 'Jalisco', motivo_gap: 'Medio local Jalisco con cobertura política regional' },
  { nombre_canonico: 'AFmedios', variantes: ['AF Medios', 'AFmedios', 'AFMedios'], region: 'Jalisco', motivo_gap: 'Medio local Jalisco, ya catalogado en lote 200-media' },
  { nombre_canonico: 'Siker', variantes: ['Siker'], region: 'Jalisco', motivo_gap: 'Medio local Jalisco/Guadalajara' },
  { nombre_canonico: 'Meganoticias Jalisco', variantes: ['Meganoticias Jalisco', 'Meganoticias', 'Mega Noticias', 'Meganoticias.mx'], region: 'Jalisco', motivo_gap: 'Posible sección regional Jalisco de medio nacional' },
  { nombre_canonico: 'MURAL', variantes: ['MURAL', 'Mural Guadalajara'], region: 'Jalisco (Reforma)', motivo_gap: 'Paywall Grupo Reforma — histórico D_PAGO_CONVENIO_API' },
  { nombre_canonico: 'Reforma', variantes: ['Reforma'], region: 'Nacional (Reforma)', motivo_gap: 'Paywall Grupo Reforma — histórico D_PAGO_CONVENIO_API' },
  { nombre_canonico: 'UDG TV / Canal 44', variantes: ['UDG TV', 'Canal 44'], region: 'Jalisco', motivo_gap: 'ACTIVAR_EN_CRON: ya en catálogo, fuera de cron' },
  { nombre_canonico: 'Notisistema', variantes: ['Notisistema'], region: 'Jalisco', motivo_gap: 'ACTIVAR_EN_CRON: ya en catálogo, fuera de cron' },
  { nombre_canonico: 'Tráfico ZMG', variantes: ['Tráfico ZMG', 'Trafico ZMG'], region: 'Jalisco', motivo_gap: 'ACTIVAR_EN_CRON: ya en catálogo, fuera de cron' },
  { nombre_canonico: 'Vallarta Independiente', variantes: ['Vallarta Independiente'], region: 'Jalisco / Costa', motivo_gap: 'ACTIVAR_EN_CRON: ya en catálogo, fuera de cron' },
  { nombre_canonico: 'Partidero', variantes: ['Partidero'], region: 'Jalisco', motivo_gap: 'ACTIVAR_EN_CRON: ya en catálogo, fuera de cron' },
  { nombre_canonico: 'Semanario Conciencia Pública', variantes: ['Semanario Conciencia Pública', 'Conciencia Pública'], region: 'Jalisco', motivo_gap: 'AGREGAR_A_CATALOGO: en shadowMedia.ts pero pendiente insertar en Supabase' },
  { nombre_canonico: 'Página 24 Jalisco', variantes: ['Página 24 Jalisco', 'Pagina 24 Jalisco'], region: 'Jalisco', motivo_gap: 'AGREGAR_A_CATALOGO: en shadowMedia.ts pero pendiente insertar en Supabase' },
];

interface FilaAuditoria {
  nombre_canonico: string;
  region: string;
  motivo_gap: string;
  existe_en_catalogo: boolean;
  medio_id: string | null;
  nombre_encontrado: string | null;
  activo: boolean | null;
  metodo_extraccion: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  requiere_javascript: boolean | null;
  requiere_proxy: boolean | null;
  en_cron: boolean;
  tier_cron: string | null;
  configurado_en_shadowmedia_pero_no_en_db: boolean;
  probe_rss_ok: boolean | null;
  probe_sitemap_ok: boolean | null;
  probe_error: string | null;
  muestra_noticias: number;
  muestra_con_texto_limpio: number;
  captura_cuerpo_completo: boolean | null;
  recomendacion: string;
  riesgo: string;
}

function tierDe(medioId: string): string | null {
  if (SHADOW_MEDIOS.includes(medioId)) return 'BASE';
  if (SHADOW_MEDIOS_NACIONALES_B.some((m) => m.medio_id === medioId)) return 'NACIONAL_B';
  if (SHADOW_MEDIOS_CRISIS.some((m) => m.medio_id === medioId)) return 'CRISIS';
  if (SHADOW_MEDIOS_DAILY_VALIDATED.some((m) => m.medio_id === medioId)) return 'DAILY_VALIDATED';
  return null;
}

/** IDs listados en SHADOW_MEDIOS_DAILY_VALIDATED que NO corresponden a ningún medio_id real en catálogo. */
function idsConfiguradosSinCatalogo(idsExistentesEnDb: Set<string>): string[] {
  return SHADOW_MEDIOS_DAILY_VALIDATED
    .map((m) => m.medio_id)
    .filter((id) => !idsExistentesEnDb.has(id));
}

async function main() {
  const argv = process.argv.slice(2);
  const skipProbe = argv.includes('--skip-probe');

  logger.info({ fuentes: FUENTES_GAP.length, skipProbe }, '=== Auditoría de fuentes del gap Mery Pozos (read-only) ===');
  logger.info({}, 'Política: NO se agregan/evalúan keywords temáticas. Solo cobertura de fuentes + extracción de cuerpo completo.');

  const sb = getSupabase();
  const cronCompleto = mediosEnCualquierCron();

  // Todos los medio_id reales del catálogo (para detectar configs "huérfanas" en shadowMedia.ts).
  const { data: todosLosIds } = await sb.from('medios').select('medio_id');
  const idsExistentes = new Set(((todosLosIds ?? []) as Array<{ medio_id: string }>).map((r) => r.medio_id));
  const huerfanos = idsConfiguradosSinCatalogo(idsExistentes);
  if (huerfanos.length > 0) {
    logger.warn(
      { huerfanos },
      'ALERTA: medio_id configurados en SHADOW_MEDIOS_DAILY_VALIDATED que NO existen en Supabase — el cron no puede crawlearlos hasta insertarlos',
    );
  }

  const filas: FilaAuditoria[] = [];

  for (const candidata of FUENTES_GAP) {
    let encontrado: any = null;
    for (const variante of candidata.variantes) {
      const { data, error } = await sb
        .from('medios')
        .select(
          'medio_id, nombre_medio, activo, metodo_extraccion, rss_url, sitemap_url, requiere_javascript, requiere_proxy, url_base',
        )
        .ilike('nombre_medio', `%${variante}%`)
        .limit(1);
      if (!error && data && data.length > 0) {
        encontrado = data[0];
        break;
      }
    }

    const existeEnCatalogo = encontrado != null;
    const medioId: string | null = encontrado?.medio_id ?? null;
    const enCron = medioId ? cronCompleto.has(medioId) : false;
    const tier = medioId ? tierDe(medioId) : null;
    const configuradoPeroNoEnDb =
      candidata.nombre_canonico !== 'MURAL' &&
      candidata.nombre_canonico !== 'Reforma' &&
      SHADOW_MEDIOS_DAILY_VALIDATED.some((m) => m.nombre === candidata.nombre_canonico) &&
      !existeEnCatalogo;

    // ── Probe en vivo (opcional) ──────────────────────────────────────────
    let probeRssOk: boolean | null = null;
    let probeSitemapOk: boolean | null = null;
    let probeError: string | null = null;
    if (!skipProbe && encontrado && (encontrado.rss_url || encontrado.sitemap_url)) {
      try {
        const medioInput: MedioInput = {
          medio_id: encontrado.medio_id,
          nombre_medio: encontrado.nombre_medio,
          activo: Boolean(encontrado.activo),
          prioridad: null,
          metodo_extraccion: encontrado.metodo_extraccion ?? null,
          rss_url: encontrado.rss_url ?? null,
          sitemap_url: encontrado.sitemap_url ?? null,
          secciones_urls: null,
          buscador_url: null,
          requiere_javascript: Boolean(encontrado.requiere_javascript),
          requiere_proxy: Boolean(encontrado.requiere_proxy),
          url_base: encontrado.url_base ?? null,
        };
        const probe = await probeMedio(medioInput, 5);
        probeRssOk = medioInput.rss_url ? probe.rss_ok : null;
        probeSitemapOk = medioInput.sitemap_url ? probe.sitemap_ok : null;
        probeError = probe.error;
      } catch (err) {
        probeError = err instanceof Error ? err.message : String(err);
      }
    }

    // ── Muestra de cuerpo completo (si existe en catálogo) ────────────────
    let muestraNoticias = 0;
    let muestraConTexto = 0;
    let capturaCuerpoCompleto: boolean | null = null;
    if (existeEnCatalogo && medioId) {
      const { data: noticiasSample, error: errNoticias } = await sb
        .from('noticias')
        .select('texto_nota_limpia, texto_cuerpo_nota, texto_extraido')
        .eq('medio_id', medioId)
        .order('fecha_publicacion', { ascending: false })
        .limit(20);
      if (!errNoticias && noticiasSample) {
        muestraNoticias = noticiasSample.length;
        muestraConTexto = (noticiasSample as any[]).filter((n) =>
          Boolean((n.texto_nota_limpia ?? n.texto_cuerpo_nota ?? n.texto_extraido ?? '').toString().trim().length > 100),
        ).length;
        capturaCuerpoCompleto = muestraNoticias > 0 ? muestraConTexto === muestraNoticias : null;
      }
    }

    // ── Recomendación / riesgo ─────────────────────────────────────────────
    let recomendacion: string;
    let riesgo: string;
    if (candidata.nombre_canonico === 'MURAL' || candidata.nombre_canonico === 'Reforma') {
      recomendacion = 'D_PAGO_CONVENIO_API / NO_SCRAPE — paywall Grupo Reforma, requiere convenio comercial. No hacer bypass/proxy.';
      riesgo = 'Bajo (no se toca) — alto si se intentara scrapear sin autorización (legal/técnico).';
    } else if (configuradoPeroNoEnDb) {
      recomendacion = `PENDIENTE_INSERT_DB — está en src/config/shadowMedia.ts (cron DAILY_VALIDATED) pero el medio_id NO existe en Supabase. Ejecutar catalog-mery-jalisco-priority --upsert para insertarlo antes de que el cron pueda capturarlo.`;
      riesgo = 'Alto (silencioso) — el cron corre "verde" pero no captura nada de esta fuente hasta insertar la fila.';
    } else if (!existeEnCatalogo) {
      recomendacion = 'NO_EN_CATALOGO — no se encontró por nombre en Supabase. Verificar existencia real del medio y, si aplica, evaluar AGREGAR_A_CATALOGO con RSS/sitemap público.';
      riesgo = 'Medio: requiere investigación de URL/fuente antes de catalogar.';
    } else if (existeEnCatalogo && !enCron) {
      recomendacion = `ACTIVAR_EN_CRON — ya existe en catálogo (medio_id=${medioId}, activo=${encontrado.activo}) pero no está en ningún tier de cron shadow. Agregar a SHADOW_MEDIOS_DAILY_VALIDATED con --patch-shadowmedia tras confirmar viabilidad.`;
      riesgo = capturaCuerpoCompleto === false ? 'Medio — extracción de cuerpo incompleta en muestra reciente, revisar extractor antes de subir volumen.' : 'Bajo — activo en catálogo, solo falta cron.';
    } else if (existeEnCatalogo && enCron && capturaCuerpoCompleto === false) {
      recomendacion = `CALIDAD — en cron (tier=${tier}) pero cuerpo completo incompleto en la muestra reciente (${muestraConTexto}/${muestraNoticias}). Revisar extractor antes de confiar en detección fuera de título.`;
      riesgo = 'Medio — puede perder menciones que solo aparecen en cuerpo, no en título.';
    } else if (existeEnCatalogo && enCron) {
      recomendacion = `OK_EN_CRON — activo, en tier=${tier}, cuerpo completo ${muestraNoticias > 0 ? 'OK' : 'sin muestra reciente'}.`;
      riesgo = 'Bajo.';
    } else {
      recomendacion = 'REVISAR_MANUALMENTE — estado no concluyente con los datos disponibles.';
      riesgo = 'Medio.';
    }

    filas.push({
      nombre_canonico: candidata.nombre_canonico,
      region: candidata.region,
      motivo_gap: candidata.motivo_gap,
      existe_en_catalogo: existeEnCatalogo,
      medio_id: medioId,
      nombre_encontrado: encontrado?.nombre_medio ?? null,
      activo: encontrado ? Boolean(encontrado.activo) : null,
      metodo_extraccion: encontrado?.metodo_extraccion ?? null,
      rss_url: encontrado?.rss_url ?? null,
      sitemap_url: encontrado?.sitemap_url ?? null,
      requiere_javascript: encontrado ? Boolean(encontrado.requiere_javascript) : null,
      requiere_proxy: encontrado ? Boolean(encontrado.requiere_proxy) : null,
      en_cron: enCron,
      tier_cron: tier,
      configurado_en_shadowmedia_pero_no_en_db: configuradoPeroNoEnDb,
      probe_rss_ok: probeRssOk,
      probe_sitemap_ok: probeSitemapOk,
      probe_error: probeError,
      muestra_noticias: muestraNoticias,
      muestra_con_texto_limpio: muestraConTexto,
      captura_cuerpo_completo: capturaCuerpoCompleto,
      recomendacion,
      riesgo,
    });

    logger.info(
      {
        medio_id: medioId,
        existe_en_catalogo: existeEnCatalogo,
        activo: encontrado ? Boolean(encontrado.activo) : null,
        en_cron: enCron,
        tier,
        probe_rss_ok: probeRssOk,
        probe_sitemap_ok: probeSitemapOk,
        cuerpo_completo: capturaCuerpoCompleto,
        recomendacion,
      },
      `[fuente] ${candidata.nombre_canonico}`,
    );
  }

  // ── Resumen ──────────────────────────────────────────────────────────────
  const ok = filas.filter((f) => f.recomendacion.startsWith('OK_EN_CRON')).length;
  const activarEnCron = filas.filter((f) => f.recomendacion.startsWith('ACTIVAR_EN_CRON')).length;
  const pendienteInsert = filas.filter((f) => f.recomendacion.startsWith('PENDIENTE_INSERT_DB')).length;
  const noViable = filas.filter((f) => f.recomendacion.startsWith('D_PAGO_CONVENIO_API')).length;
  const noEnCatalogo = filas.filter((f) => f.recomendacion.startsWith('NO_EN_CATALOGO')).length;
  const calidad = filas.filter((f) => f.recomendacion.startsWith('CALIDAD')).length;

  logger.info(
    { total: filas.length, ok, activarEnCron, pendienteInsert, noViable, noEnCatalogo, calidad },
    '=== Resumen auditoría fuentes gap Mery ===',
  );
  logger.info({}, 'Read-only completado — sin cambios en Supabase, Sheets ni cron. No se agregaron keywords temáticas.');

  return filas;
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { main, FUENTES_GAP };
export type { FilaAuditoria };
