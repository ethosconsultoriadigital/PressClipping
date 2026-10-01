/**
 * Unified Matching V2 — campos de señal + cuerpo editorial confiable.
 *
 * texto_extraido RAW nunca dispara menciones productivas.
 * Fast Lane canary: MENTIONS_MASTER_BODY_V2 + allowlist por keyword.
 * Detector: DETECT_MENTIONS_BODY_V2 (independiente). BODY_MATCHING_V2 está deprecado.
 */
import { PESOS_CAMPO, type CampoBuscable } from '../matchers/keyword.js';
import { foldText } from '../matchers/text.js';

export type BodyTrustStatus =
  | 'BODY_TRUSTED'
  | 'BODY_FALLBACK_CLEAN'
  | 'BODY_REJECTED'
  | 'NO_BODY';

export type MatchingMode =
  | 'current'
  | 'body_high'
  | 'body_high_plus_clean'
  | 'body_with_proximity';

export const MIN_BODY_CHARS = 80;

const CORTE = [
  'notas relacionadas',
  'noticias relacionadas',
  'te puede interesar',
  'tambien te puede interesar',
  'mas noticias',
  'mas leidas',
  'lo mas visto',
  'te recomendamos',
  'sigue leyendo',
  'lee tambien',
  'contenido relacionado',
  'ver mas notas',
];

export interface ContentLayers {
  titulo?: string | null;
  subtitulo?: string | null;
  resumen?: string | null;
  seccion?: string | null;
  texto_cuerpo_nota?: string | null;
  texto_nota_limpia?: string | null;
  texto_extraido?: string | null;
  calidad_extraccion?: string | null;
}

export interface TrustedBody {
  status: BodyTrustStatus;
  text: string;
  campo: 'texto_cuerpo_nota' | 'texto_nota_limpia' | null;
  calidad: string | null;
  chars: number;
  contaminated: boolean;
}

/** @deprecated No usar para producción. Fast Lane usa MENTIONS_MASTER_BODY_V2. */
export function isBodyMatchingV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.BODY_MATCHING_V2 ?? '').trim().toLowerCase() === 'true';
}

export function hasStrongContamination(text: string): boolean {
  const folded = foldText(text);
  const lines = folded.split(/\n+/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (!line) continue;
    if (CORTE.some((m) => line === m || line.startsWith(m + ' ') || line.startsWith(m + ':'))) {
      const after = lines.slice(i).join('\n').length;
      if (after / Math.max(folded.length, 1) >= 0.35) return true;
    }
  }
  return false;
}

export function selectTrustedBody(
  n: ContentLayers,
  mode: MatchingMode,
): TrustedBody {
  const calidad = (n.calidad_extraccion ?? '').trim().toLowerCase() || null;
  const cuerpo = (n.texto_cuerpo_nota ?? '').trim();
  const limpia = (n.texto_nota_limpia ?? '').trim();
  const raw = (n.texto_extraido ?? '').trim();

  if (mode === 'current') {
    return { status: 'NO_BODY', text: '', campo: null, calidad, chars: 0, contaminated: false };
  }

  const cuerpoContam = cuerpo.length > 0 && hasStrongContamination(cuerpo);
  const limpiaContam = limpia.length > 0 && hasStrongContamination(limpia);

  if (cuerpo.length >= MIN_BODY_CHARS && calidad === 'alta' && !cuerpoContam) {
    return {
      status: 'BODY_TRUSTED',
      text: cuerpo,
      campo: 'texto_cuerpo_nota',
      calidad,
      chars: cuerpo.length,
      contaminated: false,
    };
  }

  if (mode === 'body_high_plus_clean' && limpia.length >= MIN_BODY_CHARS && !limpiaContam) {
    if (calidad === 'alta' || calidad === 'media') {
      return {
        status: 'BODY_FALLBACK_CLEAN',
        text: limpia,
        campo: 'texto_nota_limpia',
        calidad,
        chars: limpia.length,
        contaminated: false,
      };
    }
  }

  const had = cuerpo.length > 0 || limpia.length > 0 || raw.length > 0;
  return {
    status: had ? 'BODY_REJECTED' : 'NO_BODY',
    text: '',
    campo: null,
    calidad,
    chars: cuerpo.length || limpia.length || raw.length,
    contaminated: cuerpoContam || limpiaContam,
  };
}

export function signalFields(n: ContentLayers): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO.seccion! },
  ];
}

export function buildTrustedMatchingFields(
  n: ContentLayers,
  opts: { mode: MatchingMode } = { mode: 'current' },
): { campos: CampoBuscable[]; body: TrustedBody } {
  const campos = signalFields(n);
  const body = selectTrustedBody(n, opts.mode);
  if (body.text && body.campo) {
    const peso =
      body.campo === 'texto_cuerpo_nota'
        ? (PESOS_CAMPO.texto_cuerpo_nota ?? PESOS_CAMPO.texto_extraido ?? 0.4)
        : (PESOS_CAMPO.texto_nota_limpia ?? 0.35);
    campos.push({ nombre: body.campo, texto: body.text, peso });
  }
  return { campos, body };
}
