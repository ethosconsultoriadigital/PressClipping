/**
 * KEYWORD POLICY V1 — matcher + planner + no-alert.
 *
 * No toca red. No envía nada.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { foldText } from '../src/matchers/text.js';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
} from '../src/matchers/keyword.js';
import {
  esKeywordJumexAmpliaCli0001,
  pasaPuertaContextualClienteKeyword,
} from '../src/matching/contextualKeywordRules.js';
import {
  POLICY_ENSURE_ROWS,
  POLICY_DEACTIVATE_IDS,
  POLICY_RESERVED_NEW_IDS,
  POLICY_CLIENT_IDS,
  SUGGESTED_KEYWORDS_NOT_APPLIED,
  hasReversedTequilaPatronAlias,
  planPriorityClientKeywordsV1,
} from '../src/config/priorityClientKeywordsV1.js';
import { keywordToSheetCells } from '../src/sheets/keywordDirectedUpsert.js';
import { parsePolicyArgs } from '../scripts/apply-priority-client-keywords-v1.js';
import type { Keyword } from '../src/types/schemas.js';

function campos(titulo: string, cuerpo = ''): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: titulo, peso: PESOS_CAMPO.titulo! },
    { nombre: 'texto_extraido', texto: cuerpo, peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: 'Medio X', peso: PESOS_CAMPO.medio! },
  ];
}

function frase(keyword: string, alias?: string | null, cliente = 'CLI-0002'): KeywordRule {
  return {
    keyword_id: 'KEY-TEST',
    cliente_id: cliente,
    keyword,
    terminos: splitTerminos(keyword, alias ?? null),
    tipo: 'frase_exacta',
    regla: null,
    contextoIncluir: [],
    contextoExcluir: [],
  };
}

function exacta(keyword: string, alias?: string | null, cliente = 'CLI-0001'): KeywordRule {
  return {
    keyword_id: 'KEY-0001',
    cliente_id: cliente,
    keyword,
    terminos: splitTerminos(keyword, alias ?? null),
    tipo: 'exacta',
    regla: 'exacta',
    contextoIncluir: [],
    contextoExcluir: [],
  };
}

describe('foldText — política de acentos', () => {
  it('normaliza mayúsculas, acentos, ü y ñ', () => {
    expect(foldText('Tequila Patrón')).toBe(foldText('Tequila Patron'));
    expect(foldText('Casa Patrón')).toBe(foldText('Casa Patron'));
    expect(foldText('Bacardí')).toBe(foldText('Bacardi'));
    expect(foldText('Néctares')).toBe(foldText('Nectares'));
    expect(foldText('Merilyn Gómez Pozos')).toBe(foldText('Merilyn Gomez Pozos'));
    expect(foldText('JUMEX')).toBe('jumex');
    expect(foldText('piñata')).toBe('pinata');
    expect(foldText('pingüino')).toBe('pinguino');
  });
});

describe('Patrón DIRECT_BRAND — frase_exacta', () => {
  const tequila = frase('Tequila Patrón', 'Tequila Patron');
  const spirits = frase('Patrón Spirits', 'Patron Spirits');
  const grupo = frase('Grupo Bacardí', 'Grupo Bacardi');
  const ieps = frase('IEPS bebidas alcohólicas', 'IEPS bebidas alcoholicas');
  const cazadores = frase('Tequila Cazadores');
  const hacienda = frase('Hacienda Patrón', 'Hacienda Patron');
  const casa = frase('Casa Patrón', 'Casa Patron');

  it('Tequila Patrón / Patron / TEQUILA PATRON MATCH', () => {
    expect(matchKeyword(tequila, campos('Tequila Patrón gana premio'))).not.toBeNull();
    expect(matchKeyword(tequila, campos('Tequila Patron gana premio'))).not.toBeNull();
    expect(matchKeyword(tequila, campos('TEQUILA PATRON gana premio'))).not.toBeNull();
  });

  it('solo Patrón / Patron NO MATCH DIRECT_POLICY', () => {
    expect(matchKeyword(tequila, campos('Patrón lanza nuevo producto'))).toBeNull();
    expect(matchKeyword(tequila, campos('Patron lanza nuevo producto'))).toBeNull();
  });

  it('patrón de conducta / santo patrón / Patrón Tequila NO MATCH', () => {
    expect(matchKeyword(tequila, campos('Analizan el patrón de conducta'))).toBeNull();
    expect(matchKeyword(tequila, campos('Festejan al santo patrón del pueblo'))).toBeNull();
    expect(matchKeyword(tequila, campos('Patrón Tequila expands'))).toBeNull();
    expect(matchKeyword(tequila, campos('Patron Tequila announces'))).toBeNull();
  });

  it('Patrón Spirits / Patron Spirits MATCH', () => {
    expect(matchKeyword(spirits, campos('Patrón Spirits anuncia distribución'))).not.toBeNull();
    expect(matchKeyword(spirits, campos('Patron Spirits anuncia distribución'))).not.toBeNull();
  });

  it('Grupo Bacardí / Grupo Bacardi MATCH', () => {
    expect(matchKeyword(grupo, campos('Grupo Bacardí reporta resultados'))).not.toBeNull();
    expect(matchKeyword(grupo, campos('Grupo Bacardi reporta resultados'))).not.toBeNull();
  });

  it('IEPS bebidas alcohólicas / alcoholicas MATCH', () => {
    expect(matchKeyword(ieps, campos('Sube el IEPS bebidas alcohólicas'))).not.toBeNull();
    expect(matchKeyword(ieps, campos('Sube el IEPS bebidas alcoholicas'))).not.toBeNull();
  });

  it('Tequila Cazadores / Hacienda Patrón / Casa Patron MATCH', () => {
    expect(matchKeyword(cazadores, campos('Tequila Cazadores lanza edición'))).not.toBeNull();
    expect(matchKeyword(hacienda, campos('Hacienda Patrón abre visitas'))).not.toBeNull();
    expect(matchKeyword(casa, campos('Casa Patron inaugura destilería'))).not.toBeNull();
  });
});

describe('Mery DIRECT phrases', () => {
  const merilyn = frase('Merilyn Gómez Pozos', 'Merilyn Gomez Pozos', 'CLI-MERY-TEST');
  const mery = frase('Mery Pozos', null, 'CLI-MERY-TEST');
  const meryGomez = frase('Mery Gómez Pozos', 'Mery Gomez Pozos', 'CLI-MERY-TEST');
  const dipPozos = frase('diputada Pozos', null, 'CLI-MERY-TEST');
  const dipMery = frase('diputada Mery', null, 'CLI-MERY-TEST');

  it('nombres completos MATCH con y sin acento', () => {
    expect(matchKeyword(merilyn, campos('Merilyn Gómez Pozos habla'))).not.toBeNull();
    expect(matchKeyword(merilyn, campos('Merilyn Gomez Pozos habla'))).not.toBeNull();
    expect(matchKeyword(mery, campos('Mery Pozos propone reforma'))).not.toBeNull();
    expect(matchKeyword(meryGomez, campos('Mery Gómez Pozos en Jalisco'))).not.toBeNull();
    expect(matchKeyword(meryGomez, campos('Mery Gomez Pozos en Jalisco'))).not.toBeNull();
  });

  it('diputada Pozos / diputada Mery MATCH', () => {
    expect(matchKeyword(dipPozos, campos('La diputada Pozos presentó iniciativa'))).not.toBeNull();
    expect(matchKeyword(dipMery, campos('La diputada Mery criticó al SIAPA'))).not.toBeNull();
  });

  it('Mery / Pozos solas NO son match de las frases directas', () => {
    expect(matchKeyword(mery, campos('Mery ganó el concurso'))).toBeNull();
    expect(matchKeyword(dipPozos, campos('Pozos petroleros en Tabasco'))).toBeNull();
    expect(matchKeyword(merilyn, campos('Mery ganó el concurso'))).toBeNull();
  });
});

describe('Jumex literal all-context', () => {
  const jumex = exacta('Jumex', 'Grupo Jumex|Jugos Jumex');

  it('match en cualquier contexto de palabra Jumex', () => {
    expect(matchKeyword(jumex, campos('Jumex anunció una promoción'))).not.toBeNull();
    expect(matchKeyword(jumex, campos('productos Jumex en supermercado'))).not.toBeNull();
    expect(matchKeyword(jumex, campos('Grupo Jumex anunció inversión'))).not.toBeNull();
    expect(matchKeyword(jumex, campos('Jugos Jumex'))).not.toBeNull();
    expect(matchKeyword(jumex, campos('Museo Jumex inaugura muestra'))).not.toBeNull();
    expect(matchKeyword(jumex, campos('JUMEX'))).not.toBeNull();
  });

  it('Jugos y Néctares / impuesto bebidas azucaradas MATCH', () => {
    const jugos = frase('Jugos y Néctares', 'Jugos y Nectares', 'CLI-0001');
    const impuesto = frase(
      'impuesto bebidas azucaradas',
      'impuesto a bebidas azucaradas|impuesto a las bebidas azucaradas',
      'CLI-0001',
    );
    expect(matchKeyword(jugos, campos('Jugos y Néctares suben de precio'))).not.toBeNull();
    expect(matchKeyword(jugos, campos('Jugos y Nectares suben de precio'))).not.toBeNull();
    expect(matchKeyword(impuesto, campos('El impuesto bebidas azucaradas se mantiene'))).not.toBeNull();
    expect(matchKeyword(impuesto, campos('El impuesto a bebidas azucaradas se mantiene'))).not.toBeNull();
    expect(matchKeyword(impuesto, campos('El impuesto a las bebidas azucaradas se mantiene'))).not.toBeNull();
  });

  it('Jumex literal no es keyword amplia; bebidas azucaradas sí', () => {
    expect(esKeywordJumexAmpliaCli0001('Jumex')).toBe(false);
    expect(esKeywordJumexAmpliaCli0001('bebidas azucaradas')).toBe(true);
    expect(
      pasaPuertaContextualClienteKeyword({
        cliente_id: 'CLI-0001',
        keyword: 'Jumex',
        texto: 'Jumex 3x2 en Soriana',
        titulo: 'Jumex 3x2 en Soriana',
        cuerpo: '',
      }).pasa,
    ).toBe(true);
  });
});

describe('planner KEYWORD_POLICY_V1', () => {
  const liveBase: Keyword[] = [
    {
      keyword_id: 'KEY-0040', cliente_id: 'CLI-MERY-TEST', cliente: 'Mery Pozos / Merilyn Gómez Pozos',
      keyword: 'Merilyn Gómez Pozos', alias_o_variantes: 'Merilyn Gomez Pozos',
      tipo_keyword: 'frase_exacta', regla: null, activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: null, contexto_excluir: null, notas: 'Nombre completo exacto. Cero ambigüedad. P1/P2 shadow.',
    },
    {
      keyword_id: 'KEY-0041', cliente_id: 'CLI-MERY-TEST', cliente: 'Mery Pozos / Merilyn Gómez Pozos',
      keyword: 'Mery Pozos', alias_o_variantes: null,
      tipo_keyword: 'frase_exacta', regla: null, activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: null, contexto_excluir: null, notas: 'Apodo.',
    },
    {
      keyword_id: 'KEY-0042', cliente_id: 'CLI-MERY-TEST', cliente: 'Mery Pozos / Merilyn Gómez Pozos',
      keyword: 'Mery Gómez Pozos', alias_o_variantes: 'Mery Gomez Pozos',
      tipo_keyword: 'frase_exacta', regla: null, activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: null, contexto_excluir: null, notas: 'Variante.',
    },
    {
      keyword_id: 'KEY-0001', cliente_id: 'CLI-0001', cliente: 'Jumex',
      keyword: 'Jumex', alias_o_variantes: 'Jugos Jumex|Grupo Jumex',
      tipo_keyword: 'exacta', regla: 'exacta', activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: 'bebidas|jugos|empresa', contexto_excluir: null, notas: 'Marca principal.',
    },
    {
      keyword_id: 'KEY-0060', cliente_id: 'CLI-0002', cliente: 'Bebidas alcoholicas',
      keyword: 'Tequila Patrón', alias_o_variantes: 'Tequila Patron|Patrón Tequila|Patron Tequila',
      tipo_keyword: 'frase_exacta', regla: null, activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: null, contexto_excluir: null, notas: 'Marca insignia.',
    },
    {
      keyword_id: 'KEY-0061', cliente_id: 'CLI-0002', cliente: 'Bebidas alcoholicas',
      keyword: 'Casa Patrón', alias_o_variantes: 'Casa Patron',
      tipo_keyword: 'frase_exacta', regla: null, activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: null, contexto_excluir: null, notas: 'Destilería.',
    },
    {
      keyword_id: 'KEY-0064', cliente_id: 'CLI-0002', cliente: 'Bebidas alcoholicas',
      keyword: 'IEPS alcohol', alias_o_variantes: 'IEPS bebidas alcohólicas|IEPS bebidas alcoholicas',
      tipo_keyword: 'frase_exacta', regla: null, activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: null, contexto_excluir: null, notas: 'Impuesto.',
    },
    {
      keyword_id: 'KEY-0069', cliente_id: 'CLI-0002', cliente: 'Bebidas alcoholicas',
      keyword: 'Patrón', alias_o_variantes: 'Patron',
      tipo_keyword: 'exacta_contextual', regla: null, activa: true, prioridad: 'Alta', alerta: true,
      contexto_incluir: 'tequila', contexto_excluir: 'jefe', notas: 'Patrón sola.',
    },
  ];

  it('desactiva KEY-0069, quita alias invertido, Jumex alerta=false, crea IDs reservados', () => {
    const plan = planPriorityClientKeywordsV1(liveBase);
    expect(plan.conflicts).toEqual([]);
    const byId = Object.fromEntries(plan.ops.map((o) => [o.keyword_id, o]));
    expect(byId['KEY-0069']?.action).toBe('DEACTIVATE');
    expect(byId['KEY-0069']?.desired.activa).toBe(false);
    expect(byId['KEY-0060']?.action).toBe('UPDATE');
    expect(hasReversedTequilaPatronAlias(byId['KEY-0060']!.desired.alias_o_variantes, byId['KEY-0060']!.desired.keyword)).toBe(false);
    expect(byId['KEY-0001']?.desired.tipo_keyword).toBe('exacta');
    expect(byId['KEY-0001']?.desired.alerta).toBe(false);
    expect(byId['KEY-0001']?.desired.contexto_incluir).toBeNull();
    for (const id of POLICY_RESERVED_NEW_IDS) {
      expect(byId[id]?.action).toBe('CREATE');
    }
    expect(byId['KEY-0076']?.keyword).toBe('diputada Pozos');
    expect(byId['KEY-0077']?.keyword).toBe('diputada Mery');
  });

  it('es idempotente si LIVE ya está alineada', () => {
    const first = planPriorityClientKeywordsV1(liveBase);
    const aligned = first.ops.map((o) => o.desired);
    const second = planPriorityClientKeywordsV1(aligned);
    expect(second.ops.every((o) => o.action === 'UNCHANGED')).toBe(true);
    expect(second.conflicts).toEqual([]);
  });

  it('IDs reservados no colisionan con KEY-0001..0069', () => {
    for (const id of POLICY_RESERVED_NEW_IDS) {
      const n = Number.parseInt(id.slice(4), 10);
      expect(n).toBeGreaterThan(69);
    }
    expect(POLICY_DEACTIVATE_IDS).toEqual(['KEY-0069']);
    expect([...POLICY_CLIENT_IDS]).toEqual(['CLI-MERY-TEST', 'CLI-0001', 'CLI-0002']);
  });

  it('default CLI es dry-run', () => {
    expect(parsePolicyArgs([]).mode).toBe('dry-run');
    expect(parsePolicyArgs(['--dry-run']).mode).toBe('dry-run');
    expect(parsePolicyArgs(['--apply']).mode).toBe('apply');
  });

  it('sheet cells serializan booleanos TRUE/FALSE', () => {
    const cells = keywordToSheetCells(POLICY_ENSURE_ROWS[0]!);
    expect(cells.activa).toBe('TRUE');
    expect(cells.keyword_id).toBeTruthy();
  });

  it('sugerencias no aplicadas están acotadas', () => {
    for (const id of POLICY_CLIENT_IDS) {
      expect(SUGGESTED_KEYWORDS_NOT_APPLIED[id].length).toBeGreaterThan(0);
      expect(SUGGESTED_KEYWORDS_NOT_APPLIED[id].length).toBeLessThanOrEqual(10);
    }
  });
});

describe('esta fase no llama alertas ni canales de envío', () => {
  it('scripts/policy y upsert dirigido no importan Twilio/WhatsApp/email/SMTP ni hojas finales', () => {
    const files = [
      'scripts/apply-priority-client-keywords-v1.ts',
      'src/config/priorityClientKeywordsV1.ts',
      'src/sheets/keywordDirectedUpsert.ts',
    ].map((f) => readFileSync(resolve(process.cwd(), f), 'utf8')).join('\n');
    expect(files).not.toMatch(/from ['"][^'"]*twilio/i);
    expect(files).not.toMatch(/\bTWILIO_/);
    expect(files).not.toMatch(/from ['"][^'"]*whatsapp/i);
    expect(files).not.toMatch(/from ['"][^'"]*nodemailer/i);
    expect(files).not.toMatch(/\bSMTP_/);
    expect(files).not.toMatch(/send-internal-alerts/);
    expect(files).not.toMatch(/01_Noticias_Raw/);
    expect(files).not.toMatch(/insertMenciones/);
    expect(files).not.toMatch(/markNoticiasProcesadas/);
    expect(files).not.toMatch(/npm run sync-sheets/);
  });
});
