import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchKeyword, type KeywordRule } from '../src/matchers/keyword.js';
import {
  camposBodyLane,
  evaluarTitleOnly,
  reglaAptaTitleOnly,
  enVentanaTitleOnly,
} from '../src/matching/titleOnlyLane.js';
import { clasificarContenido, esBrechaContenidoPrioritario } from '../src/matching/contentState.js';
import { argsRecoveryBody, argsRecoveryClean, parsePriorityMediaIds } from '../src/matching/priorityRecoveryPlan.js';
import { noticiaEnVentanaEditorial } from '../src/exporters/liveNewsWindow.js';
import { parseTitleOnlyArgs } from '../scripts/detect-title-only-mentions.js';

const MERY: KeywordRule = {
  keyword_id: 'KEY-0041',
  cliente_id: 'CLI-MERY-TEST',
  keyword: 'Mery Pozos',
  terminos: ['Mery Pozos'],
  tipo: 'frase_exacta',
  regla: null,
  contextoIncluir: [],
  contextoExcluir: [],
};
const JUMEX: KeywordRule = {
  keyword_id: 'KEY-0001',
  cliente_id: 'CLI-0001',
  keyword: 'Jumex',
  terminos: ['Jumex'],
  tipo: 'exacta',
  regla: null,
  contextoIncluir: [],
  contextoExcluir: [],
};
const TEQUILA: KeywordRule = {
  ...JUMEX,
  keyword_id: 'KEY-0003',
  cliente_id: 'CLI-0002',
  keyword: 'tequila',
  terminos: ['tequila'],
  tipo: 'contiene',
};
const CONTEXTUAL: KeywordRule = {
  ...MERY,
  keyword_id: 'KEY-0048',
  keyword: 'Merilyn Gómez',
  terminos: ['Merilyn Gómez'],
  tipo: 'exacta_contextual',
  contextoIncluir: ['diputada'],
};
const BOOLEANA: KeywordRule = {
  ...MERY,
  keyword_id: 'KEY-BOOL',
  keyword: 'Mery AND Pozos',
  terminos: ['Mery', 'Pozos'],
  tipo: 'booleana',
  regla: 'Mery AND Pozos',
};

const CORTE = '2026-09-22T12:00:00.000Z';

describe('body lane no depende del título', () => {
  it('título genérico y Mery en el cuerpo hace MATCH', () => {
    const campos = camposBodyLane({
      titulo: 'Presupuesto estatal registra nuevo incremento',
      texto_cuerpo_nota: 'En la sesión, la diputada Mery Pozos señaló el rezago del agua.',
    });
    const res = matchKeyword(MERY, campos);
    expect(res).not.toBeNull();
    expect(res!.campo).toBe('texto_extraido');
    expect(campos.find((c) => c.nombre === 'titulo')!.texto.includes('Mery')).toBe(false);
  });

  it('recovery que llena el cuerpo permite el match de body lane', () => {
    const antes = camposBodyLane({
      titulo: 'Presupuesto estatal registra nuevo incremento',
      texto_cuerpo_nota: null,
    });
    expect(matchKeyword(MERY, antes)).toBeNull();
    const despues = camposBodyLane({
      titulo: 'Presupuesto estatal registra nuevo incremento',
      texto_cuerpo_nota: 'La diputada Mery Pozos señaló el rezago.',
    });
    expect(matchKeyword(MERY, despues)?.texto_match).toContain('Mery Pozos');
  });
});

describe('title-only lane', () => {
  it('frase exacta en título hace match y no marca procesado', () => {
    const matches = evaluarTitleOnly(
      {
        noticia_id: 'n-informador',
        titulo: 'Mery Pozos destaca presupuesto histórico',
        texto_cuerpo_nota: null,
      } as never,
      [MERY, TEQUILA, CONTEXTUAL, BOOLEANA],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.keyword_id).toBe('KEY-0041');
    expect(matches[0]!.field_match).toBe('titulo');
    expect(matches[0]!.source_lane).toBe('TITLE_ONLY');
    expect(matches[0]!.mark_processed).toBe(false);
  });

  it('exacta en título entra; contiene, contextual y booleana quedan fuera', () => {
    const noticia = {
      noticia_id: 'n1',
      titulo: 'Jumex y el tequila de la diputada Merilyn Gómez',
      resumen: 'Mery AND Pozos',
    };
    expect(reglaAptaTitleOnly(JUMEX)).toBe(true);
    expect(reglaAptaTitleOnly(TEQUILA)).toBe(false);
    expect(reglaAptaTitleOnly(CONTEXTUAL)).toBe(false);
    expect(reglaAptaTitleOnly(BOOLEANA)).toBe(false);
    const matches = evaluarTitleOnly(noticia, [JUMEX, TEQUILA, CONTEXTUAL, BOOLEANA, MERY]);
    expect(matches.map((m) => m.tipo_match).sort()).toEqual(['exacta']);
    expect(matches.every((m) => m.mark_processed === false)).toBe(true);
  });

  it('el mismo par noticia+keyword no se repite', () => {
    const doble = evaluarTitleOnly(
      { noticia_id: 'n1', titulo: 'Mery Pozos', subtitulo: 'Mery Pozos otra vez' },
      [MERY, MERY],
    );
    expect(doble).toHaveLength(1);
  });

  it('publicación vieja queda fuera aunque la captura sea nueva', () => {
    expect(
      enVentanaTitleOnly(
        { fecha_publicacion: '2026-09-18T08:00:00.000Z', fecha_captura: '2026-09-24T08:00:00.000Z' },
        CORTE,
      ),
    ).toBe(false);
  });

  it('publicación NULL usa fecha_captura', () => {
    expect(enVentanaTitleOnly({ fecha_publicacion: null, fecha_captura: '2026-09-23T08:00:00.000Z' }, CORTE)).toBe(true);
    expect(enVentanaTitleOnly({ fecha_publicacion: null, fecha_captura: '2026-09-20T08:00:00.000Z' }, CORTE)).toBe(false);
    expect(noticiaEnVentanaEditorial('2026-09-23T00:00:00.000Z', null, CORTE)).toBe(true);
  });
});

describe('caso imposible y recovery', () => {
  it('título genérico sin texto es PRIORITY_CONTENT_GAP y no inventa match', () => {
    const noticia = {
      titulo: 'Congreso analiza presupuesto',
      subtitulo: null,
      resumen: null,
      texto_nota_limpia: null,
      texto_cuerpo_nota: null,
      texto_extraido: null,
    };
    expect(clasificarContenido(noticia)).toBe('TITLE_ONLY');
    expect(evaluarTitleOnly({ noticia_id: 'gap', ...noticia }, [MERY, JUMEX])).toEqual([]);
    expect(
      esBrechaContenidoPrioritario({
        estado: 'TITLE_ONLY',
        medioId: 'MED-0017',
        priorityMediaIds: ['MED-0017'],
        tieneMatchTituloSeguro: false,
      }),
    ).toBe(true);
  });

  it('el plan de recovery en dry-run lleva --dry-run en los dos pasos y no escribe', () => {
    const input = { mediaIds: parsePriorityMediaIds('MED-0017'), dryRun: true, limit: 50, windowDays: 2 };
    const clean = argsRecoveryClean(input);
    const body = argsRecoveryBody(input);
    expect(clean).toContain('--only-missing-clean-text');
    expect(body).toContain('--only-missing-body-text');
    expect(clean).toContain('--dry-run');
    expect(body).toContain('--dry-run');
    expect(clean.join(' ')).not.toContain('force-refresh');
    expect(body.join(' ')).not.toContain('force-refresh');
  });
});

describe('workflow live-mentions-fresh', () => {
  const wf = readFileSync(join(process.cwd(), '.github/workflows/live-mentions-fresh.yml'), 'utf8');

  it('no tiene schedule', () => {
    expect(wf).not.toMatch(/^\s*schedule:/m);
    expect(wf).toContain('workflow_dispatch');
    expect(wf).toContain('cancel-in-progress: false');
    expect(wf).toContain('group: live-comparison-shadow');
  });

  it('dry_run=true pasa --dry-run a los dos enrich', () => {
    const clean = wf.indexOf('only-missing-clean-text');
    const body = wf.indexOf('only-missing-body-text');
    const detect = wf.indexOf('detect-mentions');
    const title = wf.indexOf('detect-title-only');
    const exp = wf.indexOf('export-results');
    expect(clean).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(clean);
    expect(detect).toBeGreaterThan(body);
    expect(title).toBeGreaterThan(detect);
    expect(exp).toBeGreaterThan(title);
    const bloque = wf.slice(clean - 400, body + 500);
    expect(bloque.match(/--dry-run/g)?.length).toBeGreaterThanOrEqual(2);
    expect(wf).toContain('PRIORITY_MENTION_MEDIA_IDS');
    expect(wf).toContain("default: 'true'");
  });
});

describe('parseTitleOnlyArgs', () => {
  it('default barre 48h con página 500 y tope 10000', () => {
    expect(parseTitleOnlyArgs([])).toEqual({
      dryRun: false,
      hours: 48,
      pageSize: 500,
      maxScan: 10000,
      legacyLimit: null,
    });
    const live = parseTitleOnlyArgs(['--dry-run', '--hours=48', '--page-size=500', '--max-scan=10000']);
    expect(live.dryRun).toBe(true);
    expect(live.maxScan).toBe(10000);
    expect(parseTitleOnlyArgs(['--limit=500']).legacyLimit).toBe(500);
    expect(parseTitleOnlyArgs(['--limit=500']).maxScan).toBe(10000);
  });
});
