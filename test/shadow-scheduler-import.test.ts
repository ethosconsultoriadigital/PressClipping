import { describe, it, expect, vi } from 'vitest';
import { logger } from '../src/utils/logger.js';

/**
 * Anti-regresión del hotfix: importar la config o el scheduler NO debe ejecutar
 * el ciclo sombra (nada de banner/spawn/crawl/compare). main() solo corre por CLI.
 */
describe('hotfix import side-effects', () => {
  it('SHADOW_MEDIOS (config puro) expone los 25 medios curados', async () => {
    const { SHADOW_MEDIOS } = await import('../src/config/shadowMedia.js');
    expect(SHADOW_MEDIOS).toHaveLength(25);
    expect(SHADOW_MEDIOS.every((m) => /^MED-\d{4}$/.test(m))).toBe(true);
  });

  it('importar run-shadow-scheduler NO ejecuta main() (sin banner de inicio)', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const mod = await import('../scripts/run-shadow-scheduler.js');
    expect(typeof mod.main).toBe('function');
    expect(mod.SHADOW_MEDIOS).toHaveLength(25);
    // main() emite "=== Iniciando SHADOW SCHEDULER ===" al arrancar; no debe ocurrir.
    const llamadas = infoSpy.mock.calls.map((c) => JSON.stringify(c));
    expect(llamadas.some((c) => c.includes('SHADOW SCHEDULER'))).toBe(false);
    infoSpy.mockRestore();
  });
});
