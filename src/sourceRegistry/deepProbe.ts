import { scoreMediaAtAnchor, type CertNote } from '../mediaValidation/certScore.js';
import type { CertProbe } from '../mediaValidation/certClassify.js';
import { isNonArticleUrl } from '../mediaValidation/certEligibility.js';
import type { TechnicalClass } from './types.js';

export interface DeepProbeNote {
  url: string | null;
  titulo: string | null;
  fecha: string | null;
  created_at: string | null;
  texto_cuerpo_nota: string | null;
  texto_nota_limpia: string | null;
}

/** Reusa el certificador oficial. No baja umbrales. No force A. */
export function deepScoreFromNotes(opts: {
  medioId: string;
  notes: DeepProbeNote[];
  probe: CertProbe;
  lastEstado: string | null;
  lastError: string | null;
  paywallNotes: boolean;
  anchorIso: string;
}): {
  technical_class: TechnicalClass;
  reason: string;
  eligible: number;
  rejected: number;
} {
  const notes30: CertNote[] = opts.notes.map((n, i) => ({
    noticia_id: `probe-${i}`,
    url_original: n.url,
    titulo: n.titulo,
    fecha_publicacion: n.fecha,
    created_at: n.created_at ?? opts.anchorIso,
    texto_cuerpo_nota: n.texto_cuerpo_nota,
    texto_nota_limpia: n.texto_nota_limpia,
  }));
  const rejected = notes30.filter((n) => isNonArticleUrl(opts.medioId, n.url_original)).length;
  const s = scoreMediaAtAnchor({
    medioId: opts.medioId,
    notes30,
    probe: opts.probe,
    lastEstado: opts.lastEstado,
    lastError: opts.lastError,
    paywallNotes: opts.paywallNotes,
    anchorIso: opts.anchorIso,
  });
  return {
    technical_class: s.certification_class as TechnicalClass,
    reason: s.certification_reason,
    eligible: notes30.length - rejected,
    rejected,
  };
}
