import { describe, it, expect } from 'vitest';
import { parseExportResultsArgs } from '../scripts/export-results-to-sheets.js';
import { planUniqueAppendByKey } from '../src/sheets/uniqueAppendPlan.js';
import {
  consultasVentanaEditorial,
  fusionarMencionesExport,
  noticiaEnVentanaEditorial,
} from '../src/exporters/liveNewsWindow.js';

const CORTE = '2026-09-22T12:00:00.000Z';

describe('parseExportResultsArgs --news-window-hours', () => {
  it('parsea --news-window-hours=48 sin alterar el resto', () => {
    const a = parseExportResultsArgs([
      '--mentions-only',
      '--clients=CLI-MERY-TEST,CLI-0001,CLI-0002',
      '--window-hours=48',
      '--news-window-hours=48',
      '--recent-first',
      '--limit=500',
      '--dry-run',
    ]);
    expect(a.newsWindowHours).toBe(48);
    expect(a.windowHours).toBe(48);
    expect(a.mentionsOnly).toBe(true);
    expect(a.dryRun).toBe(true);
  });

  it('sin el flag la ventana editorial queda apagada', () => {
    expect(parseExportResultsArgs(['--window-hours=48']).newsWindowHours).toBeNull();
    expect(parseExportResultsArgs([]).newsWindowHours).toBeNull();
  });
});

describe('noticiaEnVentanaEditorial', () => {
  it('fecha_publicacion dentro entra', () => {
    expect(
      noticiaEnVentanaEditorial('2026-09-23T08:00:00.000Z', '2026-09-10T00:00:00.000Z', CORTE),
    ).toBe(true);
  });

  it('fecha_publicacion fuera queda excluida', () => {
    expect(
      noticiaEnVentanaEditorial('2026-09-20T08:00:00.000Z', '2026-09-23T00:00:00.000Z', CORTE),
    ).toBe(false);
  });

  it('publicación NULL y captura dentro usa el fallback', () => {
    expect(noticiaEnVentanaEditorial(null, '2026-09-23T08:00:00.000Z', CORTE)).toBe(true);
  });

  it('publicación NULL y captura fuera queda excluida', () => {
    expect(noticiaEnVentanaEditorial(null, '2026-09-20T08:00:00.000Z', CORTE)).toBe(false);
  });

  it('publicación vieja y captura nueva queda fuera del LIVE', () => {
    expect(
      noticiaEnVentanaEditorial('2026-09-18T08:00:00.000Z', '2026-09-24T08:00:00.000Z', CORTE),
    ).toBe(false);
  });
});

describe('consultasVentanaEditorial', () => {
  it('separa publicación reciente y captura solo si la publicación es NULL', () => {
    const [publicadas, sinPublicacion] = consultasVentanaEditorial(CORTE);
    expect(publicadas).toEqual([
      { columna: 'noticias.fecha_publicacion', op: 'gte', valor: CORTE },
    ]);
    expect(sinPublicacion).toEqual([
      { columna: 'noticias.fecha_publicacion', op: 'is', valor: null },
      { columna: 'noticias.fecha_captura', op: 'gte', valor: CORTE },
    ]);
  });
});

describe('fusionarMencionesExport', () => {
  it('deduplica mencion_id y respeta el límite recent-first', () => {
    const fusion = fusionarMencionesExport(
      [
        [
          { mencion_id: 'm-vieja', created_at: '2026-09-22T13:00:00.000Z' },
          { mencion_id: 'm-nueva', created_at: '2026-09-24T13:00:00.000Z' },
        ],
        [{ mencion_id: 'm-nueva', created_at: '2026-09-24T13:00:00.000Z' }],
      ],
      { limit: 1, recentFirst: true },
    );
    expect(fusion.map((f) => f.mencion_id)).toEqual(['m-nueva']);
  });
});

describe('mencion_id idempotente con ventana editorial', () => {
  it('el mismo mencion_id no se appendea dos veces', () => {
    const incoming = [{ mencion_id: 'm1' }, { mencion_id: 'm2' }];
    const first = planUniqueAppendByKey([], incoming, 'mencion_id');
    const second = planUniqueAppendByKey(
      first.to_append.map((r) => String(r.mencion_id)),
      incoming,
      'mencion_id',
    );
    expect(second.to_append).toEqual([]);
    expect(second.already_present_ids).toEqual(['m1', 'm2']);
  });
});
