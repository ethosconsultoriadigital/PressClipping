/**
 * Contrato de datos: esquemas zod de las filas que se insertan en Supabase
 * a partir de las pestañas de Google Sheets, más los mapeadores desde el
 * registro crudo (cabeceras normalizadas → fila de DB).
 *
 * Los mapeadores son puros y testeables: reciben un Record<string,string>
 * (cabeceras ya normalizadas con normalizeHeader) y devuelven la fila tipada.
 */
import { z } from 'zod';
import {
  parseBool,
  parseIntOrNull,
  parseTextOrNull,
} from '../utils/parse.js';

type Raw = Record<string, string | undefined>;

const TIPO_KEYWORD = [
  'exacta',
  'frase_exacta',
  'contiene',
  'booleana',
  'exacta_contextual',
] as const;

// --- medios -----------------------------------------------------------------
export const medioSchema = z.object({
  medio_id: z.string().min(1),
  nombre_medio: z.string().min(1),
  grupo_medio: z.string().nullable(),
  url_base: z.string().nullable(),
  pais: z.string().nullable(),
  estado: z.string().nullable(),
  municipio: z.string().nullable(),
  region: z.string().nullable(),
  categoria: z.string().nullable(),
  prioridad: z.string().nullable(),
  activo: z.boolean(),
  metodo_extraccion: z.string().nullable(),
  rss_url: z.string().nullable(),
  sitemap_url: z.string().nullable(),
  secciones_urls: z.string().nullable(),
  buscador_url: z.string().nullable(),
  requiere_javascript: z.boolean(),
  requiere_proxy: z.boolean(),
  frecuencia_minutos: z.number().int().nullable(),
  notas_tecnicas: z.string().nullable(),
});
export type Medio = z.infer<typeof medioSchema>;

export function mapMedioRow(r: Raw) {
  return medioSchema.safeParse({
    medio_id: parseTextOrNull(r['medio_id']) ?? '',
    nombre_medio: parseTextOrNull(r['nombre_medio']) ?? '',
    grupo_medio: parseTextOrNull(r['grupo_medio']),
    url_base: parseTextOrNull(r['url_base']),
    pais: parseTextOrNull(r['pais']),
    estado: parseTextOrNull(r['estado']),
    municipio: parseTextOrNull(r['municipio']),
    region: parseTextOrNull(r['region']),
    categoria: parseTextOrNull(r['categoria']),
    prioridad: parseTextOrNull(r['prioridad']),
    activo: parseBool(r['activo']),
    metodo_extraccion: parseTextOrNull(r['metodo_extraccion']),
    rss_url: parseTextOrNull(r['rss_url']),
    sitemap_url: parseTextOrNull(r['sitemap_url']),
    secciones_urls: parseTextOrNull(r['secciones_urls']),
    buscador_url: parseTextOrNull(r['buscador_url']),
    requiere_javascript: parseBool(r['requiere_javascript']),
    requiere_proxy: parseBool(r['requiere_proxy']),
    frecuencia_minutos: parseIntOrNull(r['frecuencia_minutos']),
    notas_tecnicas: parseTextOrNull(r['notas_tecnicas']),
  });
}

// --- clientes ---------------------------------------------------------------
export const clienteSchema = z.object({
  cliente_id: z.string().min(1),
  nombre_cliente: z.string().min(1),
  industria: z.string().nullable(),
  marcas: z.string().nullable(),
  competidores: z.string().nullable(),
  voceros: z.string().nullable(),
  temas_sensibles: z.string().nullable(),
  activo: z.boolean(),
  prioridad_ia: z.string().nullable(),
  alertas_activas: z.boolean(),
  notas: z.string().nullable(),
});
export type Cliente = z.infer<typeof clienteSchema>;

export function mapClienteRow(r: Raw) {
  return clienteSchema.safeParse({
    cliente_id: parseTextOrNull(r['cliente_id']) ?? '',
    nombre_cliente: parseTextOrNull(r['nombre_cliente']) ?? '',
    industria: parseTextOrNull(r['industria']),
    marcas: parseTextOrNull(r['marcas']),
    competidores: parseTextOrNull(r['competidores']),
    voceros: parseTextOrNull(r['voceros']),
    temas_sensibles: parseTextOrNull(r['temas_sensibles']),
    activo: parseBool(r['activo']),
    prioridad_ia: parseTextOrNull(r['prioridad_ia']),
    alertas_activas: parseBool(r['alertas_activas']),
    notas: parseTextOrNull(r['notas']),
  });
}

// --- keywords ---------------------------------------------------------------
export const keywordSchema = z.object({
  keyword_id: z.string().min(1),
  cliente_id: z.string().nullable(),
  cliente: z.string().nullable(),
  keyword: z.string().min(1),
  alias_o_variantes: z.string().nullable(),
  tipo_keyword: z.enum(TIPO_KEYWORD),
  regla: z.string().nullable(),
  activa: z.boolean(),
  prioridad: z.string().nullable(),
  alerta: z.boolean(),
  contexto_incluir: z.string().nullable(),
  contexto_excluir: z.string().nullable(),
  notas: z.string().nullable(),
});
export type Keyword = z.infer<typeof keywordSchema>;

export function mapKeywordRow(r: Raw) {
  const tipoRaw = (parseTextOrNull(r['tipo_keyword']) ?? 'contiene').toLowerCase();
  const tipo = (TIPO_KEYWORD as readonly string[]).includes(tipoRaw)
    ? tipoRaw
    : 'contiene';
  return keywordSchema.safeParse({
    keyword_id: parseTextOrNull(r['keyword_id']) ?? '',
    cliente_id: parseTextOrNull(r['cliente_id']),
    cliente: parseTextOrNull(r['cliente']),
    keyword: parseTextOrNull(r['keyword']) ?? '',
    alias_o_variantes: parseTextOrNull(r['alias_o_variantes']),
    tipo_keyword: tipo,
    regla: parseTextOrNull(r['regla']),
    activa: parseBool(r['activa']),
    prioridad: parseTextOrNull(r['prioridad']),
    alerta: parseBool(r['alerta']),
    contexto_incluir: parseTextOrNull(r['contexto_incluir']),
    contexto_excluir: parseTextOrNull(r['contexto_excluir']),
    notas: parseTextOrNull(r['notas']),
  });
}

// --- configuracion (llave/valor) -------------------------------------------
export const configRowSchema = z.object({
  clave: z.string().min(1),
  valor: z.string().nullable(),
});
export type ConfigRow = z.infer<typeof configRowSchema>;

/**
 * La pestaña 04_Configuracion puede tener cabeceras variadas para clave/valor.
 * Buscamos la primera coincidencia entre nombres comunes.
 */
const CLAVE_KEYS = ['clave', 'variable', 'parametro', 'parámetro', 'key', 'nombre'];
const VALOR_KEYS = ['valor', 'value', 'dato'];

export function mapConfigRow(r: Raw) {
  const claveKey = CLAVE_KEYS.find((k) => parseTextOrNull(r[k]) !== null);
  const valorKey = VALOR_KEYS.find((k) => parseTextOrNull(r[k]) !== null);
  return configRowSchema.safeParse({
    clave: (claveKey ? parseTextOrNull(r[claveKey]) : null) ?? '',
    valor: valorKey ? parseTextOrNull(r[valorKey]) : null,
  });
}
