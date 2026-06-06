/**
 * Cliente de Anthropic (Claude) para la clasificación de menciones (Fase 7).
 *
 * Solo se instancia cuando la IA está habilitada y hay API key. El modelo por
 * defecto es configurable desde 04_Configuracion (ia_modelo).
 */
import Anthropic from '@anthropic-ai/sdk';
import { env, MissingEnvError } from '../config/env.js';

let cached: Anthropic | null = null;

/** Devuelve un cliente singleton de Anthropic; lanza si falta la API key. */
export function getAnthropic(): Anthropic {
  if (cached) return cached;
  if (!env.ANTHROPIC_API_KEY) {
    throw new MissingEnvError('IA (Anthropic)', ['ANTHROPIC_API_KEY']);
  }
  cached = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cached;
}

/** Modelo por defecto para clasificación (barato). Configurable vía ia_modelo. */
export const MODELO_IA_DEFAULT = 'claude-haiku-4-5';
