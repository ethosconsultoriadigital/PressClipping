/**
 * Cloudflare Worker — endpoint /read-xml (Fase 6+).
 *
 * Sirve por HTTP el XML propio tipo PressClipping, filtrable, leyendo desde
 * Supabase. Reutiliza la MISMA lógica pura del motor (generarXml, filtros y
 * mapeo de menciones), de modo que la salida HTTP es idéntica a la del script
 * `generate-xml`.
 *
 * Seguridad: protegido por XML_SECRET_TOKEN (header `Authorization: Bearer`
 * o `?token=`). Sin token configurado, el endpoint responde 500 (no abre datos).
 *
 * Ejemplos:
 *   GET /read-xml?token=...&cliente=Jumex
 *   GET /read-xml?token=...&keyword=tequila&desde=2026-06-01&hasta=2026-06-05
 *   GET /read-xml  (con header Authorization: Bearer <token>)
 *   GET /health    (sin auth; sonda de salud)
 */
import { createClient } from '@supabase/supabase-js';
import { generarXml, type FiltrosXml } from '../../src/exporters/xml.js';
import { SELECT_MENCION_EXPORT, mapMencionExport } from '../../src/types/mencion.js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  XML_SECRET_TOKEN: string;
}

const MAX_LIMIT = 5000;

function unauthorized(): Response {
  return new Response('No autorizado', {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function tokenValido(request: Request, env: Env): boolean {
  if (!env.XML_SECRET_TOKEN) return false;
  const url = new URL(request.url);
  const qToken = url.searchParams.get('token') ?? '';
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return qToken === env.XML_SECRET_TOKEN || bearer === env.XML_SECRET_TOKEN;
}

function parseFiltros(url: URL): FiltrosXml {
  const get = (k: string) => {
    const v = url.searchParams.get(k);
    return v && v.trim() !== '' ? v : undefined;
  };
  return {
    cliente: get('cliente'),
    keyword: get('keyword'),
    medio: get('medio'),
    region: get('region'),
    estadoRevision: get('estado_revision'),
    desde: get('desde'),
    hasta: get('hasta'),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Sonda de salud sin autenticación.
    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    if (request.method !== 'GET') {
      return new Response('Método no permitido', { status: 405 });
    }
    if (url.pathname !== '/read-xml' && url.pathname !== '/') {
      return new Response('No encontrado', { status: 404 });
    }

    if (!env.XML_SECRET_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return new Response('Endpoint no configurado (faltan secrets).', { status: 500 });
    }
    if (!tokenValido(request, env)) return unauthorized();

    const filtros = parseFiltros(url);
    const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
      : MAX_LIMIT;

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase
      .from('menciones')
      .select(SELECT_MENCION_EXPORT)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return new Response(`Error consultando datos: ${error.message}`, { status: 502 });
    }

    const rows = (data ?? []).map(mapMencionExport);
    const { xml, total } = generarXml(rows, filtros);

    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'x-total-notas': String(total),
        'cache-control': 'no-store',
      },
    });
  },
};
