import { describe, it, expect } from 'vitest';
import { NUEVOS_MEDIOS } from '../scripts/catalog-national-expansion-lote2.js';
import { medioSchema } from '../src/types/schemas.js';
import { SHADOW_MEDIOS_DAILY_VALIDATED } from '../src/config/shadowMedia.js';

describe('catalog-national-expansion-lote2 — NUEVOS_MEDIOS', () => {
  it('contiene exactamente Político MX (MED-0186) y AF Medios (MED-0187)', () => {
    expect(NUEVOS_MEDIOS.map((m) => m.medio_id).sort()).toEqual(['MED-0186', 'MED-0187']);
  });

  it('cada fila valida contra el esquema real de la tabla medios', () => {
    for (const m of NUEVOS_MEDIOS) {
      const r = medioSchema.safeParse(m);
      expect(r.success, r.success ? '' : `${m.medio_id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });

  it('ninguno requiere proxy ni JavaScript', () => {
    for (const m of NUEVOS_MEDIOS) {
      expect(m.requiere_proxy).toBe(false);
      expect(m.requiere_javascript).toBe(false);
    }
  });

  it('ambos ya están en el tier daily-validated', () => {
    const ids = SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id);
    expect(ids).toContain('MED-0186');
    expect(ids).toContain('MED-0187');
  });
});
