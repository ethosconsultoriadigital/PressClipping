import { describe, expect, it } from 'vitest';
import {
  compareViewRowsDesc,
  computeRoutingHash,
  incrementalStartRow,
  masterDedupeKey,
  parseKeywordIdsMatched,
  parseRouteRow,
  routeMasterRows,
  routedActiveKeywords,
  shouldFullRebuild,
  validateMentionRoutes,
  viewTabName,
  type MentionRoute,
  type MasterMentionRow,
} from '../src/routing/mentionPresentation.js';
import { loadMentionRoutesV1 } from '../src/routing/loadMentionRoutesV1.js';

function route(over: Partial<MentionRoute> & Pick<MentionRoute, 'route_id' | 'keyword_id' | 'vista_tipo' | 'vista_nombre'>): MentionRoute {
  return {
    detection_scope_id: 'CLI-0002',
    activo: true,
    prioridad: 'ALTA',
    notas: null,
    ...over,
  };
}

function row(over: Record<string, string>): MasterMentionRow {
  return { values: over };
}

describe('mention presentation routing', () => {
  it('single keyword → one view', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-0060', dedupe_key: 'a//1', NOTICIA: '1' })],
      [route({ route_id: 'R1', keyword_id: 'KEY-0060', vista_tipo: 'CLIENTE', vista_nombre: 'PATRÓN' })],
    );
    expect(plan.routed).toHaveLength(1);
    expect(plan.routed[0]?.view_name).toBe('CLIENTE · PATRÓN');
    expect(plan.unrouted).toHaveLength(0);
  });

  it('single keyword → multiple views', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-0009', dedupe_key: 'j//1' })],
      [
        route({ route_id: 'R1', keyword_id: 'KEY-0009', vista_tipo: 'CLIENTE', vista_nombre: 'JUMEX', detection_scope_id: 'CLI-0001' }),
        route({ route_id: 'R2', keyword_id: 'KEY-0009', vista_tipo: 'TEMA', vista_nombre: 'IEPS BEBIDAS AZUCARADAS', detection_scope_id: 'CLI-0001' }),
      ],
    );
    expect(plan.routed.map((r) => r.view_name).sort()).toEqual([
      'CLIENTE · JUMEX',
      'TEMA · IEPS BEBIDAS AZUCARADAS',
    ]);
    expect(plan.multi_view_master_keys).toEqual(['j//1']);
  });

  it('multiple keywords → same view dedupe', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-0040 | KEY-0041', dedupe_key: 'm//1', cliente_id: 'CLI-MERY-TEST', NOTICIA: '1' })],
      [
        route({ route_id: 'R1', keyword_id: 'KEY-0040', vista_tipo: 'PERSONA', vista_nombre: 'MERY POZOS', detection_scope_id: 'CLI-MERY-TEST' }),
        route({ route_id: 'R2', keyword_id: 'KEY-0041', vista_tipo: 'PERSONA', vista_nombre: 'MERY POZOS', detection_scope_id: 'CLI-MERY-TEST' }),
      ],
    );
    expect(plan.routed).toHaveLength(1);
    expect(plan.duplicate_suppressed).toBe(1);
  });

  it('multiple keywords → multiple views', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-0060|KEY-0003', dedupe_key: 'x//1' })],
      [
        route({ route_id: 'R1', keyword_id: 'KEY-0060', vista_tipo: 'CLIENTE', vista_nombre: 'PATRÓN' }),
        route({ route_id: 'R2', keyword_id: 'KEY-0003', vista_tipo: 'TEMA', vista_nombre: 'INDUSTRIA DEL TEQUILA' }),
      ],
    );
    expect(plan.routed).toHaveLength(2);
  });

  it('missing keyword_ids_matched falls back to keyword_id', () => {
    const ids = parseKeywordIdsMatched('', 'KEY-0030');
    expect(ids).toEqual(['KEY-0030']);
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: '', keyword_id: 'KEY-0030', dedupe_key: 't//1' })],
      [route({ route_id: 'R1', keyword_id: 'KEY-0030', vista_tipo: 'TEMA', vista_nombre: 'COMERCIO EXTERIOR BEBIDAS' })],
    );
    expect(plan.routed[0]?.view_name).toBe('TEMA · COMERCIO EXTERIOR BEBIDAS');
  });

  it('unknown keyword route is unrouted, not invented', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-UNKNOWN', dedupe_key: 'u//1' })],
      [route({ route_id: 'R1', keyword_id: 'KEY-0060', vista_tipo: 'CLIENTE', vista_nombre: 'PATRÓN' })],
    );
    expect(plan.routed).toHaveLength(0);
    expect(plan.unrouted[0]?.reason).toBe('UNKNOWN_KEYWORD_ROUTE');
  });

  it('inactive route is skipped', () => {
    const plan = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-0060', dedupe_key: 'a//1' })],
      [route({ route_id: 'R1', keyword_id: 'KEY-0060', vista_tipo: 'CLIENTE', vista_nombre: 'PATRÓN', activo: false })],
    );
    expect(plan.routed).toHaveLength(0);
    expect(plan.unrouted).toHaveLength(1);
  });

  it('INTERNAL hidden by default', () => {
    const routes = [
      route({
        route_id: 'R1',
        keyword_id: 'KEY-PRUEBA-LOCAL-001',
        vista_tipo: 'INTERNO',
        vista_nombre: 'COBERTURA LOCAL PRUEBA',
      }),
    ];
    const hidden = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-PRUEBA-LOCAL-001', dedupe_key: 'i//1' })],
      routes,
    );
    expect(hidden.routed).toHaveLength(0);
    const shown = routeMasterRows(
      [row({ keyword_ids_matched: 'KEY-PRUEBA-LOCAL-001', dedupe_key: 'i//1' })],
      routes,
      { includeInternal: true },
    );
    expect(shown.routed[0]?.view_name).toBe('INTERNO · COBERTURA LOCAL PRUEBA');
  });

  it('dedupe_key fallback cliente_id//NOTICIA then NOTICIA', () => {
    expect(masterDedupeKey({ dedupe_key: 'explicit' })).toBe('explicit');
    expect(masterDedupeKey({ cliente_id: 'CLI-0001', NOTICIA: 'abc' })).toBe('CLI-0001//abc');
    expect(masterDedupeKey({ NOTICIA: 'abc' })).toBe('abc');
  });

  it('duplicate route validation', () => {
    const v = validateMentionRoutes([
      route({ route_id: 'R1', keyword_id: 'KEY-1', vista_tipo: 'TEMA', vista_nombre: 'X' }),
      route({ route_id: 'R1', keyword_id: 'KEY-2', vista_tipo: 'TEMA', vista_nombre: 'Y' }),
      route({ route_id: 'R2', keyword_id: 'KEY-1', vista_tipo: 'TEMA', vista_nombre: 'X' }),
    ]);
    expect(v.ok).toBe(false);
    expect(v.duplicate_route_ids).toEqual(['R1']);
    expect(v.duplicate_route_keys.length).toBe(1);
  });

  it('invalid route fields fail closed', () => {
    const badTipo = parseRouteRow({
      route_id: 'R1',
      keyword_id: 'KEY-1',
      vista_tipo: 'MARCA',
      vista_nombre: 'X',
      activo: 'TRUE',
    });
    expect('code' in badTipo && badTipo.code).toBe('INVALID_VISTA_TIPO');
    const badBool = parseRouteRow({
      route_id: 'R2',
      keyword_id: 'KEY-1',
      vista_tipo: 'TEMA',
      vista_nombre: 'X',
      activo: 'quizá',
    });
    expect('code' in badBool && badBool.code).toBe('INVALID_ACTIVO');
  });

  it('routing hash change triggers full rebuild', () => {
    const a = [route({ route_id: 'R1', keyword_id: 'KEY-1', vista_tipo: 'TEMA', vista_nombre: 'X' })];
    const b = [route({ route_id: 'R1', keyword_id: 'KEY-1', vista_tipo: 'TEMA', vista_nombre: 'Y' })];
    const ha = computeRoutingHash(a);
    const hb = computeRoutingHash(b);
    expect(ha).not.toBe(hb);
    expect(
      shouldFullRebuild({
        routingHashNow: hb,
        routingHashPrev: ha,
        masterRowCount: 10,
        lastProcessedMasterRow: 10,
      }),
    ).toBe(true);
  });

  it('full rebuild when master shrinks below last processed', () => {
    expect(
      shouldFullRebuild({
        routingHashNow: 'abc',
        routingHashPrev: 'abc',
        masterRowCount: 5,
        lastProcessedMasterRow: 20,
      }),
    ).toBe(true);
    expect(incrementalStartRow(200, 150)).toBe(51);
  });

  it('sorts recent first using fecha_publicacion', () => {
    const rows = [
      { fecha_publicacion: '2026-01-01' },
      { fecha_publicacion: '2026-09-30' },
    ];
    rows.sort(compareViewRowsDesc);
    expect(rows[0]?.fecha_publicacion).toBe('2026-09-30');
  });

  it('seed V1: 72 routes, Cazadores→Bacardí, T-MEC trio, CRT not Patrón', () => {
    const routes = loadMentionRoutesV1();
    expect(routes).toHaveLength(72);
    expect(validateMentionRoutes(routes).ok).toBe(true);
    const caz = routes.find((r) => r.keyword_id === 'KEY-0070');
    expect(caz?.vista_tipo).toBe('CLIENTE');
    expect(caz?.vista_nombre).toBe('BACARDÍ');
    expect(viewTabName(caz!.vista_tipo, caz!.vista_nombre)).toBe('CLIENTE · BACARDÍ');
    const crt = routes.filter((r) => r.keyword_id === 'KEY-0063');
    expect(crt).toHaveLength(1);
    expect(crt[0]?.vista_nombre).toBe('INDUSTRIA DEL TEQUILA');
    for (const id of ['KEY-0030', 'KEY-0031', 'KEY-0032']) {
      const r = routes.find((x) => x.keyword_id === id);
      expect(r?.vista_nombre).toBe('COMERCIO EXTERIOR BEBIDAS');
    }
    expect(routes.some((r) => r.vista_nombre === 'CAZADORES')).toBe(false);
  });

  it('parseKeywordIdsMatched splits pipe with spaces', () => {
    expect(parseKeywordIdsMatched('KEY-0020 | KEY-0021')).toEqual(['KEY-0020', 'KEY-0021']);
  });
});

describe('routedActiveKeywords', () => {
  it('reports production keywords without route', () => {
    const routes = [
      route({ route_id: 'R1', keyword_id: 'KEY-0001', vista_tipo: 'CLIENTE', vista_nombre: 'JUMEX' }),
    ];
    const { without_route } = routedActiveKeywords(routes, ['KEY-0001', 'KEY-0030']);
    expect(without_route).toEqual(['KEY-0030']);
  });
});
