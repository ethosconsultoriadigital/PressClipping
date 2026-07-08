/**
 * Agrupación de alertas P1 en DIGESTS (anti-fatiga). LÓGICA PURA (sin red/DB).
 *
 * Problema: una misma crisis (p.ej. "alcohol adulterado en Guanajuato") produce
 * muchas P1 casi idénticas. Enviarlas sueltas satura al receptor. Este módulo
 * agrupa P1 del MISMO cliente que comparten familia de crisis + región + ventana
 * reciente en un solo cluster (digest).
 *
 * Reglas duras:
 *   - NUNCA agrupa clientes distintos (clave incluye cliente_id).
 *   - NUNCA agrupa severidades distintas (clave incluye severidad); P2 no entra.
 *   - Crisis distintas (familia distinta) o regiones distintas → clusters aparte.
 *   - Un cluster puede ser de tamaño 1 (alerta sin pares) — no se pierde nada.
 */
import { createHash } from 'node:crypto';
import type { InternalAlert, Severidad } from './types.js';

/** Familias de keyword de la crisis de bebidas (sinónimos que unifican cluster). */
export const CRISIS_FAMILY_PATTERNS: { familia: string; re: RegExp }[] = [
  { familia: 'metanol', re: /\bmetanol\b/i },
  { familia: 'tequila_adulterado', re: /tequila\s+adulterad/i },
  { familia: 'bebidas_adulteradas', re: /bebidas?\s+adulterad/i },
  { familia: 'alcohol_adulterado', re: /alcohol\s+(adulterad|il[ií]cit|ap[oó]crif)/i },
  { familia: 'intoxicacion_alcohol', re: /intoxicaci[oó]n\s+(por\s+)?(alcohol|metanol|bebida)/i },
];

/** Etiqueta canónica de la familia crisis (unifica sinónimos para clustering). */
export const FAMILIA_CRISIS_BEBIDAS = 'crisis_bebidas_adulteradas';

/** Zonas conocidas → bucket de región (para no mezclar crisis de estados distintos). */
const ZONA_A_REGION: { re: RegExp; zona: string; region: string }[] = [
  { re: /\birapuato\b/i, zona: 'Irapuato', region: 'guanajuato' },
  { re: /\bsalamanca\b/i, zona: 'Salamanca', region: 'guanajuato' },
  { re: /\bcelaya\b/i, zona: 'Celaya', region: 'guanajuato' },
  { re: /\ble[oó]n\b/i, zona: 'León', region: 'guanajuato' },
  { re: /\bguanajuato\b/i, zona: 'Guanajuato', region: 'guanajuato' },
  { re: /\bjalisco\b/i, zona: 'Jalisco', region: 'jalisco' },
  { re: /\bguadalajara\b/i, zona: 'Guadalajara', region: 'jalisco' },
];

/** Devuelve las familias crisis detectadas en un texto (título/keyword). */
export function detectCrisisFamilies(text: string): string[] {
  const t = String(text ?? '');
  const out: string[] = [];
  for (const { familia, re } of CRISIS_FAMILY_PATTERNS) {
    if (re.test(t)) out.push(familia);
  }
  return out;
}

/** ¿La alerta pertenece a la familia de crisis de bebidas? */
export function esFamiliaCrisisBebidas(alert: InternalAlert): boolean {
  const blob = `${alert.keyword} ${alert.titulo} ${alert.razon}`;
  return detectCrisisFamilies(blob).length > 0 || /crisis_bebidas/i.test(alert.razon);
}

/** Zonas detectadas (canónicas) en un texto, sin duplicar. */
export function detectZonas(text: string): string[] {
  const t = String(text ?? '');
  const zonas: string[] = [];
  for (const { re, zona } of ZONA_A_REGION) {
    if (re.test(t) && !zonas.includes(zona)) zonas.push(zona);
  }
  return zonas;
}

/** Bucket de región a partir de las zonas detectadas ('nacional' si ninguna conocida). */
export function regionBucket(text: string): string {
  const t = String(text ?? '');
  for (const { re, region } of ZONA_A_REGION) {
    if (re.test(t)) return region;
  }
  return 'nacional';
}

export interface DigestCluster {
  cluster_id: string;
  cliente_id: string;
  cliente: string;
  severidad: Severidad;
  /** Familia canónica (crisis unificada u 'otro:<keyword>'). */
  familia: string;
  /** Familias crisis específicas detectadas (para reporte). */
  familias_detectadas: string[];
  /** Zonas detectadas (unión del cluster). */
  zonas: string[];
  /** Etiqueta de región legible. */
  region: string;
  /** Título representativo (primera alerta del cluster). */
  titulo_cluster: string;
  alerts: InternalAlert[];
  count: number;
}

export interface GroupingResult {
  clusters: DigestCluster[];
  total: number;
  /** Alertas que quedaron en clusters de 2+ (agrupadas). */
  agrupadas: number;
  /** Clusters de tamaño 1 (sin par). */
  singletons: number;
  reduccion: { antes: number; despues: number };
}

const REGION_LABEL: Record<string, string> = {
  guanajuato: 'Guanajuato',
  jalisco: 'Jalisco',
  nacional: 'Nacional',
};

/** Entrada mínima para calcular el cluster de una alerta/mención cualquiera. */
export interface ClusterInput {
  cliente_id?: string | null;
  keyword?: string | null;
  titulo?: string | null;
  razon?: string | null;
  fecha_publicacion?: string | null;
}

/** Campos de cluster estables y auditables para 10_Alertas_Sombra. */
export interface ClusterFields {
  /** tema canónico: familia crisis unificada u 'otro:<keyword>'. */
  cluster_tema: string;
  /** región legible (Guanajuato / Jalisco / Nacional). */
  cluster_region: string;
  /** clave legible: cliente|tema|region|fecha_cluster. */
  cluster_key: string;
  /** id corto y estable (hash de cluster_key). */
  cluster_id: string;
}

/** Fecha_cluster (YYYY-MM-DD) a partir de una fecha ISO/`YYYY-MM-DD...`. */
function fechaCluster(fecha?: string | null): string {
  const s = String(fecha ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : '';
}

/**
 * Calcula el cluster de una alerta/mención de forma DETERMINÍSTICA.
 *
 * cluster_key = cliente_id | familia_keyword | region | fecha_cluster.
 * Para CLI-0002 crisis de bebidas unifica sinónimos (una sola familia); para el
 * resto usa `otro:<keyword>` (conservador: no mezcla clientes ni temas distintos).
 */
export function computeClusterFields(inp: ClusterInput): ClusterFields {
  const cliente = String(inp.cliente_id ?? '').trim() || 'SIN_CLIENTE';
  const blob = `${inp.keyword ?? ''} ${inp.titulo ?? ''} ${inp.razon ?? ''}`;
  const esCrisis = detectCrisisFamilies(blob).length > 0 || /crisis_bebidas/i.test(String(inp.razon ?? ''));
  const tema = esCrisis
    ? FAMILIA_CRISIS_BEBIDAS
    : `otro:${String(inp.keyword ?? '').trim().toLowerCase() || 'sin_keyword'}`;
  const regionKey = esCrisis ? regionBucket(blob) : 'nacional';
  const region = REGION_LABEL[regionKey] ?? regionKey;
  const fecha = fechaCluster(inp.fecha_publicacion);
  const cluster_key = `${cliente}|${tema}|${regionKey}|${fecha}`;
  const cluster_id = 'CL-' + createHash('sha1').update(cluster_key).digest('hex').slice(0, 10);
  return { cluster_tema: tema, cluster_region: region, cluster_key, cluster_id };
}

/**
 * Agrupa alertas en clusters para digest. Clave de cluster:
 *   cliente_id | severidad | familia | region
 * donde familia = FAMILIA_CRISIS_BEBIDAS si es crisis de bebidas, o
 * `otro:<keyword-normalizada>` en caso contrario (crisis distintas no se mezclan).
 */
export function groupAlertsForDigest(alerts: InternalAlert[]): GroupingResult {
  const mapa = new Map<string, DigestCluster>();

  for (const alert of alerts) {
    const blob = `${alert.keyword} ${alert.titulo} ${alert.razon}`;
    const esCrisis = esFamiliaCrisisBebidas(alert);
    const familia = esCrisis
      ? FAMILIA_CRISIS_BEBIDAS
      : `otro:${String(alert.keyword ?? '').trim().toLowerCase() || 'sin_keyword'}`;
    const region = esCrisis ? regionBucket(blob) : 'nacional';
    const key = `${alert.cliente_id}|${alert.severidad}|${familia}|${region}`;

    let cluster = mapa.get(key);
    if (!cluster) {
      cluster = {
        cluster_id: key,
        cliente_id: alert.cliente_id,
        cliente: alert.cliente,
        severidad: alert.severidad,
        familia,
        familias_detectadas: [],
        zonas: [],
        region: REGION_LABEL[region] ?? region,
        titulo_cluster: alert.titulo,
        alerts: [],
        count: 0,
      };
      mapa.set(key, cluster);
    }
    cluster.alerts.push(alert);
    cluster.count = cluster.alerts.length;
    for (const f of detectCrisisFamilies(blob)) {
      if (!cluster.familias_detectadas.includes(f)) cluster.familias_detectadas.push(f);
    }
    for (const z of detectZonas(blob)) {
      if (!cluster.zonas.includes(z)) cluster.zonas.push(z);
    }
  }

  const clusters = [...mapa.values()].sort((a, b) => b.count - a.count);
  const agrupadas = clusters.filter((c) => c.count >= 2).reduce((n, c) => n + c.count, 0);
  const singletons = clusters.filter((c) => c.count === 1).length;

  return {
    clusters,
    total: alerts.length,
    agrupadas,
    singletons,
    reduccion: { antes: alerts.length, despues: clusters.length },
  };
}
