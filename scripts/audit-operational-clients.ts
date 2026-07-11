/**
 * FASE 1 (Emergency PressClipping Replacement) — Inventario de clientes y keywords.
 *
 * SOLO LECTURA. Lee `clientes`, `keywords` y `menciones` desde Supabase. No modifica
 * nada. Pensado para auditar el estado operativo real de cada cliente ahora que
 * Ethos opera SIN comparativo contra PressClipping.
 *
 * Uso:
 *   npm run audit-operational-clients
 *   npm run audit-operational-clients -- --client=CLI-0002
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';

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

type EstadoOperativo = 'OPERATIVO_INTERNO' | 'OPERATIVO_PARCIAL' | 'SIN_ACTIVIDAD' | 'INACTIVO';

function estadoOperativo(opts: {
  activo: boolean;
  keywordsActivas: number;
  menciones7d: number;
}): EstadoOperativo {
  if (!opts.activo) return 'INACTIVO';
  if (opts.keywordsActivas === 0) return 'SIN_ACTIVIDAD';
  if (opts.menciones7d > 0) return 'OPERATIVO_INTERNO';
  return 'OPERATIVO_PARCIAL';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();

  logger.info({ filtroCliente: args.clientId ?? null }, '=== Auditoría de clientes operativos (SOLO LECTURA) ===');

  const { data: clientesRaw, error: errCli } = await sb
    .from('clientes')
    .select('cliente_id, nombre_cliente, industria, activo, alertas_activas');
  if (errCli) { logger.error({ error: errCli.message }, 'Error leyendo clientes'); process.exit(1); }

  let clientes = clientesRaw ?? [];
  if (args.clientId) clientes = clientes.filter((c: any) => c.cliente_id === args.clientId);

  const { data: keywordsRaw, error: errKw } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, activa, alerta');
  if (errKw) { logger.error({ error: errKw.message }, 'Error leyendo keywords'); process.exit(1); }
  const keywords = keywordsRaw ?? [];

  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: mencionesRaw, error: errMen } = await sb
    .from('menciones')
    .select('cliente_id, created_at')
    .gte('created_at', hace7d)
    .limit(5000);
  if (errMen) { logger.error({ error: errMen.message }, 'Error leyendo menciones'); process.exit(1); }
  const menciones = mencionesRaw ?? [];

  logger.info({ clientes: clientes.length, keywords: keywords.length, menciones_7d: menciones.length }, 'Datos cargados');

  for (const c of clientes as any[]) {
    const kwCliente = keywords.filter((k: any) => k.cliente_id === c.cliente_id);
    const kwActivas = kwCliente.filter((k: any) => k.activa === true);
    const reqAlerta = kwCliente.filter((k: any) => k.alerta === true);
    const menCliente = menciones.filter((m: any) => m.cliente_id === c.cliente_id);
    const men24h = menCliente.filter((m: any) => m.created_at >= hace24h);
    const ultimaMencion = menCliente.length > 0
      ? menCliente.reduce((max: string, m: any) => (m.created_at > max ? m.created_at : max), menCliente[0]?.created_at ?? '')
      : null;

    const estado = estadoOperativo({
      activo: c.activo === true,
      keywordsActivas: kwActivas.length,
      menciones7d: menCliente.length,
    });

    logger.info(
      {
        cliente_id: c.cliente_id,
        cliente_nombre: c.nombre_cliente,
        activo: c.activo,
        alertas_activas: c.alertas_activas,
        keywords_count: kwCliente.length,
        keywords_activas: kwActivas.length,
        requiere_alerta_count: reqAlerta.length,
        menciones_24h: men24h.length,
        menciones_7d: menCliente.length,
        ultima_mencion: ultimaMencion,
        estado_operativo: estado,
      },
      '[cliente]',
    );
  }

  logger.info({ nota: 'SOLO LECTURA — nada modificado.' }, '=== Fin auditoría clientes ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
