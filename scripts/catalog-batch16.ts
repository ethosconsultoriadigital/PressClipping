/**
 * Alta: 17 medios — DISCOVERY V3 BATCH 8.
 * P1/P2 geo + verticales PR STRICT. IDs tras MAX LIVE MED-0562.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import type { Medio } from '../src/types/schemas.js';

function baseMedio(partial: {
  medio_id: string;
  nombre_medio: string;
  url_base: string;
  estado: string;
  categoria?: string;
  metodo_extraccion: 'RSS' | 'SITEMAP';
  rss_url: string | null;
  sitemap_url: string | null;
  notas_tecnicas: string;
}): Medio {
  return {
    medio_id: partial.medio_id,
    nombre_medio: partial.nombre_medio,
    grupo_medio: null,
    url_base: partial.url_base,
    pais: 'MX',
    estado: partial.estado,
    municipio: null,
    region: null,
    categoria: partial.categoria ?? 'Noticias',
    prioridad: 'Alta',
    activo: true,
    metodo_extraccion: partial.metodo_extraccion,
    rss_url: partial.rss_url,
    sitemap_url: partial.sitemap_url,
    secciones_urls: null,
    buscador_url: null,
    requiere_javascript: false,
    requiere_proxy: false,
    frecuencia_minutos: 360,
    notas_tecnicas: partial.notas_tecnicas,
  };
}

const NOTA = 'Alta 2026-10-01 (DISCOVERY V3 BATCH 8). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH16: Medio[] = [
  baseMedio({ medio_id: 'MED-0563', nombre_medio: 'Ecos de la Costa', url_base: 'https://ecosdelacosta.mx', estado: 'Colima', metodo_extraccion: 'RSS', rss_url: 'https://ecosdelacosta.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Gap P1 Colima.` }),
  baseMedio({ medio_id: 'MED-0564', nombre_medio: 'Zona Centro Noticias', url_base: 'https://www.zonacentronoticias.com', estado: 'Morelos', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://www.zonacentronoticias.com/wp-sitemap.xml', notas_tecnicas: `${NOTA} wp-sitemap. Gap P2 Morelos.` }),
  baseMedio({ medio_id: 'MED-0565', nombre_medio: 'Oaxaca Entre Líneas', url_base: 'https://oaxacaentrelineas.com', estado: 'Oaxaca', metodo_extraccion: 'RSS', rss_url: 'https://oaxacaentrelineas.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Gap P2 Oaxaca.` }),
  baseMedio({ medio_id: 'MED-0566', nombre_medio: 'Oro Radio SLP', url_base: 'https://www.ororadio.com.mx', estado: 'San Luis Potosí', metodo_extraccion: 'RSS', rss_url: 'https://www.ororadio.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Gap SLP.` }),
  baseMedio({ medio_id: 'MED-0567', nombre_medio: 'Cambio de Michoacán', url_base: 'https://cambiodemichoacan.com.mx', estado: 'Michoacán', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://cambiodemichoacan.com.mx/post-sitemap.xml', notas_tecnicas: `${NOTA} post-sitemap (no sitemap_index: 8 archivos Yoast). Gap P2 Michoacán.` }),
  baseMedio({ medio_id: 'MED-0568', nombre_medio: 'World Energy Trade', url_base: 'https://www.worldenergytrade.com', estado: 'Nacional', categoria: 'Energía', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://www.worldenergytrade.com/sitemap_index.xml', notas_tecnicas: `${NOTA} sitemap_index. Vertical energía.` }),
  baseMedio({ medio_id: 'MED-0569', nombre_medio: 'Energy21', url_base: 'https://energy21.com.mx', estado: 'Nacional', categoria: 'Energía', metodo_extraccion: 'RSS', rss_url: 'https://energy21.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical energía MX.` }),
  baseMedio({ medio_id: 'MED-0570', nombre_medio: 'Autoexplora', url_base: 'https://autoexplora.com', estado: 'Nacional', categoria: 'Automotriz', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://autoexplora.com/sitemap.xml', notas_tecnicas: `${NOTA} Sitemap. Vertical automotriz.` }),
  baseMedio({ medio_id: 'MED-0571', nombre_medio: 'Motorpasión México', url_base: 'https://www.motorpasion.com.mx', estado: 'Nacional', categoria: 'Automotriz', metodo_extraccion: 'RSS', rss_url: 'https://www.motorpasion.com.mx/feedburner.xml', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical automotriz MX.` }),
  baseMedio({ medio_id: 'MED-0572', nombre_medio: 'Storecheck', url_base: 'https://www.storecheck.com', estado: 'Nacional', categoria: 'Retail', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://www.storecheck.com/sitemap_index.xml', notas_tecnicas: `${NOTA} sitemap_index. Vertical retail/shopper.` }),
  baseMedio({ medio_id: 'MED-0573', nombre_medio: 'Canacar Noticias', url_base: 'https://canacar.com.mx', estado: 'Nacional', categoria: 'Logística', metodo_extraccion: 'RSS', rss_url: 'https://canacar.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical autotransporte (gremio con inventario editorial).` }),
  baseMedio({ medio_id: 'MED-0574', nombre_medio: 'PV Magazine México', url_base: 'https://www.pv-magazine-mexico.com', estado: 'Nacional', categoria: 'Energía', metodo_extraccion: 'RSS', rss_url: 'https://www.pv-magazine-mexico.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical solar MX.` }),
  baseMedio({ medio_id: 'MED-0575', nombre_medio: 'Revista Fortuna', url_base: 'https://revistafortuna.com.mx', estado: 'Nacional', categoria: 'Negocios', metodo_extraccion: 'RSS', rss_url: 'https://revistafortuna.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical negocios.` }),
  baseMedio({ medio_id: 'MED-0576', nombre_medio: 'Autotransporte.mx', url_base: 'https://www.autotransporte.mx', estado: 'Nacional', categoria: 'Logística', metodo_extraccion: 'RSS', rss_url: 'https://www.autotransporte.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical autotransporte.` }),
  baseMedio({ medio_id: 'MED-0577', nombre_medio: 'Computerworld México', url_base: 'https://computerworldmexico.com.mx', estado: 'Nacional', categoria: 'Tecnología', metodo_extraccion: 'RSS', rss_url: 'https://computerworldmexico.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical TI.` }),
  baseMedio({ medio_id: 'MED-0578', nombre_medio: 'Infochannel', url_base: 'https://infochannel.info', estado: 'Nacional', categoria: 'Tecnología', metodo_extraccion: 'RSS', rss_url: 'https://infochannel.info/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical TI/canal.` }),
  baseMedio({ medio_id: 'MED-0579', nombre_medio: 'BM Editores', url_base: 'https://bmeditores.mx', estado: 'Nacional', categoria: 'Agroindustria', metodo_extraccion: 'RSS', rss_url: 'https://bmeditores.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical agroindustria.` }),
];

function hostOf(u: string | null | undefined): string {
  if (!u) return '';
  try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}
function sourceUrl(m: Medio): string {
  return (m.rss_url ?? m.sitemap_url ?? '').replace(/\/+$/, '').toLowerCase();
}

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();
  const ids = MEDIOS_BATCH16.map((m) => m.medio_id);
  const { data: all, error: errAll } = await sb.from('medios').select('medio_id,nombre_medio,url_base,rss_url,sitemap_url');
  if (errAll) { console.error(errAll.message); process.exit(1); }
  const existing = all ?? [];
  const nums = existing.map((r) => Number(String(r.medio_id).replace(/^MED-/, ''))).filter((n) => Number.isFinite(n));
  const max = Math.max(0, ...nums);
  for (const id of ids) {
    const n = Number(id.replace(/^MED-/, ''));
    if (existing.some((e) => e.medio_id === id)) { console.error(`ABORT: ID ya existe ${id}`); process.exit(2); }
    if (n <= max) { console.error(`ABORT: ID ${id} no es posterior a MAX LIVE MED-${String(max).padStart(4, '0')}`); process.exit(2); }
  }
  const loteHosts = new Set(MEDIOS_BATCH16.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH16.length) { console.error('ABORT: hosts duplicados'); process.exit(2); }
  const loteFeeds = new Set(MEDIOS_BATCH16.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH16.length) { console.error('ABORT: feeds duplicados'); process.exit(2); }
  const collisions: { host: string; existing: string; nombre: string }[] = [];
  for (const e of existing) {
    const hs = [hostOf(e.url_base), hostOf(e.rss_url), hostOf(e.sitemap_url)].filter(Boolean);
    for (const h of loteHosts) if (hs.includes(h)) collisions.push({ host: h, existing: e.medio_id, nombre: e.nombre_medio });
  }
  console.log(JSON.stringify({ dry, ids, max_existing: `MED-${String(max).padStart(4, '0')}`, collisions }, null, 2));
  if (collisions.length) { console.error('ABORT: duplicate domain vs LIVE'); process.exit(2); }
  if (dry) {
    console.log(MEDIOS_BATCH16.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH16, { onConflict: 'medio_id' });
  if (errUpsert) { console.error(errUpsert.message); process.exit(1); }
  const { data: verif } = await sb.from('medios').select('medio_id,nombre_medio,activo').in('medio_id', ids).order('medio_id');
  console.log('upserted', verif?.length);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
