/**
 * Invariante cron → catálogo (S0).
 *
 * Cubre el incidente real: MED-0204 configurado en el tier daily-validated sin
 * fila en `medios`, y el cron siguiendo adelante con "47 de 48 encontrados".
 */
import { describe, it, expect } from 'vitest';
import {
  CRON_TIERS,
  cronConfiguredMedios,
  evaluarIntegridadCronCatalogo,
  verificarIntegridadCronCatalogo,
  describirIntegridadCronCatalogo,
  type CatalogMedioRef,
  type CronConfiguredMedio,
} from '../src/config/cronCatalogIntegrity.js';

function cfg(medio_id: string, tier: CronConfiguredMedio['tier'] = 'daily_validated'): CronConfiguredMedio {
  return { medio_id, tier, nombre: null };
}

function cat(medio_id: string, activo: boolean | null = true): CatalogMedioRef {
  return { medio_id, activo };
}

describe('evaluarIntegridadCronCatalogo — config válida', () => {
  it('sin huérfanos devuelve OK con los conteos', () => {
    const r = evaluarIntegridadCronCatalogo(
      [cfg('MED-0001'), cfg('MED-0002')],
      { ok: true, medios: [cat('MED-0001'), cat('MED-0002')] },
    );
    expect(r.status).toBe('OK');
    expect(r.configured_count).toBe(2);
    expect(r.catalog_count).toBe(2);
    expect(r.orphan_count).toBe(0);
    expect(r.orphan_ids).toEqual([]);
    expect(r.error).toBeNull();
  });

  it('un medio con activo=false existe: NO es huérfano, se reporta aparte', () => {
    const r = evaluarIntegridadCronCatalogo(
      [cfg('MED-0001'), cfg('MED-0002')],
      { ok: true, medios: [cat('MED-0001', true), cat('MED-0002', false)] },
    );
    expect(r.status).toBe('OK');
    expect(r.orphan_ids).toEqual([]);
    expect(r.inactive_ids).toEqual(['MED-0002']);
  });
});

describe('evaluarIntegridadCronCatalogo — huérfanos', () => {
  it('un solo huérfano', () => {
    const r = evaluarIntegridadCronCatalogo(
      [cfg('MED-0001'), cfg('MED-0204')],
      { ok: true, medios: [cat('MED-0001')] },
    );
    expect(r.status).toBe('ORPHANS_FOUND');
    expect(r.orphan_count).toBe(1);
    expect(r.orphan_ids).toEqual(['MED-0204']);
    expect(r.orphans[0]).toMatchObject({ medio_id: 'MED-0204', tier: 'daily_validated' });
  });

  it('varios huérfanos, ordenados y con su tier', () => {
    const r = evaluarIntegridadCronCatalogo(
      [cfg('MED-0300', 'base'), cfg('MED-0001'), cfg('MED-0204'), cfg('MED-0299', 'crisis')],
      { ok: true, medios: [cat('MED-0001')] },
    );
    expect(r.status).toBe('ORPHANS_FOUND');
    expect(r.orphan_count).toBe(3);
    expect(r.orphan_ids).toEqual(['MED-0204', 'MED-0299', 'MED-0300']);
    expect(r.orphans.map((o) => o.tier).sort()).toEqual(['base', 'crisis', 'daily_validated']);
  });

  it('catálogo vacío con cron no vacío: todos huérfanos, NO INFRA_ERROR', () => {
    const r = evaluarIntegridadCronCatalogo([cfg('MED-0001'), cfg('MED-0002')], {
      ok: true,
      medios: [],
    });
    expect(r.status).toBe('ORPHANS_FOUND');
    expect(r.catalog_count).toBe(0);
    expect(r.orphan_count).toBe(2);
  });
});

describe('evaluarIntegridadCronCatalogo — bordes', () => {
  it('IDs configurados duplicados se deduplican y se reportan', () => {
    const r = evaluarIntegridadCronCatalogo(
      [cfg('MED-0001', 'base'), cfg('MED-0001', 'crisis'), cfg('MED-0002')],
      { ok: true, medios: [cat('MED-0001'), cat('MED-0002')] },
    );
    expect(r.status).toBe('OK');
    expect(r.configured_count).toBe(2);
    expect(r.configured_entries).toBe(3);
    expect(r.duplicate_configured_ids).toEqual(['MED-0001']);
  });

  it('un ID duplicado y huérfano se cuenta una sola vez', () => {
    const r = evaluarIntegridadCronCatalogo(
      [cfg('MED-0204', 'base'), cfg('MED-0204', 'daily_validated')],
      { ok: true, medios: [] },
    );
    expect(r.orphan_count).toBe(1);
    expect(r.orphan_ids).toEqual(['MED-0204']);
    expect(r.duplicate_configured_ids).toEqual(['MED-0204']);
  });

  it('catálogo más grande que el cron no genera huérfanos', () => {
    const r = evaluarIntegridadCronCatalogo([cfg('MED-0001')], {
      ok: true,
      medios: [cat('MED-0001'), cat('MED-0002'), cat('MED-0003')],
    });
    expect(r.status).toBe('OK');
    expect(r.configured_count).toBe(1);
    expect(r.catalog_count).toBe(3);
    expect(r.orphan_count).toBe(0);
  });

  it('cron vacío es OK trivial', () => {
    const r = evaluarIntegridadCronCatalogo([], { ok: true, medios: [cat('MED-0001')] });
    expect(r.status).toBe('OK');
    expect(r.configured_count).toBe(0);
  });
});

describe('evaluarIntegridadCronCatalogo — fallo de DB ≠ catálogo vacío', () => {
  it('snapshot con error devuelve INFRA_ERROR sin declarar huérfanos', () => {
    const r = evaluarIntegridadCronCatalogo([cfg('MED-0001'), cfg('MED-0002')], {
      ok: false,
      error: 'PGRST002 schema cache',
    });
    expect(r.status).toBe('INFRA_ERROR');
    expect(r.catalog_count).toBeNull();
    expect(r.orphan_count).toBe(0);
    expect(r.orphan_ids).toEqual([]);
    expect(r.error).toContain('PGRST002');
  });
});

describe('verificarIntegridadCronCatalogo — loader inyectado', () => {
  it('pide exactamente los IDs únicos configurados', async () => {
    const pedidos: string[][] = [];
    const r = await verificarIntegridadCronCatalogo({
      configured: [cfg('MED-0001', 'base'), cfg('MED-0001', 'crisis'), cfg('MED-0002')],
      cargarCatalogo: async (ids) => {
        pedidos.push([...ids]);
        return ids.map((id) => cat(id));
      },
    });
    expect(pedidos).toEqual([['MED-0001', 'MED-0002']]);
    expect(r.status).toBe('OK');
  });

  it('un throw del loader se traduce a INFRA_ERROR, no a catálogo vacío', async () => {
    const r = await verificarIntegridadCronCatalogo({
      configured: [cfg('MED-0001')],
      cargarCatalogo: async () => {
        throw new Error('fetch failed');
      },
    });
    expect(r.status).toBe('INFRA_ERROR');
    expect(r.orphan_ids).toEqual([]);
    expect(r.error).toContain('fetch failed');
  });

  it('detecta el huérfano cuando el catálogo responde parcialmente', async () => {
    const r = await verificarIntegridadCronCatalogo({
      configured: [cfg('MED-0001'), cfg('MED-0204')],
      cargarCatalogo: async (ids) => ids.filter((id) => id !== 'MED-0204').map((id) => cat(id)),
    });
    expect(r.status).toBe('ORPHANS_FOUND');
    expect(r.orphan_ids).toEqual(['MED-0204']);
  });
});

describe('cronConfiguredMedios — cobertura de tiers', () => {
  it('cubre los cuatro tiers y no repite entradas dentro de un tier', () => {
    const todos = cronConfiguredMedios();
    expect(new Set(todos.map((m) => m.tier))).toEqual(new Set(CRON_TIERS));
    for (const tier of CRON_TIERS) {
      const ids = todos.filter((m) => m.tier === tier).map((m) => m.medio_id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('se puede acotar a un solo tier', () => {
    const soloDaily = cronConfiguredMedios(['daily_validated']);
    expect(soloDaily.every((m) => m.tier === 'daily_validated')).toBe(true);
    expect(soloDaily.length).toBeGreaterThan(0);
  });

  it('MED-0204 ya no está configurado en ningún tier', () => {
    expect(cronConfiguredMedios().map((m) => m.medio_id)).not.toContain('MED-0204');
  });

  it('incluye los 24 del shard B y los 40 del shard C en daily_validated', () => {
    const daily = cronConfiguredMedios(['daily_validated']).map((m) => m.medio_id);
    const b = [
      'MED-0019', 'MED-0024', 'MED-0026', 'MED-0040',
      'MED-0041', 'MED-0042', 'MED-0051', 'MED-0103',
      'MED-0107', 'MED-0191', 'MED-0007', 'MED-0058',
      'MED-0092', 'MED-0111', 'MED-0064', 'MED-0109',
      'MED-0113', 'MED-0044', 'MED-0014', 'MED-0086', 'MED-0130',
      'MED-0081', 'MED-0063', 'MED-0105',
    ];
    const c = [
      'MED-0106', 'MED-0124', 'MED-0072', 'MED-0080',
      'MED-0093', 'MED-0122', 'MED-0018', 'MED-0022',
      'MED-0009', 'MED-0116', 'MED-0091', 'MED-0138',
      'MED-0036', 'MED-0101', 'MED-0052', 'MED-0062',
      'MED-0095',
      'MED-0205', 'MED-0206', 'MED-0210', 'MED-0211', 'MED-0212', 'MED-0214',
      'MED-0215', 'MED-0216', 'MED-0217', 'MED-0218', 'MED-0219', 'MED-0220',
      'MED-0221', 'MED-0222', 'MED-0223', 'MED-0226', 'MED-0227', 'MED-0228',
      'MED-0229', 'MED-0230', 'MED-0231', 'MED-0233', 'MED-0234',
    ];
    for (const id of b) expect(daily).toContain(id);
    for (const id of c) expect(daily).toContain(id);
    expect(new Set(daily).size).toBe(daily.length);
    expect(daily).not.toContain('MED-0204');
    expect(daily).not.toContain('MED-0118');
    expect(daily).not.toContain('MED-0043');
  });
});

describe('describirIntegridadCronCatalogo', () => {
  it('distingue OK, huérfanos e INFRA_ERROR', () => {
    const ok = evaluarIntegridadCronCatalogo([cfg('MED-0001')], { ok: true, medios: [cat('MED-0001')] });
    expect(describirIntegridadCronCatalogo(ok)).toContain('OK');

    const orph = evaluarIntegridadCronCatalogo([cfg('MED-0204')], { ok: true, medios: [] });
    expect(describirIntegridadCronCatalogo(orph)).toContain('MED-0204[daily_validated]');

    const infra = evaluarIntegridadCronCatalogo([cfg('MED-0001')], { ok: false, error: 'boom' });
    expect(describirIntegridadCronCatalogo(infra)).toContain('INFRA_ERROR');
  });
});
