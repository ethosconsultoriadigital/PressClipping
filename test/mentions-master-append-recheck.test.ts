import { describe, expect, it } from 'vitest';
import { appendRows, MASTER_WRITE_ATTEMPTS } from '../scripts/mentions-master-fast-lane.js';

const NO_SLEEP = { sleep: async () => undefined, backoffMs: [0, 0, 0, 0] as const };

function row(id: string) {
  return {
    NOTICIA: id,
    cliente_id: 'CLI-MERY-TEST',
    dedupe_key: `cli-mery-test//${id}`,
  };
}

function mockSheet(opts: {
  onAdd: (rows: Array<Record<string, string>>, call: number, persisted: Array<Record<string, string>>) => void;
}) {
  const persisted: Array<Record<string, string>> = [];
  let addCalls = 0;
  const sheet = {
    headerValues: ['dedupe_key', 'NOTICIA', 'cliente_id'],
    loadHeaderRow: async () => undefined,
    getRows: async () => persisted.map((r) => ({ get: (k: string) => r[k] ?? '' })),
    addRows: async (rows: Array<Record<string, string>>) => {
      addCalls += 1;
      opts.onAdd(rows, addCalls, persisted);
    },
  };
  return { sheet, persisted, addCalls: () => addCalls };
}

describe('ambiguous append recheck after every transient write', () => {
  it('A — primer intento persiste y devuelve 502', async () => {
    const m = mockSheet({
      onAdd: (rows, call, persisted) => {
        persisted.push(...rows);
        if (call === 1) throw new Error('Request failed with status code 502');
      },
    });
    const out = await appendRows(m.sheet as never, [row('a1')], new Set(), false, NO_SLEEP);
    expect(out.appended).toBe(1);
    expect(m.persisted).toHaveLength(1);
    expect(m.addCalls()).toBe(1);
  });

  it('B — primer 502 sin persistir; segundo persiste y también 502', async () => {
    const m = mockSheet({
      onAdd: (rows, call, persisted) => {
        if (call === 1) throw new Error('Request failed with status code 502');
        persisted.push(...rows);
        throw new Error('Request failed with status code 502');
      },
    });
    const out = await appendRows(m.sheet as never, [row('b1')], new Set(), false, NO_SLEEP);
    expect(out.appended).toBe(1);
    expect(m.persisted).toHaveLength(1);
    expect(m.addCalls()).toBe(2);
  });

  it('C — commit parcial de chunk y 504 reintenta solo la faltante', async () => {
    const payloads: string[][] = [];
    const m = mockSheet({
      onAdd: (rows, call, persisted) => {
        payloads.push(rows.map((r) => String(r.dedupe_key ?? '')));
        if (call === 1) {
          persisted.push(rows[0]!, rows[1]!);
          throw new Error('Request failed with status code 504');
        }
        persisted.push(...rows);
      },
    });
    const rows = [row('c1'), row('c2'), row('c3')];
    const out = await appendRows(m.sheet as never, rows, new Set(), false, NO_SLEEP);
    expect(out.appended).toBe(3);
    expect(m.persisted).toHaveLength(3);
    expect(m.addCalls()).toBe(2);
    expect(payloads[0]).toHaveLength(3);
    expect(payloads[1]).toEqual(['cli-mery-test//c3']);
    expect(m.persisted.map((r) => r.dedupe_key)).toEqual([
      'cli-mery-test//c1',
      'cli-mery-test//c2',
      'cli-mery-test//c3',
    ]);
  });

  it('D — 502 persistente sin ninguna fila confirmada', async () => {
    const m = mockSheet({
      onAdd: () => {
        throw new Error('Request failed with status code 502');
      },
    });
    await expect(
      appendRows(m.sheet as never, [row('d1')], new Set(), false, {
        ...NO_SLEEP,
        maxAttempts: MASTER_WRITE_ATTEMPTS,
      }),
    ).rejects.toThrow(/MASTER append incompleto/);
    expect(m.addCalls()).toBe(MASTER_WRITE_ATTEMPTS);
    expect(m.persisted).toHaveLength(0);
  });

  it('E — 400/401/403 una sola llamada sin retry', async () => {
    for (const status of [400, 401, 403]) {
      const m = mockSheet({
        onAdd: () => {
          throw new Error(`Request failed with status code ${status}`);
        },
      });
      await expect(appendRows(m.sheet as never, [row(`e${status}`)], new Set(), false, NO_SLEEP)).rejects.toThrow(
        String(status),
      );
      expect(m.addCalls()).toBe(1);
      expect(m.persisted).toHaveLength(0);
    }
  });

  it('F — 429 sin persistencia: relectura, backoff y retry limitado', async () => {
    const waits: number[] = [];
    const m = mockSheet({
      onAdd: (rows, call, persisted) => {
        if (call === 1) throw new Error('[429] Quota exceeded');
        persisted.push(...rows);
      },
    });
    const out = await appendRows(m.sheet as never, [row('f1')], new Set(), false, {
      backoffMs: [7, 0, 0, 0],
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(out.appended).toBe(1);
    expect(m.addCalls()).toBe(2);
    expect(m.persisted).toHaveLength(1);
    expect(waits).toEqual([7]);
  });

  it('G — transporte después de persistir no duplica', async () => {
    for (const msg of ['read ECONNRESET', 'Premature close', 'connect ETIMEDOUT']) {
      const m = mockSheet({
        onAdd: (rows, _call, persisted) => {
          persisted.push(...rows);
          throw new Error(msg);
        },
      });
      const out = await appendRows(m.sheet as never, [row(`g-${msg}`)], new Set(), false, NO_SLEEP);
      expect(out.appended, msg).toBe(1);
      expect(m.persisted, msg).toHaveLength(1);
      expect(m.addCalls(), msg).toBe(1);
    }
  });

  it('H — rerun con dedupe existente no llama addRows', async () => {
    const m = mockSheet({ onAdd: () => undefined });
    const existing = new Set(['cli-mery-test//h1']);
    const out = await appendRows(m.sheet as never, [row('h1')], existing, false, NO_SLEEP);
    expect(out.appended).toBe(0);
    expect(out.skipped).toBe(1);
    expect(out.would_append).toBe(0);
    expect(m.addCalls()).toBe(0);
  });
});
