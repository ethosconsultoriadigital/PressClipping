import { describe, expect, it } from 'vitest';
import { mapKeywordRow, mapKeywordRowStrict, type Cliente, type Keyword } from '../src/types/schemas.js';
import type { RawRow } from '../src/sheets/read.js';
import {
  AUTO_SYNC_MAX_WRITES,
  buildControlPlanePlan,
  computeControlPlaneHash,
  parseControlPlaneArgs,
  runControlPlaneSync,
  type ControlPlaneIo,
} from '../src/sync/controlPlaneSync.js';

function cliente(over: Partial<Cliente> & Pick<Cliente, 'cliente_id' | 'nombre_cliente'>): Cliente {
  return {
    industria: 'Bebidas',
    marcas: null,
    competidores: null,
    voceros: null,
    temas_sensibles: null,
    activo: true,
    prioridad_ia: 'Alta',
    alertas_activas: false,
    notas: null,
    ...over,
  };
}

function keyword(
  over: Partial<Keyword> & Pick<Keyword, 'keyword_id' | 'cliente_id' | 'keyword'>,
): Keyword {
  return {
    cliente: 'Jumex',
    alias_o_variantes: null,
    tipo_keyword: 'contiene',
    regla: 'contiene',
    activa: true,
    prioridad: 'Alta',
    alerta: false,
    contexto_incluir: null,
    contexto_excluir: null,
    notas: null,
    ...over,
  };
}

function rawCliente(c: Cliente): RawRow {
  return {
    cliente_id: c.cliente_id,
    nombre_cliente: c.nombre_cliente,
    industria: c.industria ?? '',
    marcas: c.marcas ?? '',
    competidores: c.competidores ?? '',
    voceros: c.voceros ?? '',
    temas_sensibles: c.temas_sensibles ?? '',
    activo: c.activo ? 'TRUE' : 'FALSE',
    prioridad_ia: c.prioridad_ia ?? '',
    alertas_activas: c.alertas_activas ? 'TRUE' : 'FALSE',
    notas: c.notas ?? '',
  };
}

function rawKeyword(k: Keyword): RawRow {
  return {
    keyword_id: k.keyword_id,
    cliente_id: k.cliente_id ?? '',
    cliente: k.cliente ?? '',
    keyword: k.keyword,
    alias_o_variantes: k.alias_o_variantes ?? '',
    tipo_keyword: k.tipo_keyword,
    regla: k.regla ?? '',
    activa: k.activa ? 'TRUE' : 'FALSE',
    prioridad: k.prioridad ?? '',
    alerta: k.alerta ? 'TRUE' : 'FALSE',
    contexto_incluir: k.contexto_incluir ?? '',
    contexto_excluir: k.contexto_excluir ?? '',
    notas: k.notas ?? '',
  };
}

const jumex = cliente({ cliente_id: 'CLI-0001', nombre_cliente: 'Jumex' });
const alcohol = cliente({ cliente_id: 'CLI-0002', nombre_cliente: 'Bebidas alcoholicas' });
const keyTequila = keyword({
  keyword_id: 'KEY-0003',
  cliente_id: 'CLI-0002',
  cliente: 'Bebidas alcoholicas',
  keyword: 'tequila',
});

function ioFor(
  sheetC: RawRow[],
  sheetK: RawRow[],
  dbC: Cliente[],
  dbK: Keyword[],
  writes?: { clientes: Cliente[][]; keywords: Keyword[][] },
): ControlPlaneIo {
  let dbClientes = dbC;
  let dbKeywords = dbK;
  return {
    readClientesSheet: async () => sheetC,
    readKeywordsSheet: async () => sheetK,
    loadDbClientes: async () => dbClientes,
    loadDbKeywords: async () => dbKeywords,
    writeClientes: async (rows) => {
      writes?.clientes.push(rows);
      dbClientes = [
        ...dbClientes.filter((c) => !rows.some((r) => r.cliente_id === c.cliente_id)),
        ...rows,
      ];
      return rows.length;
    },
    writeKeywords: async (rows) => {
      writes?.keywords.push(rows);
      dbKeywords = [
        ...dbKeywords.filter((k) => !rows.some((r) => r.keyword_id === k.keyword_id)),
        ...rows,
      ];
      return rows.length;
    },
  };
}

describe('Control Plane Sync V2', () => {
  it('1. default mode = dry-run', () => {
    const parsed = parseControlPlaneArgs([]);
    expect(parsed).toEqual({
      apply: false,
      auto: false,
      expectedHash: null,
      entities: ['clientes', 'keywords'],
    });
  });

  it('2. --apply requires expected hash', async () => {
    const parsed = parseControlPlaneArgs(['--apply']);
    expect(parsed).toMatchObject({ apply: true, expectedHash: null });
    if ('error' in parsed) throw new Error('unexpected parse error');
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const result = await runControlPlaneSync(parsed, ioFor([], [], [], [], writes));
    expect(result.ok).toBe(false);
    expect(result.plan.abort_reason).toBe('APPLY_REQUIRES_EXPECTED_HASH');
    expect(result.writes).toBe(0);
    expect(writes.clientes).toHaveLength(0);
  });

  it('3. unknown keyword type → abort', async () => {
    const k = rawKeyword(keyTequila);
    k.tipo_keyword = 'inventado';
    const result = await runControlPlaneSync(
      { apply: false, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(alcohol)], [k], [alcohol], [keyTequila]),
    );
    expect(result.ok).toBe(false);
    expect(result.plan.invalid_rows.length).toBeGreaterThan(0);
    expect(result.writes).toBe(0);
  });

  it('4. blank keyword type → abort', async () => {
    const k = rawKeyword(keyTequila);
    k.tipo_keyword = '';
    const result = await runControlPlaneSync(
      { apply: false, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(alcohol)], [k], [alcohol], [keyTequila]),
    );
    expect(result.ok).toBe(false);
    expect(result.plan.invalid_rows.length).toBeGreaterThan(0);
    expect(result.writes).toBe(0);
  });

  it('5. duplicate client ID → abort', async () => {
    const result = await runControlPlaneSync(
      { apply: false, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor(
        [rawCliente(jumex), rawCliente({ ...jumex, notas: 'otra' })],
        [],
        [jumex],
        [],
      ),
    );
    expect(result.plan.abort_reason).toBe('DUPLICATE_CLIENT_IDS');
    expect(result.plan.duplicate_client_ids).toEqual(['CLI-0001']);
    expect(result.writes).toBe(0);
  });

  it('6. duplicate keyword ID → abort', async () => {
    const result = await runControlPlaneSync(
      { apply: false, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor(
        [rawCliente(alcohol)],
        [rawKeyword(keyTequila), rawKeyword({ ...keyTequila, alias_o_variantes: 'x' })],
        [alcohol],
        [keyTequila],
      ),
    );
    expect(result.plan.abort_reason).toBe('DUPLICATE_KEYWORD_IDS');
    expect(result.writes).toBe(0);
  });

  it('7. orphan keyword → abort', async () => {
    const orphan = keyword({
      keyword_id: 'KEY-ORPH',
      cliente_id: 'CLI-NOPE',
      keyword: 'x',
    });
    const result = await runControlPlaneSync(
      { apply: false, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(jumex)], [rawKeyword(orphan)], [jumex], []),
    );
    expect(result.plan.abort_reason).toBe('ORPHAN_KEYWORDS');
    expect(result.plan.orphan_keywords).toEqual(['KEY-ORPH']);
    expect(result.writes).toBe(0);
  });

  it('8. CLI-0001 Jumex→Empresas same ID → semantic conflict', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [cliente({ cliente_id: 'CLI-0001', nombre_cliente: 'Empresas' })],
      sheetKeywords: [],
      dbClientes: [jumex],
      dbKeywords: [],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.abort_reason).toBe('SEMANTIC_ID_CONFLICT');
    expect(plan.clientes.semantic_conflicts[0]?.panel).toBe('Empresas');
    expect(plan.client_writes).toHaveLength(0);
  });

  it('9. KEY-0003 tequila → Tequila Patrón same ID → semantic conflict', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [
        keyword({
          keyword_id: 'KEY-0003',
          cliente_id: 'CLI-0001',
          cliente: 'Jumex',
          keyword: 'Tequila Patrón',
        }),
      ],
      dbClientes: [alcohol, jumex],
      dbKeywords: [keyTequila],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.abort_reason).toBe('SEMANTIC_ID_CONFLICT');
    expect(plan.keyword_writes).toHaveLength(0);
  });

  it('10. alias change only → UPDATE allowed', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [{ ...keyTequila, alias_o_variantes: 'tequila blanco' }],
      dbClientes: [alcohol],
      dbKeywords: [keyTequila],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.aborted).toBe(false);
    expect(plan.keywords.update).toEqual(['KEY-0003']);
  });

  it('11. context change only → UPDATE allowed', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [{ ...keyTequila, contexto_incluir: 'CRT|agave' }],
      dbClientes: [alcohol],
      dbKeywords: [keyTequila],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.keywords.update).toEqual(['KEY-0003']);
  });

  it('12. activa true→false → UPDATE allowed', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [{ ...keyTequila, activa: false }],
      dbClientes: [alcohol],
      dbKeywords: [keyTequila],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.keywords.update).toEqual(['KEY-0003']);
  });

  it('13. alerta false→true → UPDATE allowed', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [{ ...keyTequila, alerta: true }],
      dbClientes: [alcohol],
      dbKeywords: [keyTequila],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.keywords.update).toEqual(['KEY-0003']);
  });

  it('14. new client → CREATE', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [jumex, alcohol],
      sheetKeywords: [],
      dbClientes: [jumex],
      dbKeywords: [],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.clientes.create).toEqual(['CLI-0002']);
  });

  it('15. new keyword with valid FK → CREATE', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [keyTequila],
      dbClientes: [alcohol],
      dbKeywords: [],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.keywords.create).toEqual(['KEY-0003']);
  });

  it('16. DB-only row → PRESERVE, no delete', () => {
    const extra = keyword({
      keyword_id: 'KEY-DBONLY',
      cliente_id: 'CLI-0002',
      keyword: 'histórica',
    });
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [keyTequila],
      dbClientes: [alcohol],
      dbKeywords: [keyTequila, extra],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.keywords.db_only_preserved).toEqual(['KEY-DBONLY']);
    expect(plan.keyword_writes.every((k) => k.keyword_id !== 'KEY-DBONLY')).toBe(true);
  });

  it('17. unchanged rows → 0 writes', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const hash = computeControlPlaneHash([alcohol], [keyTequila]);
    const result = await runControlPlaneSync(
      { apply: true, expectedHash: hash, entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(alcohol)], [rawKeyword(keyTequila)], [alcohol], [keyTequila], writes),
    );
    expect(result.verdict).toBe('NO_CHANGES_TO_APPLY');
    expect(result.writes).toBe(0);
    expect(writes.clientes).toHaveLength(0);
    expect(writes.keywords).toHaveLength(0);
    expect(result.plan.clientes.unchanged).toEqual(['CLI-0002']);
    expect(result.plan.keywords.unchanged).toEqual(['KEY-0003']);
  });

  it('18. hash deterministic despite input order', () => {
    const a = computeControlPlaneHash([jumex, alcohol], [keyTequila]);
    const b = computeControlPlaneHash([alcohol, jumex], [keyTequila]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('19. stale expected hash → abort before writes', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const result = await runControlPlaneSync(
      { apply: true, expectedHash: 'deadbeef', entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(alcohol)], [rawKeyword(keyTequila)], [alcohol], [keyTequila], writes),
    );
    expect(result.verdict).toBe('CONTROL_PLANE_CHANGED_SINCE_DRY_RUN');
    expect(result.writes).toBe(0);
    expect(writes.clientes).toHaveLength(0);
    expect(writes.keywords).toHaveLength(0);
  });

  it('20. readback mismatch → CONFIG_SYNC_FAIL', async () => {
    const nuevo = cliente({ cliente_id: 'CLI-PRUEBA', nombre_cliente: 'Prueba' });
    const hash = computeControlPlaneHash([jumex, nuevo], []);
    const io: ControlPlaneIo = {
      readClientesSheet: async () => [rawCliente(jumex), rawCliente(nuevo)],
      readKeywordsSheet: async () => [],
      loadDbClientes: async () => [jumex],
      loadDbKeywords: async () => [],
      writeClientes: async () => 1,
      writeKeywords: async () => 0,
    };
    const result = await runControlPlaneSync(
      { apply: true, expectedHash: hash, entities: ['clientes', 'keywords'] },
      io,
    );
    expect(result.verdict).toBe('CONFIG_SYNC_FAIL');
    expect(result.panel_target_drift.length).toBeGreaterThan(0);
    expect(result.panel_target_drift[0]?.id).toBe('CLI-PRUEBA');
  });

  it('legacy mapKeywordRow still coerces unknown tipo; strict no', () => {
    const row = {
      keyword_id: 'k1',
      keyword: 'tequila',
      tipo_keyword: 'inventado',
      activa: 'si',
    };
    const legacy = mapKeywordRow(row);
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.tipo_keyword).toBe('contiene');
    const strict = mapKeywordRowStrict(row);
    expect(strict.success).toBe(false);
  });

  it('rejects medios/config entities', () => {
    const parsed = parseControlPlaneArgs(['--entities=medios']);
    expect(parsed).toEqual({ error: 'UNSUPPORTED_IN_CONTROL_PLANE_V2' });
  });

  it('null vs empty does not create UPDATE', () => {
    const plan = buildControlPlanePlan({
      mode: 'DRY_RUN',
      sheetClientes: [alcohol],
      sheetKeywords: [{ ...keyTequila, notas: null, contexto_excluir: null }],
      dbClientes: [alcohol],
      dbKeywords: [{ ...keyTequila, notas: '', contexto_excluir: '' } as Keyword],
      invalid_rows: [],
      duplicate_client_ids: [],
      duplicate_keyword_ids: [],
      orphan_keywords: [],
    });
    expect(plan.keywords.update).toEqual([]);
    expect(plan.keywords.unchanged).toEqual(['KEY-0003']);
  });
});

describe('Control Plane Auto-Sync V1', () => {
  it('rejects --auto with --apply', () => {
    expect(parseControlPlaneArgs(['--auto', '--apply'])).toEqual({
      error: 'AUTO_INCOMPATIBLE_WITH_APPLY',
    });
  });

  it('invalid boolean → abort 0 writes', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const bad = rawCliente(jumex);
    bad.activo = 'quizá';
    const result = await runControlPlaneSync(
      { apply: false, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([bad], [], [jumex], [], writes),
    );
    expect(result.ok).toBe(false);
    expect(result.sync_verdict).toBe('CONTROL_PLANE_SYNC_ABORTED');
    expect(result.plan.invalid_rows.some((r) => r.issues.some((i) => i.includes('invalid boolean')))).toBe(true);
    expect(result.writes).toBe(0);
    expect(writes.clientes).toHaveLength(0);
  });

  it('missing required nombre_cliente → abort', async () => {
    const row = rawCliente(jumex);
    row.nombre_cliente = '';
    const result = await runControlPlaneSync(
      { apply: false, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([row], [], [jumex], []),
    );
    expect(result.sync_verdict).toBe('CONTROL_PLANE_SYNC_ABORTED');
    expect(result.plan.invalid_rows.length).toBeGreaterThan(0);
    expect(result.writes).toBe(0);
  });

  it('--auto with no drift → NO_CHANGES 0 writes', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const result = await runControlPlaneSync(
      { apply: false, auto: true, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(alcohol)], [rawKeyword(keyTequila)], [alcohol], [keyTequila], writes),
    );
    expect(result.ok).toBe(true);
    expect(result.sync_verdict).toBe('CONTROL_PLANE_SYNC_NO_CHANGES');
    expect(result.writes).toBe(0);
    expect(writes.clientes).toHaveLength(0);
    expect(writes.keywords).toHaveLength(0);
  });

  it('--auto notas-only update → 1 client write', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const sheet = { ...jumex, notas: 'AUTO_SYNC_CANARY' };
    const result = await runControlPlaneSync(
      { apply: false, auto: true, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(sheet)], [], [jumex], [], writes),
    );
    expect(result.ok).toBe(true);
    expect(result.sync_verdict).toBe('CONTROL_PLANE_SYNC_PASS');
    expect(result.plan.clientes.update).toEqual(['CLI-0001']);
    expect(result.writes).toBe(1);
    expect(writes.clientes).toHaveLength(1);
    expect(writes.keywords).toHaveLength(1);
    expect(writes.keywords[0]).toHaveLength(0);
  });

  it('--auto TOCTOU: sheet change between plan and apply → abort 0 writes', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    let reads = 0;
    const io: ControlPlaneIo = {
      readClientesSheet: async () => {
        reads += 1;
        const notas = reads === 1 ? 'v1' : 'v2';
        return [rawCliente({ ...alcohol, notas })];
      },
      readKeywordsSheet: async () => [rawKeyword(keyTequila)],
      loadDbClientes: async () => [alcohol],
      loadDbKeywords: async () => [keyTequila],
      writeClientes: async (rows) => {
        writes.clientes.push(rows);
        return rows.length;
      },
      writeKeywords: async (rows) => {
        writes.keywords.push(rows);
        return rows.length;
      },
    };
    const result = await runControlPlaneSync(
      { apply: false, auto: true, expectedHash: null, entities: ['clientes', 'keywords'] },
      io,
    );
    expect(result.verdict).toBe('CONTROL_PLANE_CHANGED_SINCE_DRY_RUN');
    expect(result.sync_verdict).toBe('CONTROL_PLANE_SYNC_ABORTED');
    expect(result.writes).toBe(0);
    expect(writes.clientes).toHaveLength(0);
  });

  it('inactive client field still syncs (activo true→false)', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const result = await runControlPlaneSync(
      { apply: false, auto: true, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor(
        [rawCliente({ ...jumex, activo: false })],
        [],
        [jumex],
        [],
        writes,
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.plan.clientes.update).toEqual(['CLI-0001']);
    expect(result.writes).toBe(1);
  });

  it('--auto new keyword with valid client → CREATE', async () => {
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const result = await runControlPlaneSync(
      { apply: false, auto: true, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor([rawCliente(alcohol)], [rawKeyword(keyTequila)], [alcohol], [], writes),
    );
    expect(result.ok).toBe(true);
    expect(result.plan.keywords.create).toEqual(['KEY-0003']);
    expect(result.writes).toBe(1);
  });

  it('--auto never deletes DB-only keyword', async () => {
    const extra = keyword({
      keyword_id: 'KEY-DBONLY',
      cliente_id: 'CLI-0002',
      keyword: 'histórica',
    });
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const result = await runControlPlaneSync(
      { apply: false, auto: true, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor(
        [rawCliente(alcohol)],
        [rawKeyword(keyTequila)],
        [alcohol],
        [keyTequila, extra],
        writes,
      ),
    );
    expect(result.sync_verdict).toBe('CONTROL_PLANE_SYNC_NO_CHANGES');
    expect(result.plan.keywords.db_only_preserved).toEqual(['KEY-DBONLY']);
    expect(result.writes).toBe(0);
    expect(writes.keywords).toHaveLength(0);
  });

  it('--auto write cap aborts unexpected flood', async () => {
    const many = Array.from({ length: AUTO_SYNC_MAX_WRITES + 1 }, (_, i) =>
      keyword({
        keyword_id: `KEY-FLOOD-${String(i).padStart(3, '0')}`,
        cliente_id: 'CLI-0002',
        keyword: `flood-${i}`,
      }),
    );
    const writes = { clientes: [] as Cliente[][], keywords: [] as Keyword[][] };
    const result = await runControlPlaneSync(
      { apply: false, auto: true, expectedHash: null, entities: ['clientes', 'keywords'] },
      ioFor(
        [rawCliente(alcohol)],
        many.map(rawKeyword),
        [alcohol],
        [],
        writes,
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.plan.abort_reason).toMatch(/^AUTO_SYNC_WRITE_CAP:/);
    expect(result.writes).toBe(0);
    expect(writes.keywords).toHaveLength(0);
  });
});
