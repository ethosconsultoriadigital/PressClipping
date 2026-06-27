/**
 * Registro editorial de veredictos de clusters PressClipping ya diagnosticados
 * directamente por URL (diagnose-url). Cuando el clasificador automático no puede
 * juzgar matices (geografía, valor editorial, entidad tangencial), el veredicto
 * humano se fija aquí por un fragmento distintivo de la URL.
 *
 * Las notas diagnósticas viven en `noticias` con
 * origen_cobertura=pressclipping_diagnostico y NO cuentan como cobertura orgánica.
 *
 * Compartido entre compare-mentions y diagnose-comparison-gaps para coherencia.
 */
import { foldText } from '../matchers/text.js';
import type { CausaRaiz } from './mentionMatcher.js';
import type { ClusterStatus } from './cluster.js';

export interface DiagnosticoVerdict {
  /** Fragmento distintivo de la URL (slug) para identificar el registro. */
  urlMatch: string;
  causa: CausaRaiz;
  nota: string;
}

/** Veredictos fijados tras diagnóstico por URL (ventana 2026-06-26). */
export const DIAGNOSTICO_VERDICTS: ReadonlyArray<DiagnosticoVerdict> = [
  { urlMatch: 'escuchar-la-rabia-habitar-el-amor',          causa: 'ETHOS_DISCOVERY_GAP',     nota: 'Museo Jumex citado como recinto; la URL extrae bien; El Informador con fuente en error → reparar discovery (accionable).' },
  { urlMatch: 'una-mirada-critica-y-reflexiva-al-futbol',   causa: 'PC_SYNDICATED_LOW_VALUE',  nota: 'Museo Jumex tangencial (bio de artista) en columna cultural regional; bajo valor.' },
  { urlMatch: 'mexico-prohibio-comida-chatarra',            causa: 'ETHOS_DISCOVERY_GAP',      nota: 'Política de bebidas azucaradas con ángulo MX; medio con RSS → candidato a agregar.' },
  { urlMatch: 'el-superavit-agroalimentario-de-mexico',     causa: 'ETHOS_DISCOVERY_GAP',      nota: 'Tequila/mezcal en contexto de exportación (cable EFE); relevante; capturar vía fuente con cables.' },
  { urlMatch: 'aficionados-le-hacen-pesada-broma-a-juanpa', causa: 'PC_SYNDICATED_LOW_VALUE',  nota: 'Entretenimiento (broma a Juanpa Zurita); MSN replicador sin feed; no accionable.' },
  { urlMatch: 'cae-a-barranco-en-carretera-orizaba',        causa: 'PC_FALSE_POSITIVE',        nota: 'Accidente vial en Orizaba; "tequila" sin relación con el cliente → falso positivo.' },
  { urlMatch: 'inicios-forbes-con-este-mundial',            causa: 'ETHOS_PRECISION_TRADEOFF', nota: 'Industria tequilera (Diageo/Don Julio/exportación) relevante pero bloqueada por contexto de precisión → revisar regla.' },
  { urlMatch: 'un-mundial-para-brindar-tres-cocteles',      causa: 'ETHOS_PRECISION_TRADEOFF', nota: 'Coctelería del Mundial; bloqueo de precisión correcto; bajo valor para el cliente.' },
  { urlMatch: 'la-cgt-avanza-en-un-plan-de-lucha',          causa: 'PC_FALSE_POSITIVE',        nota: 'Reforma laboral de Argentina (CGT/Milei); fuera del ámbito del cliente → falso positivo geográfico.' },
];

/** Devuelve el veredicto diagnosticado para una URL, si existe. */
export function verdictoDiagnosticado(url?: string | null): DiagnosticoVerdict | undefined {
  if (!url) return undefined;
  const u = url.toLowerCase();
  return DIAGNOSTICO_VERDICTS.find(v => u.includes(v.urlMatch));
}

/** Tokens significativos de una keyword compuesta (PC usa etiquetas amplias). */
export function tokensSignificativos(keyword: string | null | undefined): string[] {
  const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'a', 'impuesto', 'impuestos']);
  const fold = (s: string): string => foldText(s).replace(/\s+/g, ' ').trim();
  const all = fold(keyword ?? '').split(' ').filter(Boolean);
  const toks = all.filter(t => t.length >= 4 && !STOP.has(t));
  const bigr: string[] = [];
  for (let i = 0; i < all.length - 1; i++) bigr.push(`${all[i]} ${all[i + 1]}`);
  return [...new Set([...toks, ...bigr])];
}

/**
 * Mapea una causa raíz por-registro al estado de cluster equivalente.
 *
 * SOLO devuelve override cuando la causa tiene evidencia de cuerpo o veredicto
 * humano. Las causas `ETHOS_SOURCE_*` son conjeturas por estado de fuente (sin
 * cuerpo) y devuelven `undefined` para no pisar la heurística editorial de
 * título de los clusters NO diagnosticados (p.ej. columnas sindicadas).
 */
export function causaToClusterStatus(c?: CausaRaiz): ClusterStatus | undefined {
  switch (c) {
    case 'MATCH_REAL':               return 'ETHOS_MATCHED_CLUSTER';
    case 'PC_FALSE_POSITIVE':        return 'PC_FALSE_POSITIVE';
    case 'PC_SYNDICATED_LOW_VALUE':  return 'PC_SYNDICATED_LOW_VALUE';
    case 'ETHOS_PRECISION_TRADEOFF': return 'ETHOS_PRECISION_TRADEOFF';
    case 'ETHOS_DISCOVERY_GAP':
    case 'ETHOS_KEYWORD_GAP':
    case 'ETHOS_CONTEXT_BLOCKED':
    case 'ETHOS_EXTRACTION_GAP':     return 'ETHOS_ACTIONABLE_GAP';
    // ETHOS_SOURCE_*: conjeturas sin cuerpo → sin override (heurística de título).
    default:                         return undefined;
  }
}
