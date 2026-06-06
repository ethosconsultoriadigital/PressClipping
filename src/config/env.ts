/**
 * Carga y validación de variables de entorno.
 *
 * Centraliza el acceso a secretos para que ningún otro módulo lea process.env
 * directamente. Si falta una variable requerida por una capacidad concreta,
 * el helper correspondiente lanza un error claro (en vez de fallar más adelante
 * con un mensaje críptico).
 */
import 'dotenv/config';
import { z } from 'zod';

/**
 * Esquema base. Casi todo es opcional a nivel de proceso porque distintos
 * scripts necesitan distintos subconjuntos (p.ej. generate-xml no requiere
 * Sheets). La validación "dura" se hace por capacidad con los helpers de abajo.
 */
const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().min(1).optional(),
  GOOGLE_SHEET_ID: z.string().min(1).optional(),

  // Ejecución
  RUN_BY: z.string().default('local'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error'])
    .default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),

  // IA (Fase 7)
  ANTHROPIC_API_KEY: z.string().optional(),

  // XML (Fase 6+)
  XML_SECRET_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Variables de entorno inválidas:\n${issues}\n` +
      'Revisa tu archivo .env (usa .env.example como guía).',
  );
}

export const env = parsed.data;

/** Error tipado para faltantes de configuración por capacidad. */
export class MissingEnvError extends Error {
  constructor(capability: string, keys: string[]) {
    super(
      `Falta configuración para "${capability}". ` +
        `Define en .env: ${keys.join(', ')}.`,
    );
    this.name = 'MissingEnvError';
  }
}

/**
 * Devuelve la configuración de Supabase, garantizando que esté presente.
 * Úsalo en cualquier punto que requiera acceso a la base histórica.
 */
export function requireSupabaseEnv(): {
  url: string;
  serviceRoleKey: string;
} {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new MissingEnvError('Supabase', [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
  }
  return {
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Devuelve la configuración de Google Sheets, garantizando que esté presente.
 * Normaliza la clave privada: en .env y en GitHub Secrets los saltos de línea
 * suelen venir escapados como "\n" y hay que convertirlos a saltos reales.
 */
export function requireSheetsEnv(): {
  email: string;
  privateKey: string;
  sheetId: string;
} {
  if (
    !env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !env.GOOGLE_PRIVATE_KEY ||
    !env.GOOGLE_SHEET_ID
  ) {
    throw new MissingEnvError('Google Sheets', [
      'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_PRIVATE_KEY',
      'GOOGLE_SHEET_ID',
    ]);
  }
  return {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    sheetId: env.GOOGLE_SHEET_ID,
  };
}
