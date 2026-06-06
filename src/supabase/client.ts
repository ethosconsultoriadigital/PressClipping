/**
 * Cliente de Supabase (base histórica).
 *
 * Usa la Service Role Key, que omite las políticas RLS. Por eso este módulo
 * SOLO debe importarse desde código backend (scripts, Actions), nunca desde
 * un contexto expuesto al navegador.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from '../config/env.js';

let cached: SupabaseClient | null = null;

/** Devuelve un cliente singleton de Supabase con la Service Role Key. */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const { url, serviceRoleKey } = requireSupabaseEnv();
  cached = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}

/**
 * Verifica la conexión consultando una tabla del esquema.
 * Devuelve un resumen útil para el script de prueba de conexión.
 */
export async function checkSupabaseConnection(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const supabase = getSupabase();

  // head:true + count:exact no trae filas, solo valida acceso y cuenta.
  const { error, count } = await supabase
    .from('configuracion')
    .select('clave', { count: 'exact', head: true });

  if (error) {
    return {
      ok: false,
      detail:
        `No se pudo consultar la tabla "configuracion": ${error.message}. ` +
        '¿Aplicaste las migraciones de supabase/migrations?',
    };
  }

  return {
    ok: true,
    detail: `Conexión OK. Filas en "configuracion": ${count ?? 0}.`,
  };
}
