import { describe, it, expect } from 'vitest';
import { planUniqueAppendByKey, evaluarReadbackUnique } from '../src/sheets/uniqueAppendPlan.js';
import { SELECT_MENCION_EXPORT, mapMencionExport } from '../src/types/mencion.js';
import { parseExportResultsArgs } from '../scripts/export-results-to-sheets.js';

describe('planUniqueAppendByKey', () => {
  it('dedupe incoming m1,m1,m2 → append m1,m2', () => {
    const plan = planUniqueAppendByKey(
      [],
      [{ mencion_id: 'm1' }, { mencion_id: 'm1' }, { mencion_id: 'm2' }],
      'mencion_id',
    );
    expect(plan.to_append.map((r) => r.mencion_id)).toEqual(['m1', 'm2']);
    expect(plan.duplicates_in_batch).toEqual(['m1']);
    expect(plan.already_present_ids).toEqual([]);
    expect(plan.selected_ids).toEqual(['m1', 'm2']);
  });

  it('si la hoja ya tiene m1, incoming m1,m2 → append solo m2', () => {
    const plan = planUniqueAppendByKey(
      ['m1', '', 'old-blank-skip'],
      [{ mencion_id: 'm1' }, { mencion_id: 'm2' }],
      'mencion_id',
    );
    expect(plan.to_append.map((r) => r.mencion_id)).toEqual(['m2']);
    expect(plan.already_present_ids).toEqual(['m1']);
    expect(plan.preexisting_duplicate_ids).toEqual([]);
  });

  it('reporta duplicados preexistentes sin borrar', () => {
    const plan = planUniqueAppendByKey(['m1', 'm1', 'm3'], [{ mencion_id: 'm2' }], 'mencion_id');
    expect(plan.preexisting_duplicate_ids).toEqual(['m1']);
    expect(plan.to_append.map((r) => r.mencion_id)).toEqual(['m2']);
  });

  it('segundo run idéntico: append 0', () => {
    const incoming = [{ mencion_id: 'm1' }, { mencion_id: 'm2' }];
    const first = planUniqueAppendByKey([], incoming, 'mencion_id');
    const after = [...first.to_append.map((r) => String(r.mencion_id))];
    const second = planUniqueAppendByKey(after, incoming, 'mencion_id');
    expect(second.to_append).toEqual([]);
    expect(second.already_present_ids).toEqual(['m1', 'm2']);
  });
});

describe('evaluarReadbackUnique', () => {
  it('readback missing m2 → mismatch, no mark eligible', () => {
    const rb = evaluarReadbackUnique(['m1', 'm2'], ['m1']);
    expect(rb.missing_ids).toEqual(['m2']);
    expect(rb.mismatch).toBe(true);
    expect(rb.all_present).toBe(false);
  });

  it('readback m1+m2 → ambos mark eligible', () => {
    const rb = evaluarReadbackUnique(['m1', 'm2'], ['m1', 'm2']);
    expect(rb.missing_ids).toEqual([]);
    expect(rb.mismatch).toBe(false);
    expect(rb.all_present).toBe(true);
  });
});

describe('SELECT_MENCION_EXPORT y mapper', () => {
  it('SELECT trae cliente_id, keyword_id, tipo_keyword, prioridad', () => {
    expect(SELECT_MENCION_EXPORT).toContain('cliente_id');
    expect(SELECT_MENCION_EXPORT).toContain('keyword_id');
    expect(SELECT_MENCION_EXPORT).toContain('keywords(tipo_keyword, prioridad)');
  });

  it('mapMencionExport completa IDs y deja alias fuera del schema', () => {
    const row = mapMencionExport({
      mencion_id: 'm1',
      noticia_id: 'n1',
      cliente_id: 'CLI-0001',
      keyword_id: 'KEY-0001',
      keyword: 'Jumex',
      texto_match: 'Jumex',
      sentimiento: null,
      score_relevancia: 0.4,
      tema: null,
      subtema: null,
      requiere_alerta: false,
      estado_revision: 'pendiente',
      exportado_xml: false,
      clientes: { nombre_cliente: 'Jumex' },
      keywords: { tipo_keyword: 'exacta', prioridad: 'Alta' },
      noticias: {
        titulo: 'T',
        url_original: 'https://x.mx/a',
        resumen: null,
        fecha_publicacion: '2026-09-22',
        fecha_captura: '2026-09-22',
        estado: null,
        medios: { nombre_medio: 'Medio', region: null },
      },
    });
    expect(row.cliente_id).toBe('CLI-0001');
    expect(row.keyword_id).toBe('KEY-0001');
    expect(row.tipo_keyword).toBe('exacta');
    expect(row.prioridad).toBe('Alta');
  });
});

describe('parseExportResultsArgs', () => {
  it('sin flags conserva defaults históricos', () => {
    expect(parseExportResultsArgs([])).toEqual({
      mentionsOnly: false,
      clients: null,
      windowHours: null,
      newsWindowHours: null,
      recentFirst: false,
      limit: null,
      dryRun: false,
    });
  });

  it('parsea flags LIVE 48h', () => {
    const a = parseExportResultsArgs([
      '--mentions-only',
      '--clients=CLI-MERY-TEST,CLI-0001,CLI-0002',
      '--window-hours=48',
      '--recent-first',
      '--limit=500',
      '--dry-run',
    ]);
    expect(a.mentionsOnly).toBe(true);
    expect(a.clients).toEqual(['CLI-MERY-TEST', 'CLI-0001', 'CLI-0002']);
    expect(a.windowHours).toBe(48);
    expect(a.recentFirst).toBe(true);
    expect(a.limit).toBe(500);
    expect(a.dryRun).toBe(true);
  });
});
