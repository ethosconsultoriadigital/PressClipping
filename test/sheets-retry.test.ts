import { describe, it, expect, vi, afterEach } from 'vitest';
import { esErrorSheetsReintetnable, withSheetsRetry } from '../src/sheets/client.js';

describe('esErrorSheetsReintetnable', () => {
  it('reintenta ante cuota/rate-limit (429)', () => {
    expect(esErrorSheetsReintetnable(new Error('[429] Quota exceeded for quota metric'))).toBe(true);
    expect(esErrorSheetsReintetnable(new Error('rateLimitExceeded'))).toBe(true);
    expect(esErrorSheetsReintetnable(new Error('userRateLimitExceeded'))).toBe(true);
  });

  it('reintenta ante 503/backendError', () => {
    expect(esErrorSheetsReintetnable(new Error('[503] backendError'))).toBe(true);
  });

  it('reintenta ante fallos de transporte', () => {
    expect(esErrorSheetsReintetnable(new Error('Premature close'))).toBe(true);
    expect(esErrorSheetsReintetnable(new Error('read ECONNRESET'))).toBe(true);
    expect(esErrorSheetsReintetnable(new Error('connect ETIMEDOUT'))).toBe(true);
  });

  it('NO reintenta ante credenciales/permiso/404', () => {
    expect(esErrorSheetsReintetnable(new Error('invalid credentials'))).toBe(false);
    expect(esErrorSheetsReintetnable(new Error('The caller does not have permission'))).toBe(false);
    expect(esErrorSheetsReintetnable(new Error('Requested entity was not found'))).toBe(false);
  });
});

describe('withSheetsRetry (backoff)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reintenta un 429 y termina devolviendo el resultado', async () => {
    vi.useFakeTimers();
    let intentos = 0;
    const op = vi.fn(async () => {
      intentos += 1;
      if (intentos < 3) throw new Error('[429] Quota exceeded');
      return 'ok';
    });
    const p = withSheetsRetry(op, 'test-429');
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('NO reintenta un error no recuperable (1 sola llamada)', async () => {
    const op = vi.fn(async () => {
      throw new Error('invalid credentials');
    });
    await expect(withSheetsRetry(op, 'test-auth')).rejects.toThrow('invalid credentials');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras 4 intentos si el 429 persiste', async () => {
    vi.useFakeTimers();
    const op = vi.fn(async () => {
      throw new Error('[429] Quota exceeded');
    });
    const p = withSheetsRetry(op, 'test-persist');
    const expectation = expect(p).rejects.toThrow('429');
    await vi.runAllTimersAsync();
    await expectation;
    expect(op).toHaveBeenCalledTimes(4);
  });
});
