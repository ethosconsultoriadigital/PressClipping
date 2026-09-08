import { describe, expect, it } from 'vitest';
import { resolveReferenceLabelManifest, type ReferenceLabelManifest } from '../src/mediaValidation/referenceLabels.js';

function manifest(entries: { medio_id: string; label: ReferenceLabelManifest['entries'][number]['label'] }[]): ReferenceLabelManifest {
  return { schema_version: 1, label_source: 'human_review', entries };
}

describe('resolveReferenceLabelManifest — Fase 1D/1E', () => {
  it('resuelve un manifest simple sin conflictos', () => {
    const r = resolveReferenceLabelManifest(
      manifest([
        { medio_id: 'MED-1', label: 'GOOD_REFERENCE' },
        { medio_id: 'MED-2', label: 'TEXT_BAD_REFERENCE' },
      ]),
    );
    expect(r.resolved).toEqual([
      { medio_id: 'MED-1', label: 'GOOD_REFERENCE' },
      { medio_id: 'MED-2', label: 'TEXT_BAD_REFERENCE' },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.deduplicated_medio_ids).toEqual([]);
  });

  it('labels contradictorios para el mismo medio_id → REJECT, no se elige uno (§20)', () => {
    const r = resolveReferenceLabelManifest(
      manifest([
        { medio_id: 'MED-1', label: 'GOOD_REFERENCE' },
        { medio_id: 'MED-1', label: 'TEXT_BAD_REFERENCE' },
      ]),
    );
    expect(r.resolved).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.medio_id).toBe('MED-1');
    expect(r.rejected[0]!.labels_seen.sort()).toEqual(['GOOD_REFERENCE', 'TEXT_BAD_REFERENCE']);
  });

  it('duplicado con MISMO label → deduplicado determinista, no es un conflicto', () => {
    const r = resolveReferenceLabelManifest(
      manifest([
        { medio_id: 'MED-1', label: 'GOOD_REFERENCE' },
        { medio_id: 'MED-1', label: 'GOOD_REFERENCE' },
      ]),
    );
    expect(r.resolved).toEqual([{ medio_id: 'MED-1', label: 'GOOD_REFERENCE' }]);
    expect(r.rejected).toEqual([]);
    expect(r.deduplicated_medio_ids).toEqual(['MED-1']);
  });

  it('manifest vacío → resolved vacío, sin lanzar', () => {
    const r = resolveReferenceLabelManifest(manifest([]));
    expect(r.resolved).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('resolved y rejected están ordenados por medio_id (determinismo)', () => {
    const r = resolveReferenceLabelManifest(
      manifest([
        { medio_id: 'MED-Z', label: 'GOOD_REFERENCE' },
        { medio_id: 'MED-A', label: 'NO_NEWS_REFERENCE' },
      ]),
    );
    expect(r.resolved.map((e) => e.medio_id)).toEqual(['MED-A', 'MED-Z']);
  });

  it('mismo input → mismo output (determinismo)', () => {
    const m = manifest([
      { medio_id: 'MED-1', label: 'GOOD_REFERENCE' },
      { medio_id: 'MED-2', label: 'SOURCE_REPAIR_REFERENCE' },
    ]);
    expect(resolveReferenceLabelManifest(m)).toEqual(resolveReferenceLabelManifest(m));
  });
});
