/**
 * FASE 7 (Emergency PressClipping Replacement) — Readiness operativo SIN PressClipping.
 *
 * SOLO LECTURA. Reemplaza el comparativo Ethos-vs-PressClipping (ya no disponible)
 * por una métrica de readiness basada 100% en datos propios: keywords activas,
 * medios en cron, texto limpio, actividad de noticias/menciones por cliente.
 *
 * Uso:
 *   npm run audit-operational-readiness-no-pc
 *   npm run audit-operational-readiness-no-pc -- --client=CLI-0002
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

interface Args { clientId?: string; }
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'client' && val) out.clientId = val;
  }
  return out;
}

type EstadoOperativo =
  | 'OPERATIVO_INTERNO'
  | 'OPERATIVO_PARCIAL'
  | 'NECESITA_COBERTURA'
  | 'NECESITA_TEXTO_LIMPIO'
  | 'NO_LISTO';

function estadoYPorcentaje(opts: {
  keywordsActivas: number;
  mediosEnCron: number;
  textoOkPct: number;
  errores: number;
  detectFunciona: boolean;
  menciones7d: number;
}): { estado: EstadoOperativo; porcentaje: number } {
  const { keywordsActivas, mediosEnCron, textoOkPct, errores, detectFunciona, menciones7d } = opts;

  if (keywordsActivas === 0 || !detectFunciona) {
    return { estado: 'NO_LISTO', porcentaje: 0 };
  }
  if (textoOkPct < 40) {
    return { estado: 'NECESITA_TEXTO_LIMPIO', porcentaje: 25 };
  }
  if (mediosEnCron < 10) {
    return { estado: 'NECESITA_COBERTURA', porcentaje: 40 };
  }
  const criteriosInterno =
    keywordsActivas > 0 &&
    mediosEnCron >= 20 &&
    textoOkPct >= 70 &&
    errores === 0 &&
    detectFunciona;

  if (criteriosInterno) {
    return { estado: 'OPERATIVO_INTERNO', porcentaje: menciones7d > 0 ? 90 : 75 };
  }
  return { estado: 'OPERATIVO_PARCIAL', porcentaje: 60 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();

  logger.info({ filtroCliente: args.clientId ?? null }, '=== Readiness operativo SIN PressClipping (SOLO LECTURA) ===');

  const { data: clientesRaw, error: errCli } = await sb
    .from('clientes')
    .select('cliente_id, nombre_cliente, activo');
  if (errCli) { logger.error({ error: errCli.message }, 'Error leyendo clientes'); process.exit(1); }
  let clientes = (clientesRaw ?? []) as any[];
  if (args.clientId) clientes = clientes.filter((c) => c.cliente_id === args.clientId);

  const { data: keywordsRaw, error: errKw } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, activa');
  if (errKw) { logger.error({ error: errKw.message }, 'Error leyendo keywords'); process.exit(1); }
  const keywords = (keywordsRaw ?? []) as any[];

  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: mencionesRaw, error: errMen } = await sb
    .from('menciones')
    .select('cliente_id, noticia_id, created_at, noticias(medio_id, texto_cuerpo_nota, texto_nota_limpia, texto_extraido)')
    .gte('created_at', hace7d)
    .limit(5000);
  if (errMen) { logger.error({ error: errMen.message }, 'Error leyendo menciones'); process.exit(1); }
  const menciones = (mencionesRaw ?? []) as any[];

  const cronSet = new Set<string>([
    ...SHADOW_MEDIOS,
    ...SHADOW_MEDIOS_NACIONALES_B.map((m) => m.medio_id),
    ...SHADOW_MEDIOS_CRISIS.map((m) => m.medio_id),
    ...SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id),
  ]);

  const { data: noticiasRaw, error: errNot } = await sb
    .from('noticias')
    .select('noticia_id, medio_id, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_extraido')
    .gte('fecha_publicacion', hace7d)
    .limit(10000);
  if (errNot) { logger.error({ error: errNot.message }, 'Error leyendo noticias'); process.exit(1); }
  const noticias = (noticiasRaw ?? []) as any[];

  const resultados: any[] = [];

  for (const c of clientes) {
    const kwCliente = keywords.filter((k) => k.cliente_id === c.cliente_id);
    const kwActivas = kwCliente.filter((k) => k.activa === true);
    const menCliente = menciones.filter((m) => m.cliente_id === c.cliente_id);
    const men24h = menCliente.filter((m) => m.created_at >= hace24h);

    // Medios donde han caído menciones de este cliente (proxy de "medios relevantes en cron").
    const mediosConMencion = new Set(
      menCliente.map((m) => m.noticias?.medio_id).filter((id): id is string => Boolean(id)),
    );
    const mediosEnCronRelevantes = [...cronSet].length; // cron global; sin filtro específico por keyword aún.

    const conTexto = menCliente.filter((m) => {
      const n = m.noticias;
      return n && (n.texto_cuerpo_nota || n.texto_nota_limpia || n.texto_extraido);
    });
    const textoOkPct = menCliente.length > 0 ? Math.round((conTexto.length / menCliente.length) * 1000) / 10 : 0;

    const noticiasCliente7d = noticias.filter((n) => mediosConMencion.has(n.medio_id));
    const noticias24h = noticiasCliente7d.filter((n) => n.fecha_publicacion >= hace24h);

    const dedupeRate = 0; // placeholder: requiere comparar hash_url antes/después; insertMenciones ya es idempotente por (noticia_id, keyword_id).
    const erroresMedios = 0; // placeholder: requiere cruce con medios.ultimo_estado, se reporta en audit-owned-media-coverage.

    const ultimaMencion = menCliente.length > 0
      ? menCliente.reduce((mx: string, m: any) => (m.created_at > mx ? m.created_at : mx), menCliente[0].created_at)
      : null;

    const { estado, porcentaje } = estadoYPorcentaje({
      keywordsActivas: kwActivas.length,
      mediosEnCron: mediosEnCronRelevantes,
      textoOkPct,
      errores: erroresMedios,
      detectFunciona: kwActivas.length > 0,
      menciones7d: menCliente.length,
    });

    const fila = {
      cliente_id: c.cliente_id,
      cliente_nombre: c.nombre_cliente,
      keywords_activas: kwActivas.length,
      medios_en_cron: mediosEnCronRelevantes,
      medios_con_texto_ok: mediosConMencion.size,
      noticias_24h: noticias24h.length,
      noticias_7d: noticiasCliente7d.length,
      menciones_24h: men24h.length,
      menciones_7d: menCliente.length,
      ultima_mencion: ultimaMencion,
      texto_ok_pct: textoOkPct,
      dedupe_rate: dedupeRate,
      errores_medios: erroresMedios,
      estado_operativo: estado,
      porcentaje_ready: porcentaje,
    };
    resultados.push(fila);
    logger.info(fila, '[readiness-no-pc] cliente');
  }

  logger.info(
    { nota: 'Métrica reemplaza al comparativo PressClipping (no disponible). SOLO LECTURA.' },
    '=== Fin readiness operativo sin PressClipping ===',
  );

  return resultados;
}

main().catch((e) => { console.error(e); process.exit(1); });
