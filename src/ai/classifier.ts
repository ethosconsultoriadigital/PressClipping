/**
 * Clasificador de menciones con IA (Claude) — Fase 7.
 *
 * Una sola llamada por mención (single LLM call) con salida estructurada vía
 * Zod. Los constructores de prompt y la combinación de alerta son puros y
 * testeables; la llamada de red está aislada en `classifyMencion`.
 *
 * Política de costos: este módulo NO decide a quién clasificar ni cuántas veces;
 * eso lo controla el script (gate usar_ia, límite por corrida, solo pendientes).
 */
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getAnthropic, MODELO_IA_DEFAULT } from './client.js';

/** Esquema de la clasificación que devuelve la IA. */
export const ClasificacionSchema = z.object({
  sentimiento: z.enum(['positivo', 'neutral', 'negativo']),
  relevancia: z.enum(['alta', 'media', 'baja']),
  tema: z.string(),
  subtema: z.string(),
  resumen_ejecutivo: z.string(),
  riesgo_reputacional: z.enum(['bajo', 'medio', 'alto']),
  recomendacion_pr: z.string(),
  requiere_alerta: z.boolean(),
});
export type Clasificacion = z.infer<typeof ClasificacionSchema>;

/** Datos de entrada para clasificar una mención (noticia + contexto cliente). */
export interface ClassifyInput {
  titulo: string | null;
  resumen: string | null;
  medio: string | null;
  keyword: string | null;
  cliente: string | null;
  industria: string | null;
  marcas: string | null;
  competidores: string | null;
  temas_sensibles: string | null;
}

const SYSTEM_PROMPT = [
  'Eres un analista senior de comunicación y relaciones públicas (PR).',
  'Clasificas menciones de prensa para clientes corporativos en México.',
  'Analiza de forma objetiva y conservadora: si la información es insuficiente,',
  'usa "neutral"/"media"/"bajo" en lugar de inventar.',
  'El sentimiento es desde la perspectiva reputacional del cliente.',
  'El resumen ejecutivo debe ser breve (1-2 frases), en español, sin copiar el texto íntegro.',
  'La recomendación PR debe ser accionable y concreta.',
  'Marca requiere_alerta=true solo ante riesgo reputacional alto o crisis potencial.',
].join(' ');

/** Construye el prompt de usuario con la nota y el contexto del cliente. */
export function buildUserPrompt(input: ClassifyInput): string {
  const linea = (etiqueta: string, valor: string | null) =>
    valor && valor.trim() ? `${etiqueta}: ${valor.trim()}` : null;

  const partes = [
    '## Nota detectada',
    linea('Cliente', input.cliente),
    linea('Keyword que disparó la mención', input.keyword),
    linea('Medio', input.medio),
    linea('Título', input.titulo),
    linea('Resumen/extracto', input.resumen),
    '',
    '## Contexto del cliente',
    linea('Industria', input.industria),
    linea('Marcas', input.marcas),
    linea('Competidores', input.competidores),
    linea('Temas sensibles', input.temas_sensibles),
    '',
    'Clasifica esta mención según el esquema solicitado.',
  ].filter((l): l is string => l !== null);

  return partes.join('\n');
}

export interface UsoIa {
  input_tokens: number;
  output_tokens: number;
}

export interface ClassifyOptions {
  modelo?: string;
  maxTokens?: number;
}

/**
 * Clasifica una mención llamando a Claude con salida estructurada.
 * Devuelve la clasificación parseada y el uso de tokens (para control de costo).
 */
export async function classifyMencion(
  input: ClassifyInput,
  opts: ClassifyOptions = {},
): Promise<{ clasificacion: Clasificacion; uso: UsoIa; modelo: string }> {
  const modelo = opts.modelo ?? MODELO_IA_DEFAULT;
  const client = getAnthropic();

  const message = await client.beta.messages.parse({
    model: modelo,
    max_tokens: opts.maxTokens ?? 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_format: betaZodOutputFormat(ClasificacionSchema),
  });

  if (!message.parsed_output) {
    throw new Error(
      `La IA no devolvió una clasificación válida (stop_reason=${message.stop_reason}).`,
    );
  }

  return {
    clasificacion: message.parsed_output,
    uso: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    },
    modelo,
  };
}

/**
 * Combina la señal de la IA con la marca de alerta de la keyword.
 * Dispara alerta si la IA la pide, o si la keyword tiene alerta activa y hay
 * señal negativa (sentimiento negativo o riesgo alto). Puro y testeable.
 */
export function computeRequiereAlerta(
  c: Pick<Clasificacion, 'requiere_alerta' | 'sentimiento' | 'riesgo_reputacional'>,
  keywordAlerta: boolean,
): boolean {
  if (c.requiere_alerta) return true;
  const señalNegativa = c.sentimiento === 'negativo' || c.riesgo_reputacional === 'alto';
  return keywordAlerta && señalNegativa;
}
