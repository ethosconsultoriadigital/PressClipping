/**
 * FASE 2 (Emergency PressClipping Replacement) — Inventario real de medios propios.
 *
 * SOLO LECTURA. Mide cuántos medios Ethos scrapea y lee correctamente SIN depender
 * de PressClipping. Combina `medios` (catálogo), cron config (`shadowMedia.ts`) y
 * `noticias` (actividad real 24h/7d + calidad de texto).
 *
 * Uso:
 *   npm run audit-owned-media-coverage
 *   npm run audit-owned-media-coverage -- --medio-ids=MED-0001,MED-0002
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import {
  SHADOW_MEDIOS,
  SHADOW_MEDIOS_NACIONALES_B,
  SHADOW_MEDIOS_CRISIS,
  SHADOW_MEDIOS_DAILY_VALIDATED,
} from '../src/config/shadowMedia.js';

interface Args { medioIds?: Set<string>; }
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'medio-ids') out.medioIds = new Set(val.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

function tierDe(medioId: string): string {
  if (SHADOW_MEDIOS.includes(medioId)) return 'base';
  if (SHADOW_MEDIOS_NACIONALES_B.some((m) => m.medio_id === medioId)) return 'nacional_b';
  if (SHADOW_MEDIOS_CRISIS.some((m) => m.medio_id === medioId)) return 'crisis';
  if (SHADOW_MEDIOS_DAILY_VALIDATED.some((m) => m.medio_id === medioId)) return 'daily_validated';
  return 'fuera_de_cron';
}

type EstadoMedio =
  | 'OPERATIVO_OK'
  | 'OPERATIVO_SIN_NOTICIAS'
  | 'OPERATIVO_TEXTO_MALO'
  | 'NECESITA_REENRICH'
  | 'NECESITA_REPARAR_FUENTE'
  | 'BLOQUEADO'
  | 'BAJO_VALOR';

function clasificarMedio(opts: {
  enCron: boolean;
  ultimoEstado: string | null;
  noticias7d: number;
  textoOkPct: number;
}): EstadoMedio {
  const estadoLower = (opts.ultimoEstado ?? '').toLowerCase();
  if (!opts.enCron) return 'BAJO_VALOR';
  if (estadoLower.includes('error') || estadoLower.includes('blocked') || estadoLower.includes('403')) return 'BLOQUEADO';
  if (opts.noticias7d === 0) return 'OPERATIVO_SIN_NOTICIAS';
  if (opts.textoOkPct < 30) return 'NECESITA_REENRICH';
  if (opts.textoOkPct < 70) return 'OPERATIVO_TEXTO_MALO';
  return 'OPERATIVO_OK';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();

  logger.info({}, '=== Auditoría de medios propios (SOLO LECTURA, sin PressClipping) ===');

  const { data: mediosRaw, error: errMed } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, url_base, activo, ultimo_estado, ultimo_scrapeo, requiere_proxy, requiere_javascript');
  if (errMed) { logger.error({ error: errMed.message }, 'Error leyendo medios'); process.exit(1); }
  let medios = (mediosRaw ?? []) as any[];
  if (args.medioIds) medios = medios.filter((m) => args.medioIds!.has(m.medio_id));

  const cronSet = new Set<string>([
    ...SHADOW_MEDIOS,
    ...SHADOW_MEDIOS_NACIONALES_B.map((m) => m.medio_id),
    ...SHADOW_MEDIOS_CRISIS.map((m) => m.medio_id),
    ...SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id),
  ]);

  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: noticiasRaw, error: errNot } = await sb
    .from('noticias')
    .select('medio_id, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_extraido')
    .gte('fecha_publicacion', hace7d)
    .limit(10000);
  if (errNot) { logger.error({ error: errNot.message }, 'Error leyendo noticias'); process.exit(1); }
  const noticias = (noticiasRaw ?? []) as any[];

  const porMedio = new Map<string, any[]>();
  for (const n of noticias) {
    const arr = porMedio.get(n.medio_id) ?? [];
    arr.push(n);
    porMedio.set(n.medio_id, arr);
  }

  let totalScrapeados24h = 0, totalConNoticias24h = 0, totalScrapeados7d = 0, totalConNoticias7d = 0;
  let totalTextoOk = 0, totalCuerpoVacio = 0, totalError = 0, totalBlocked = 0, totalReady = 0, totalRepairable = 0;
  const conteoEstados: Record<string, number> = {};

  for (const m of medios) {
    const enCron = cronSet.has(m.medio_id);
    const notasM = porMedio.get(m.medio_id) ?? [];
    const notas24h = notasM.filter((n) => n.fecha_publicacion >= hace24h);
    const conTexto = notasM.filter((n) => n.texto_cuerpo_nota || n.texto_nota_limpia || n.texto_extraido);
    const textoOkPct = notasM.length > 0 ? Math.round((conTexto.length / notasM.length) * 1000) / 10 : 0;
    const cuerpoVacioPct = notasM.length > 0 ? Math.round(((notasM.length - conTexto.length) / notasM.length) * 1000) / 10 : 0;

    if (notas24h.length > 0) { totalScrapeados24h++; totalConNoticias24h++; }
    if (notasM.length > 0) { totalScrapeados7d++; totalConNoticias7d++; }
    if (textoOkPct >= 70) totalTextoOk++;
    if (cuerpoVacioPct >= 70) totalCuerpoVacio++;

    const estado = clasificarMedio({ enCron, ultimoEstado: m.ultimo_estado, noticias7d: notasM.length, textoOkPct });
    conteoEstados[estado] = (conteoEstados[estado] ?? 0) + 1;
    if (estado === 'BLOQUEADO') totalError++;
    if (estado === 'OPERATIVO_OK') totalReady++;
    if (estado === 'NECESITA_REENRICH' || estado === 'NECESITA_REPARAR_FUENTE') totalRepairable++;

    logger.info(
      {
        medio_id: m.medio_id,
        nombre: m.nombre_medio,
        en_cron: enCron,
        tier: tierDe(m.medio_id),
        activo: m.activo,
        noticias_24h: notas24h.length,
        noticias_7d: notasM.length,
        ultima_noticia: notasM.length > 0 ? notasM.reduce((mx: string, n: any) => (n.fecha_publicacion > mx ? n.fecha_publicacion : mx), notasM[0].fecha_publicacion) : null,
        texto_ok_pct: textoOkPct,
        cuerpo_vacio_pct: cuerpoVacioPct,
        ultimo_estado: m.ultimo_estado,
        estado_clasificado: estado,
      },
      '[medio]',
    );
  }

  logger.info(
    {
      total_medios_catalogo: medios.length,
      total_medios_activos: medios.filter((m) => m.activo).length,
      total_medios_en_cron: medios.filter((m) => cronSet.has(m.medio_id)).length,
      total_medios_scrapeados_24h: totalScrapeados24h,
      total_medios_con_noticias_24h: totalConNoticias24h,
      total_medios_scrapeados_7d: totalScrapeados7d,
      total_medios_con_noticias_7d: totalConNoticias7d,
      total_medios_texto_ok: totalTextoOk,
      total_medios_cuerpo_vacio: totalCuerpoVacio,
      medios_error: totalError,
      medios_ready: totalReady,
      medios_repairable: totalRepairable,
      conteo_por_estado: conteoEstados,
    },
    '=== RESUMEN cobertura de medios propios ===',
  );

  logger.info({ nota: 'SOLO LECTURA — nada modificado.' }, '=== Fin auditoría medios ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
