/**
 * Canary selectivo de BODY para Fast Lane MASTER.
 *
 * MENTIONS_MASTER_BODY_V2 no activa detectMentionsCore.
 * DETECT_MENTIONS_BODY_V2 no activa Fast Lane.
 * BODY_MATCHING_V2 queda deprecado y no habilita producción.
 */
export const MERY_FRASE_EXACTA_BODY_KEYWORD_IDS = [
  'KEY-0040',
  'KEY-0041',
  'KEY-0042',
  'KEY-0043',
  'KEY-0044',
  'KEY-0045',
  'KEY-0046',
  'KEY-0047',
  'KEY-0076',
  'KEY-0077',
] as const;

export const BRAND_SPECIFIC_BODY_SHADOW_KEYWORD_IDS = [
  'KEY-0060',
  'KEY-0061',
  'KEY-0070',
  'KEY-0071',
  'KEY-0072',
  'KEY-0073',
] as const;

export const MERY_CONTEXTUAL_EXCLUDED_FROM_CANARY = [
  'KEY-0048',
  'KEY-0049',
  'KEY-0050',
  'KEY-0051',
] as const;

const BODY_CAMPO = new Set(['texto_cuerpo_nota', 'TEXTO_CUERPO_NOTA']);

function envTrue(raw: string | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'true';
}

export function parseKeywordAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(/[,|\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^KEY-\d+$/i.test(s));
  return [...new Set(ids)];
}

export function isMentionsMasterBodyV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envTrue(env.MENTIONS_MASTER_BODY_V2);
}

export function isDetectMentionsBodyV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envTrue(env.DETECT_MENTIONS_BODY_V2);
}

export function masterBodyAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseKeywordAllowlist(env.MENTIONS_MASTER_BODY_V2_KEYWORD_IDS);
}

export function keywordGetsTrustedBody(
  keywordId: string,
  opts: {
    masterBodyV2?: boolean;
    bodyMatchingV2?: boolean;
    keywordAllowlist?: Iterable<string>;
    mode?: string;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const allow = new Set(
    [...(opts.keywordAllowlist ?? masterBodyAllowlist(env))].map((id) => id.trim().toUpperCase()),
  );
  const masterOn = opts.masterBodyV2 ?? isMentionsMasterBodyV2Enabled(env);
  if (masterOn) return allow.has(keywordId.trim().toUpperCase());
  if (opts.bodyMatchingV2) return true;
  if (opts.mode && opts.mode !== 'current') return true;
  return false;
}

export function describeMasterBodyPolicy(env: NodeJS.ProcessEnv = process.env): {
  body_v2_enabled: boolean;
  body_v2_keyword_count: number;
  body_v2_keywords: string[];
  matching_fields: string;
  body_matching: boolean;
  detect_mentions_body_v2: boolean;
} {
  const enabled = isMentionsMasterBodyV2Enabled(env);
  const ids = masterBodyAllowlist(env);
  const active = enabled && ids.length > 0;
  return {
    body_v2_enabled: active,
    body_v2_keyword_count: active ? ids.length : 0,
    body_v2_keywords: active ? ids : [],
    matching_fields: active
      ? 'titulo,subtitulo,resumen,seccion + texto_cuerpo_nota(allowlist)'
      : 'titulo,subtitulo,resumen,seccion',
    body_matching: active,
    detect_mentions_body_v2: isDetectMentionsBodyV2Enabled(env),
  };
}

export function isBodyCampo(campo: string | null | undefined): boolean {
  return BODY_CAMPO.has(String(campo ?? ''));
}
