import { describe, expect, it } from 'vitest';
import { appendRows } from '../scripts/mentions-master-fast-lane.js';

describe('ambiguous append recheck', () => {
  it('L — addRows persiste y lanza 502: relee dedupe, cero duplicado', async () => {
    const persisted: Array<Record<string, string>> = [];
    let addCalls = 0;
    const sheet = {
      headerValues: ['dedupe_key', 'NOTICIA', 'cliente_id'],
      loadHeaderRow: async () => undefined,
      getRows: async () => persisted.map((row) => ({ get: (k: string) => row[k] ?? '' })),
      addRows: async (rows: Array<Record<string, string>>) => {
        addCalls += 1;
        persisted.push(...rows);
        if (addCalls === 1) throw new Error('Request failed with status code 502');
      },
    };
    const row = {
      NOTICIA: '44022aec-a8a1-421a-9d97-54181371f9a6',
      cliente_id: 'CLI-MERY-TEST',
      dedupe_key: 'cli-mery-test//44022aec-a8a1-421a-9d97-54181371f9a6',
    };
    const out = await appendRows(sheet as never, [row], new Set(), false);
    expect(out.appended).toBe(1);
    expect(persisted).toHaveLength(1);
    expect(addCalls).toBe(1);
    const second = await appendRows(sheet as never, [row], new Set(persisted.map((r) => r.dedupe_key ?? '')), false);
    expect(second.appended).toBe(0);
    expect(second.skipped).toBe(1);
    expect(persisted).toHaveLength(1);
    expect(addCalls).toBe(1);
  });
});
