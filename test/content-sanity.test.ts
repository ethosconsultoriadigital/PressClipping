/**
 * Tests puros de Content Sanity Guard (Fase 1F).
 * Fixtures sintéticos, deterministas, versionados. Sin live site.
 */
import { describe, expect, it } from 'vitest';
import {
  computeContentSanitySummary,
  evaluateContentSanity,
  validateContentSanitySummary,
  resolveContentSanityFromSnapshot,
  OPERATIONAL_CONTENT_SANITY_POLICY,
  type ContentSanityInputRow,
  type ContentSanityPolicy,
  type ContentSanitySummary,
} from '../src/mediaValidation/contentSanity.js';

/** Policy SINTÉTICA de test. NO es V1. NO se exporta desde src/. */
const TEST_ONLY_CONTENT_SANITY_POLICY: ContentSanityPolicy = {
  schema_version: 1,
  policy_id: 'content-sanity-test-only-not-v1',
  status: 'ACTIVE',
  min_blocking_defective_count: 2,
  min_blocking_defective_rate: 0.5,
};

const GOOD_TEXT =
  'El gobierno de Guanajuato anunció medidas de apoyo a productores de agave. ' +
  'La secretaría estatal detalló el calendario de entregas y los requisitos. '.repeat(8);

const CHROME_TEXT = GOOD_TEXT + ' Publicidad'.repeat(4);

function row(id: string, text: string | null, url: string | null = 'https://medio.mx/2026/07/08/nota-individual-titulo'): ContentSanityInputRow {
  return { noticia_id: id, url_original: url, texto_nota_limpia: text };
}

describe('computeContentSanitySummary — detectors', () => {
  it('GOOD article no es defectuoso', () => {
    const s = computeContentSanitySummary({ snapshotComplete: true, rows: [row('g1', GOOD_TEXT)] });
    expect(s.availability).toBe('AVAILABLE');
    expect(s.issue).toBeNull();
    expect(s.sample_total).toBe(1);
    expect(s.blocking_defective_count).toBe(0);
    expect(s.blocking_defective_rate).toBe(0);
    expect(s.encoding_suspect_count).toBe(0);
    expect(s.placeholder_count).toBe(0);
    expect(s.listing_suspect_count).toBe(0);
    expect(s.boilerplate_suspect_count).toBe(0);
  });

  it('detecta mojibake U+FFFD y lo cuenta como blocking', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('m1', `Carácter de reemplazo \uFFFD en el cuerpo. ${GOOD_TEXT}`)],
    });
    expect(s.encoding_suspect_count).toBe(1);
    expect(s.blocking_defective_count).toBe(1);
  });

  it('detecta mojibake Ã típico ya cubierto por encodingSospechoso', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('m2', 'El niÃ±o comiÃ³ tacos en informaciÃ³n local.')],
    });
    expect(s.encoding_suspect_count).toBe(1);
    expect(s.blocking_defective_count).toBe(1);
  });

  it('detecta placeholder exacto "Sin contenido" como blocking', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('p1', 'Sin contenido'), row('p2', '  SIN CONTENIDO  ')],
    });
    expect(s.placeholder_count).toBe(2);
    expect(s.blocking_defective_count).toBe(2);
  });

  it('listing existente válido es DIAGNOSTIC_ONLY (no blocking)', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [
        row('l1', GOOD_TEXT, 'https://medio.mx/seccion/economia'),
        row('l2', GOOD_TEXT, 'https://medio.mx/tag/tequila'),
        row('l3', GOOD_TEXT, 'https://medio.mx/categoria/politica'),
      ],
    });
    expect(s.listing_suspect_count).toBe(3);
    expect(s.blocking_defective_count).toBe(0);
    expect(s.blocking_defective_rate).toBe(0);
  });

  it('NO marca /deportes/ como listing únicamente por un segmento', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('d1', GOOD_TEXT, 'https://www.uniradioinforma.com/deportes/')],
    });
    expect(s.listing_suspect_count).toBe(0);
  });

  it('detecta boilerplate existente válido como DIAGNOSTIC_ONLY (no blocking)', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('b1', 'Suscríbete a nuestro newsletter')],
    });
    expect(s.boilerplate_suspect_count).toBe(1);
    expect(s.blocking_defective_count).toBe(0);
  });

  it('EMPTY puro no cuenta como defecto de content-sanity', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('e1', null), row('e2', '   '), row('e3', GOOD_TEXT)],
    });
    expect(s.sample_total).toBe(3);
    expect(s.blocking_defective_count).toBe(0);
  });

  it('placeholder + listing: blocking unique 1 (listing no suma)', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('multi', 'Sin contenido', 'https://medio.mx/seccion/economia')],
    });
    expect(s.placeholder_count).toBe(1);
    expect(s.listing_suspect_count).toBe(1);
    expect(s.blocking_defective_count).toBe(1);
    expect(s.blocking_defective_rate).toBe(1);
    expect(s.example_noticia_ids).toEqual(['multi']);
  });

  it('encoding + placeholder overlap: per-type 1+1, blocking unique 1 (no 2)', () => {
    // parecePlaceholder es exact match de "Sin contenido"; encodingSospechoso no
    // dispara en esa cadena. El contrato de unión (mismo artículo, ambos flags)
    // se cubre con el summary que produce el runtime: blocking = encoding OR placeholder.
    const overlap: ContentSanitySummary = {
      schema_version: 1,
      availability: 'AVAILABLE',
      issue: null,
      sample_total: 1,
      encoding_suspect_count: 1,
      listing_suspect_count: 0,
      boilerplate_suspect_count: 0,
      placeholder_count: 1,
      blocking_defective_count: 1,
      blocking_defective_rate: 1,
      example_noticia_ids: ['ov'],
    };
    expect(validateContentSanitySummary(overlap)).not.toBeNull();
    expect(overlap.encoding_suspect_count).toBe(1);
    expect(overlap.placeholder_count).toBe(1);
    expect(overlap.blocking_defective_count).toBe(1);

    const disjoint = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('enc', 'El niÃ±o comiÃ³'), row('ph', 'Sin contenido')],
    });
    expect(disjoint.encoding_suspect_count).toBe(1);
    expect(disjoint.placeholder_count).toBe(1);
    expect(disjoint.blocking_defective_count).toBe(2);
  });

  it('encoding + listing + boilerplate: blocking=1 (solo encoding es decisional)', () => {
    const s = computeContentSanitySummary({
      snapshotComplete: true,
      rows: [row('mix', 'Suscríbete \uFFFD newsletter', 'https://medio.mx/seccion/economia')],
    });
    expect(s.encoding_suspect_count).toBe(1);
    expect(s.listing_suspect_count).toBe(1);
    expect(s.boilerplate_suspect_count).toBe(1);
    expect(s.placeholder_count).toBe(0);
    expect(s.blocking_defective_count).toBe(1);
  });

  it('GOOD chrome: boilerplate heuristic hit, 0 encoding/placeholder, no blocking', () => {
    const s = computeContentSanitySummary({ snapshotComplete: true, rows: [row('chrome', CHROME_TEXT)] });
    expect(s.boilerplate_suspect_count).toBe(1);
    expect(s.encoding_suspect_count).toBe(0);
    expect(s.placeholder_count).toBe(0);
    expect(s.blocking_defective_count).toBe(0);
  });
});

describe('computeContentSanitySummary — availability', () => {
  it('zero sample → NOT_APPLICABLE ZERO_SAMPLE, blocking rate null y count 0', () => {
    const s = computeContentSanitySummary({ snapshotComplete: true, rows: [] });
    expect(s.availability).toBe('NOT_APPLICABLE');
    expect(s.issue).toBe('ZERO_SAMPLE');
    expect(s.sample_total).toBe(0);
    expect(s.blocking_defective_count).toBe(0);
    expect(s.blocking_defective_rate).toBeNull();
  });

  it('snapshot incompleto → UNAVAILABLE SNAPSHOT_NOT_COMPLETE sin fingir counters', () => {
    const s = computeContentSanitySummary({ snapshotComplete: false, rows: [row('x', GOOD_TEXT)] });
    expect(s.availability).toBe('UNAVAILABLE');
    expect(s.issue).toBe('SNAPSHOT_NOT_COMPLETE');
    expect(s.encoding_suspect_count).toBeNull();
    expect(s.blocking_defective_rate).toBeNull();
  });
});

describe('validateContentSanitySummary — invariantes', () => {
  const available: ContentSanitySummary = {
    schema_version: 1,
    availability: 'AVAILABLE',
    issue: null,
    sample_total: 10,
    encoding_suspect_count: 1,
    listing_suspect_count: 0,
    boilerplate_suspect_count: 0,
    placeholder_count: 0,
    blocking_defective_count: 1,
    blocking_defective_rate: 0.1,
    example_noticia_ids: ['n1'],
  };

  it('AVAILABLE golden parsea', () => {
    expect(validateContentSanitySummary(available)).not.toBeNull();
  });

  it('invalid counts > sample_total rechazado', () => {
    expect(
      validateContentSanitySummary({
        ...available,
        encoding_suspect_count: 99,
        blocking_defective_count: 99,
        blocking_defective_rate: 9.9,
      }),
    ).toBeNull();
  });

  it('invalid rate fuera de [0,1] rechazado', () => {
    expect(validateContentSanitySummary({ ...available, blocking_defective_rate: 1.5 })).toBeNull();
    expect(validateContentSanitySummary({ ...available, blocking_defective_rate: Number.NaN })).toBeNull();
  });

  it('rate inconsistente con blocking/sample rechazado', () => {
    expect(validateContentSanitySummary({ ...available, blocking_defective_rate: 0.9 })).toBeNull();
  });

  it('blocking < max(encoding, placeholder) rechazado', () => {
    expect(validateContentSanitySummary({ ...available, encoding_suspect_count: 5, blocking_defective_count: 1, blocking_defective_rate: 0.1 })).toBeNull();
  });

  it('blocking > encoding+placeholder rechazado', () => {
    expect(
      validateContentSanitySummary({
        ...available,
        encoding_suspect_count: 0,
        placeholder_count: 0,
        blocking_defective_count: 1,
        blocking_defective_rate: 0.1,
      }),
    ).toBeNull();
  });

  it('listing alto con blocking 0 es válido', () => {
    expect(
      validateContentSanitySummary({
        ...available,
        encoding_suspect_count: 0,
        listing_suspect_count: 8,
        blocking_defective_count: 0,
        blocking_defective_rate: 0,
        example_noticia_ids: [],
      }),
    ).not.toBeNull();
  });

  it('UNAVAILABLE no puede fingir counters', () => {
    expect(
      validateContentSanitySummary({
        schema_version: 1,
        availability: 'UNAVAILABLE',
        issue: 'INVALID_SCHEMA',
        sample_total: null,
        encoding_suspect_count: 1,
        listing_suspect_count: null,
        boilerplate_suspect_count: null,
        placeholder_count: null,
        blocking_defective_count: null,
        blocking_defective_rate: null,
        example_noticia_ids: [],
      }),
    ).toBeNull();
  });

  it('ZERO_SAMPLE con blocking_count != 0 rechazado', () => {
    expect(
      validateContentSanitySummary({
        schema_version: 1,
        availability: 'NOT_APPLICABLE',
        issue: 'ZERO_SAMPLE',
        sample_total: 0,
        encoding_suspect_count: 0,
        listing_suspect_count: 0,
        boilerplate_suspect_count: 0,
        placeholder_count: 0,
        blocking_defective_count: 3,
        blocking_defective_rate: null,
        example_noticia_ids: [],
      }),
    ).toBeNull();
  });
});

describe('resolveContentSanityFromSnapshot', () => {
  it('ausencia → EVIDENCE_ABSENT', () => {
    const s = resolveContentSanityFromSnapshot({ raw: undefined, snapshotComplete: true, afterTotalNews: 10 });
    expect(s.issue).toBe('EVIDENCE_ABSENT');
    expect(s.availability).toBe('UNAVAILABLE');
  });

  it('schema inválido → INVALID_SCHEMA', () => {
    const s = resolveContentSanityFromSnapshot({ raw: { nope: true }, snapshotComplete: true, afterTotalNews: 10 });
    expect(s.issue).toBe('INVALID_SCHEMA');
  });

  it('sample_total mismatch → SAMPLE_TOTAL_MISMATCH', () => {
    const raw: ContentSanitySummary = {
      schema_version: 1,
      availability: 'AVAILABLE',
      issue: null,
      sample_total: 7,
      encoding_suspect_count: 0,
      listing_suspect_count: 0,
      boilerplate_suspect_count: 0,
      placeholder_count: 0,
      blocking_defective_count: 0,
      blocking_defective_rate: 0,
      example_noticia_ids: [],
    };
    const s = resolveContentSanityFromSnapshot({ raw, snapshotComplete: true, afterTotalNews: 10 });
    expect(s.issue).toBe('SAMPLE_TOTAL_MISMATCH');
    expect(s.availability).toBe('UNAVAILABLE');
    expect(s.blocking_defective_count).toBeNull();
  });
});

describe('evaluateContentSanity — outcomes', () => {
  it('operational V1 ACTIVE: id/count/rate exactos (human-approved, no óptimo estadístico)', () => {
    expect(OPERATIONAL_CONTENT_SANITY_POLICY.policy_id).toBe('content-sanity-v1-conservative');
    expect(OPERATIONAL_CONTENT_SANITY_POLICY.status).toBe('ACTIVE');
    expect(OPERATIONAL_CONTENT_SANITY_POLICY.min_blocking_defective_count).toBe(2);
    expect(OPERATIONAL_CONTENT_SANITY_POLICY.min_blocking_defective_rate).toBe(0.05);
  });

  function blockingSummary(sample: number, blocking: number, encoding = blocking, placeholder = 0): ContentSanitySummary {
    return {
      schema_version: 1,
      availability: 'AVAILABLE',
      issue: null,
      sample_total: sample,
      encoding_suspect_count: encoding,
      listing_suspect_count: 0,
      boilerplate_suspect_count: 0,
      placeholder_count: placeholder,
      blocking_defective_count: blocking,
      blocking_defective_rate: blocking / sample,
      example_noticia_ids: blocking > 0 ? ['n1'] : [],
    };
  }

  it('operational V1: una anomalía 1/5, 1/10, 1/100 → sanity PASS', () => {
    for (const sample of [5, 10, 100]) {
      const ev = evaluateContentSanity(blockingSummary(sample, 1), OPERATIONAL_CONTENT_SANITY_POLICY);
      expect(ev.outcome).toBe('PASS');
      expect(ev.review_reason).toBeNull();
    }
  });

  it('operational V1: 2/5, 2/10, 2/20, 2/40 → REVIEW; 2/41 → PASS', () => {
    expect(evaluateContentSanity(blockingSummary(5, 2), OPERATIONAL_CONTENT_SANITY_POLICY).outcome).toBe('REVIEW');
    expect(evaluateContentSanity(blockingSummary(10, 2), OPERATIONAL_CONTENT_SANITY_POLICY).outcome).toBe('REVIEW');
    expect(evaluateContentSanity(blockingSummary(20, 2), OPERATIONAL_CONTENT_SANITY_POLICY).outcome).toBe('REVIEW');
    expect(evaluateContentSanity(blockingSummary(40, 2), OPERATIONAL_CONTENT_SANITY_POLICY).outcome).toBe('REVIEW');
    const pass = evaluateContentSanity(blockingSummary(41, 2), OPERATIONAL_CONTENT_SANITY_POLICY);
    expect(pass.summary.blocking_defective_rate).toBe(2 / 41);
    expect(pass.outcome).toBe('PASS');
  });

  it('operational V1: MED-0087-like 23/30 → REVIEW (nunca FAIL)', () => {
    const ev = evaluateContentSanity(blockingSummary(30, 23, 18, 5), OPERATIONAL_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('REVIEW');
    expect(ev.review_reason).toBe('REVIEW_CONTENT_SANITY');
    expect(ev.outcome).not.toBe('FAIL' as never);
  });

  it('operational V1: diagnostic-only listing/boilerplate, 0 blocking → PASS', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row(`b${i}`, 'Suscríbete a nuestro newsletter')),
      ...Array.from({ length: 5 }, (_, i) => row(`l${i}`, GOOD_TEXT, 'https://medio.mx/seccion/economia')),
    ];
    const summary = computeContentSanitySummary({ snapshotComplete: true, rows });
    expect(summary.blocking_defective_count).toBe(0);
    expect(summary.boilerplate_suspect_count).toBeGreaterThan(0);
    expect(summary.listing_suspect_count).toBeGreaterThan(0);
    const ev = evaluateContentSanity(summary, OPERATIONAL_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('PASS');
  });

  it('TEST_POLICY: cohorte sana + 1 anomalía aislada encoding → PASS', () => {
    const rows = [row('bad', 'El niÃ±o comiÃ³'), ...Array.from({ length: 9 }, (_, i) => row(`g${i}`, GOOD_TEXT))];
    const summary = computeContentSanitySummary({ snapshotComplete: true, rows });
    expect(summary.blocking_defective_count).toBe(1);
    const ev = evaluateContentSanity(summary, TEST_ONLY_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('PASS');
  });

  it('TEST_POLICY: placeholder prevalente → REVIEW (nunca FAIL)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`b${i}`, 'Sin contenido'));
    const summary = computeContentSanitySummary({ snapshotComplete: true, rows });
    expect(summary.blocking_defective_count).toBe(10);
    const ev = evaluateContentSanity(summary, TEST_ONLY_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('REVIEW');
    expect(ev.review_reason).toBe('REVIEW_CONTENT_SANITY');
    expect(ev.blocking_defect_types).toEqual(['placeholder']);
    expect(ev.diagnostic_defect_types).toEqual([]);
  });

  it('TEST_POLICY: encoding prevalente → REVIEW', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`e${i}`, `El niÃ±o ${i}`));
    const summary = computeContentSanitySummary({ snapshotComplete: true, rows });
    const ev = evaluateContentSanity(summary, TEST_ONLY_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('REVIEW');
    expect(ev.blocking_defect_types).toEqual(['encoding']);
  });

  it('TEST_POLICY: boilerplate prevalente, 0 encoding/placeholder → PASS (no REVIEW_CONTENT_SANITY)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`b${i}`, 'Suscríbete a nuestro newsletter'));
    const summary = computeContentSanitySummary({ snapshotComplete: true, rows });
    expect(summary.boilerplate_suspect_count).toBe(10);
    expect(summary.blocking_defective_count).toBe(0);
    const ev = evaluateContentSanity(summary, TEST_ONLY_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('PASS');
    expect(ev.review_reason).toBeNull();
    expect(ev.diagnostic_defect_types).toEqual(['boilerplate']);
    expect(ev.blocking_defect_types).toEqual([]);
  });

  it('TEST_POLICY: listing prevalente, 0 encoding/placeholder → PASS', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`l${i}`, GOOD_TEXT, 'https://medio.mx/seccion/economia'));
    const summary = computeContentSanitySummary({ snapshotComplete: true, rows });
    expect(summary.listing_suspect_count).toBe(10);
    expect(summary.blocking_defective_count).toBe(0);
    const ev = evaluateContentSanity(summary, TEST_ONLY_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('PASS');
    expect(ev.diagnostic_defect_types).toEqual(['listing']);
    expect(ev.blocking_defect_types).toEqual([]);
  });

  it('zero sample → NOT_EVALUABLE ZERO_SAMPLE', () => {
    const summary = computeContentSanitySummary({ snapshotComplete: true, rows: [] });
    const ev = evaluateContentSanity(summary, TEST_ONLY_CONTENT_SANITY_POLICY);
    expect(ev.outcome).toBe('NOT_EVALUABLE');
    expect(ev.review_reason).toBe('REVIEW_CONTENT_SANITY_ZERO_SAMPLE');
  });
});
