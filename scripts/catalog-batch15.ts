/**
 * Alta: 25 medios — OVERNIGHT FACTORY V2 BATCH 7.
 * Pool: leftover STRICT PASS del probe 2026-09-30 (histórico/manual/vertical),
 * ya no cubiertos por Batch 6. IDs tras MAX LIVE (esperado MED-0538..0562).
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

const NOTA = 'Alta 2026-10-01 (OVERNIGHT FACTORY V2 BATCH 7). Pre-canary público STRICT. Sin cron masivo.';

export const MEDIOS_BATCH15: Medio[] = [
  baseMedio({ medio_id: 'MED-0538', nombre_medio: 'Revista Flow', url_base: 'https://revistaflow.com', estado: 'Nacional', metodo_extraccion: 'RSS', rss_url: 'https://revistaflow.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. 18 impactos históricos.` }),
  baseMedio({ medio_id: 'MED-0539', nombre_medio: 'NotiPress', url_base: 'https://notipress.mx', estado: 'Nacional', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://notipress.mx/sitemap.xml', notas_tecnicas: `${NOTA} Sitemap. 17 impactos históricos. Agencia con inventario web propio.` }),
  baseMedio({ medio_id: 'MED-0540', nombre_medio: 'Mi Punto de Vista', url_base: 'https://www.mipuntodevista.com.mx', estado: 'Nacional', metodo_extraccion: 'RSS', rss_url: 'https://www.mipuntodevista.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. 15 impactos históricos.` }),
  baseMedio({ medio_id: 'MED-0541', nombre_medio: 'Lo de Hoy México', url_base: 'https://lodehoy.com.mx', estado: 'Nacional', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://lodehoy.com.mx/sitemap.xml', notas_tecnicas: `${NOTA} Sitemap. 14 impactos históricos. Distinto de La de Hoy Querétaro (ladehoy.com.mx).` }),
  baseMedio({ medio_id: 'MED-0542', nombre_medio: 'Grupo Metrópoli', url_base: 'https://grupometropoli.net', estado: 'Nacional', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://grupometropoli.net/sitemap_index.xml', notas_tecnicas: `${NOTA} sitemap_index. MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0544', nombre_medio: 'Al Contacto', url_base: 'https://www.alcontacto.com.mx', estado: 'Nacional', metodo_extraccion: 'RSS', rss_url: 'https://www.alcontacto.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0545', nombre_medio: 'Grupo Hoy México', url_base: 'https://grupohoymexico.com', estado: 'Nacional', metodo_extraccion: 'RSS', rss_url: 'https://grupohoymexico.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0546', nombre_medio: 'Hola Polanco', url_base: 'https://www.holapolanco.com', estado: 'CDMX', metodo_extraccion: 'RSS', rss_url: 'https://www.holapolanco.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos. Local CDMX.` }),
  baseMedio({ medio_id: 'MED-0547', nombre_medio: 'El Demócrata', url_base: 'https://www.eldemocrata.com', estado: 'Nacional', metodo_extraccion: 'RSS', rss_url: 'https://www.eldemocrata.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0548', nombre_medio: 'Sureste Informa', url_base: 'https://suresteinforma.com', estado: 'Nacional', metodo_extraccion: 'RSS', rss_url: 'https://suresteinforma.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0549', nombre_medio: 'InStyle México', url_base: 'https://instyle.mx', estado: 'Nacional', categoria: 'Lifestyle', metodo_extraccion: 'RSS', rss_url: 'https://instyle.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos. Vertical lifestyle/PR.` }),
  baseMedio({ medio_id: 'MED-0550', nombre_medio: 'Sucesos de Veracruz', url_base: 'https://sucesosdeveracruz.com', estado: 'Veracruz', metodo_extraccion: 'RSS', rss_url: 'https://sucesosdeveracruz.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0551', nombre_medio: 'El Censal', url_base: 'https://elcensal.com', estado: 'Nacional', metodo_extraccion: 'RSS', rss_url: 'https://elcensal.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0552', nombre_medio: 'Gentleman México', url_base: 'https://gentleman.com.mx', estado: 'Nacional', categoria: 'Lifestyle', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://gentleman.com.mx/post-sitemap.xml', notas_tecnicas: `${NOTA} post-sitemap (no sitemap_index: mezclaba /tag y hubs). MANUAL_REVIEW 9 impactos.` }),
  baseMedio({ medio_id: 'MED-0553', nombre_medio: 'Nearshore Americas', url_base: 'https://nearshoreamericas.com', estado: 'Nacional', categoria: 'Negocios', metodo_extraccion: 'RSS', rss_url: 'https://nearshoreamericas.com/rss/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical nearshore/industria.` }),
  baseMedio({ medio_id: 'MED-0554', nombre_medio: 'Travel Report', url_base: 'https://www.travelreport.mx', estado: 'Nacional', categoria: 'Turismo', metodo_extraccion: 'RSS', rss_url: 'https://www.travelreport.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical turismo.` }),
  baseMedio({ medio_id: 'MED-0555', nombre_medio: 'Directo al Paladar México', url_base: 'https://www.directoalpaladar.com.mx', estado: 'Nacional', categoria: 'Gastronomía', metodo_extraccion: 'RSS', rss_url: 'https://www.directoalpaladar.com.mx/feedburner.xml', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical gastronomía MX.` }),
  baseMedio({ medio_id: 'MED-0556', nombre_medio: 'Revista IAlimentos', url_base: 'https://www.revistaialimentos.com', estado: 'Nacional', categoria: 'Alimentos', metodo_extraccion: 'RSS', rss_url: 'https://www.revistaialimentos.com/rss/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical alimentos.` }),
  baseMedio({ medio_id: 'MED-0557', nombre_medio: 'Energy & Commerce', url_base: 'https://energyandcommerce.com.mx', estado: 'Nacional', categoria: 'Energía', metodo_extraccion: 'RSS', rss_url: 'https://energyandcommerce.com.mx/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical energía.` }),
  baseMedio({ medio_id: 'MED-0558', nombre_medio: 'Mundo HVACR', url_base: 'https://www.mundohvacr.com', estado: 'Nacional', categoria: 'Negocios', metodo_extraccion: 'RSS', rss_url: 'https://www.mundohvacr.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical HVAC/industria.` }),
  baseMedio({ medio_id: 'MED-0559', nombre_medio: 'Adlatina', url_base: 'https://adlatina.com', estado: 'Nacional', categoria: 'Marketing', metodo_extraccion: 'SITEMAP', rss_url: null, sitemap_url: 'https://adlatina.com/sitemap.xml', notas_tecnicas: `${NOTA} Sitemap. Vertical publicidad LATAM con cobertura MX.` }),
  baseMedio({ medio_id: 'MED-0560', nombre_medio: 'Hospitales Magazine', url_base: 'https://revistahospitales.com', estado: 'Nacional', categoria: 'Salud', metodo_extraccion: 'RSS', rss_url: 'https://revistahospitales.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical salud/hospitales.` }),
  baseMedio({ medio_id: 'MED-0561', nombre_medio: 'Revista Magazzine', url_base: 'https://revistamagazzine.com', estado: 'Nacional', categoria: 'Negocios', metodo_extraccion: 'RSS', rss_url: 'https://revistamagazzine.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical autotransporte.` }),
  baseMedio({ medio_id: 'MED-0562', nombre_medio: 'Alianza Flotillera', url_base: 'https://alianzaflotillera.com', estado: 'Nacional', categoria: 'Negocios', metodo_extraccion: 'RSS', rss_url: 'https://alianzaflotillera.com/feed/', sitemap_url: null, notas_tecnicas: `${NOTA} RSS. Vertical flotillas/logística.` }),
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
  const ids = MEDIOS_BATCH15.map((m) => m.medio_id);
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
  const loteHosts = new Set(MEDIOS_BATCH15.map((m) => hostOf(m.url_base)).filter(Boolean));
  if (loteHosts.size !== MEDIOS_BATCH15.length) { console.error('ABORT: hosts duplicados'); process.exit(2); }
  const loteFeeds = new Set(MEDIOS_BATCH15.map(sourceUrl).filter(Boolean));
  if (loteFeeds.size !== MEDIOS_BATCH15.length) { console.error('ABORT: feeds duplicados'); process.exit(2); }
  const collisions: { host: string; existing: string; nombre: string }[] = [];
  for (const e of existing) {
    const hs = [hostOf(e.url_base), hostOf(e.rss_url), hostOf(e.sitemap_url)].filter(Boolean);
    for (const h of loteHosts) if (hs.includes(h)) collisions.push({ host: h, existing: e.medio_id, nombre: e.nombre_medio });
  }
  console.log(JSON.stringify({ dry, ids, max_existing: `MED-${String(max).padStart(4, '0')}`, collisions }, null, 2));
  if (collisions.length) { console.error('ABORT: duplicate domain vs LIVE'); process.exit(2); }
  if (dry) {
    console.log(MEDIOS_BATCH15.map((m) => `${m.medio_id}: ${m.nombre_medio} — ${m.rss_url ?? m.sitemap_url}`).join('\n'));
    return;
  }
  const { error: errUpsert } = await sb.from('medios').upsert(MEDIOS_BATCH15, { onConflict: 'medio_id' });
  if (errUpsert) { console.error(errUpsert.message); process.exit(1); }
  const { data: verif } = await sb.from('medios').select('medio_id,nombre_medio,activo').in('medio_id', ids).order('medio_id');
  console.log('upserted', verif?.length);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
