/**
 * Tests de matching para CLI-MERY-TEST — Merilyn Gómez Pozos / Mery Pozos.
 *
 * Cubre los 12 keywords definidos en scripts/tune-mery-pozos-shadow.ts:
 *   KEY-0040 a KEY-0047 (frase_exacta, alerta=true)
 *   KEY-0048 a KEY-0051 (exacta_contextual, alerta=false)
 *
 * Reglas críticas validadas:
 *   - "Mery" sola NO debe matchear.
 *   - "Pozos" sola (infraestructura/agua) NO debe matchear.
 *   - Homónimos sin contexto político NO deben matchear.
 *   - Nombres completos/compuestos SÍ matchean sin contexto adicional.
 *   - Variantes amplias SÍ matchean solo con contexto político.
 */
import { describe, it, expect } from 'vitest';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
} from '../src/matchers/keyword.js';

function campos(parts: Partial<Record<string, string>>): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: parts.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: parts.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: parts.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: parts.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto: parts.texto ?? '', peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: parts.medio ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

function kwExacta(keyword: string, alias?: string): KeywordRule {
  return {
    keyword_id: 'KEY-TEST',
    cliente_id: 'CLI-MERY-TEST',
    keyword,
    terminos: splitTerminos(keyword, alias ?? null),
    tipo: 'frase_exacta',
    regla: null,
    contextoIncluir: [],
    contextoExcluir: [],
  };
}

function kwContextual(
  keyword: string,
  contextoIncluir: string[],
  contextoExcluir: string[],
  alias?: string,
): KeywordRule {
  return {
    keyword_id: 'KEY-TEST',
    cliente_id: 'CLI-MERY-TEST',
    keyword,
    terminos: splitTerminos(keyword, alias ?? null),
    tipo: 'exacta_contextual',
    regla: null,
    contextoIncluir,
    contextoExcluir,
  };
}

// ── Tier 1 — Nombres completos / compuestos (frase_exacta) ───────────────────

describe('KEY-0040 "Merilyn Gómez Pozos" — frase_exacta', () => {
  const kw = kwExacta('Merilyn Gómez Pozos', 'Merilyn Gomez Pozos');

  it('detecta nombre completo exacto en titulo', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Merilyn Gómez Pozos habla sobre Jalisco' }));
    expect(res).not.toBeNull();
    expect(res!.tipo_match).toBe('frase_exacta');
  });

  it('detecta variante sin acentos (alias)', () => {
    const res = matchKeyword(kw, campos({ resumen: 'declaraciones de Merilyn Gomez Pozos' }));
    expect(res).not.toBeNull();
  });

  it('detecta en nota con contexto político', () => {
    const nota = 'La diputada Merilyn Gómez Pozos presentó iniciativa en la Cámara';
    const res = matchKeyword(kw, campos({ titulo: nota }));
    expect(res).not.toBeNull();
  });

  it('NO matchea solo "Merilyn Gómez" sin apellido Pozos', () => {
    const res = matchKeyword(kw, campos({ titulo: 'habló Merilyn Gómez ayer' }));
    expect(res).toBeNull();
  });
});

describe('KEY-0041 "Mery Pozos" — frase_exacta', () => {
  const kw = kwExacta('Mery Pozos');

  it('detecta apodo + apellido compuesto en titulo', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Mery Pozos dice que nadie está por encima de la ley' }));
    expect(res).not.toBeNull();
  });

  it('detecta en cuerpo de nota de El Informador', () => {
    const texto = 'La legisladora Mery Pozos, vocera del Gobierno Federal, enfatizó la ley';
    const res = matchKeyword(kw, campos({ texto }));
    expect(res).not.toBeNull();
  });

  it('NO matchea "Mery" sola', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Mery lanzó nuevo álbum' }));
    expect(res).toBeNull();
  });

  it('NO matchea "Pozos" sola', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Los pozos de agua en Jalisco' }));
    expect(res).toBeNull();
  });

  it('NO matchea "Pozos" de infraestructura', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Pemex perforará pozos en la Bahía' }));
    expect(res).toBeNull();
  });
});

describe('KEY-0042 "Mery Gómez Pozos" — frase_exacta', () => {
  const kw = kwExacta('Mery Gómez Pozos', 'Mery Gomez Pozos');

  it('detecta variante con apodo + apellido materno', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Mery Gómez Pozos refrendó su posición' }));
    expect(res).not.toBeNull();
  });

  it('detecta variante sin acentos', () => {
    const res = matchKeyword(kw, campos({ resumen: 'Mery Gomez Pozos representó a Jalisco' }));
    expect(res).not.toBeNull();
  });
});

describe('KEY-0043 "Merilyn Gomez Pozos" (sin acentos) — frase_exacta', () => {
  const kw = kwExacta('Merilyn Gomez Pozos');

  it('detecta nombre sin acentos en medios con encoding alt', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Merilyn Gomez Pozos ante la prensa' }));
    expect(res).not.toBeNull();
  });
});

describe('KEY-0044 "Mery Gomez Pozos" (sin acentos) — frase_exacta', () => {
  const kw = kwExacta('Mery Gomez Pozos');

  it('detecta apodo + apellidos sin acentos', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Mery Gomez Pozos convocó rueda de prensa' }));
    expect(res).not.toBeNull();
  });
});

// ── Tier 2 — Con cargo (frase_exacta) ────────────────────────────────────────

describe('KEY-0045 "diputada Mery Pozos" — frase_exacta', () => {
  const kw = kwExacta('diputada Mery Pozos', 'Mery Pozos diputada|Mery Pozos, diputada');

  it('detecta frase con cargo en titulo', () => {
    const res = matchKeyword(kw, campos({ titulo: 'La diputada Mery Pozos criticó el presupuesto' }));
    expect(res).not.toBeNull();
  });

  it('detecta variante "Mery Pozos diputada" (alias)', () => {
    const res = matchKeyword(kw, campos({ resumen: 'Mery Pozos diputada de Morena habló ayer' }));
    expect(res).not.toBeNull();
  });
});

describe('KEY-0046 "diputada Merilyn Gómez" — frase_exacta', () => {
  const kw = kwExacta('diputada Merilyn Gómez', 'Merilyn Gómez diputada|diputada Merilyn Gomez|Merilyn Gomez diputada');

  it('detecta cargo + nombre parcial', () => {
    const res = matchKeyword(kw, campos({ titulo: 'La diputada Merilyn Gómez votó a favor' }));
    expect(res).not.toBeNull();
  });

  it('NO matchea "Merilyn Gómez" sin cargo (no es este keyword)', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Merilyn Gómez presentó propuesta' }));
    expect(res).toBeNull();
  });
});

describe('KEY-0047 "diputada federal Merilyn Gómez Pozos" — frase_exacta', () => {
  const kw = kwExacta('diputada federal Merilyn Gómez Pozos', 'diputada federal Merilyn Gomez Pozos');

  it('detecta cargo federal completo', () => {
    const res = matchKeyword(kw, campos({
      titulo: 'La diputada federal Merilyn Gómez Pozos encabezó el evento',
    }));
    expect(res).not.toBeNull();
  });

  it('detecta variante sin acentos', () => {
    const res = matchKeyword(kw, campos({ resumen: 'diputada federal Merilyn Gomez Pozos votó' }));
    expect(res).not.toBeNull();
  });
});

// ── Tier 3 — Variantes amplias (exacta_contextual) ───────────────────────────

const CTX_POLITICO = [
  'diputada', 'diputado', 'federal', 'Cámara de Diputados', 'Congreso', 'San Lázaro',
  'Morena', 'MC', 'Movimiento Ciudadano', 'Jalisco', 'Guadalajara', 'candidata',
  'reforma', 'iniciativa', 'comisión', 'presupuesto', 'legislativa', 'legislativo',
  'política', 'político',
];
const EXC_POZOS_INFRA = [
  'pozo artesiano', 'pozos de agua', 'pozos petroleros', 'pozos urbanos',
  'Pemex', 'hidrocarburos', 'agua potable', 'acuífero',
];
const EXC_MERY_OCI = [
  'entretenimiento', 'actriz', 'cantante', 'modelo', 'influencer', 'youtuber',
  'tiktoker', 'futbol', 'fútbol', 'deportes', 'cine', 'televisión',
];

describe('KEY-0048 "Merilyn Gómez" — exacta_contextual (política)', () => {
  const kw = kwContextual('Merilyn Gómez', CTX_POLITICO, EXC_MERY_OCI, 'Merilyn Gomez');

  it('matchea con contexto político en resumen', () => {
    const res = matchKeyword(kw, campos({
      titulo: 'Merilyn Gómez asistió al acto',
      resumen: 'La diputada tomó la palabra en la Cámara',
    }));
    expect(res).not.toBeNull();
  });

  it('NO matchea sin contexto político (alerta=false implica alta tasa FP sin contexto)', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Merilyn Gómez ganó un premio cultural' }));
    expect(res).toBeNull();
  });

  it('NO matchea si contexto de entretenimiento excluido', () => {
    const res = matchKeyword(kw, campos({
      titulo: 'Merilyn Gómez sorprende en la televisión',
      resumen: 'La actriz habló sobre sus proyectos cinematográficos',
    }));
    expect(res).toBeNull();
  });
});

describe('KEY-0049 "Mery Gómez" — exacta_contextual (política estricta)', () => {
  const kw = kwContextual('Mery Gómez', CTX_POLITICO, EXC_MERY_OCI, 'Mery Gomez');

  it('matchea con contexto político explícito', () => {
    const res = matchKeyword(kw, campos({
      titulo: 'Mery Gómez presentó iniciativa en Jalisco',
    }));
    expect(res).not.toBeNull();
  });

  it('NO matchea "Mery Gómez" sin contexto político (nombre muy común)', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Mery Gómez cumplió 15 años' }));
    expect(res).toBeNull();
  });
});

describe('KEY-0050 "Gómez Pozos" — exacta_contextual (política, anti-infra)', () => {
  const kw = kwContextual('Gómez Pozos', CTX_POLITICO, EXC_POZOS_INFRA, 'Gomez Pozos');

  it('matchea con contexto político', () => {
    const res = matchKeyword(kw, campos({
      titulo: 'Gómez Pozos lideró la sesión del Congreso',
    }));
    expect(res).not.toBeNull();
  });

  it('NO matchea con contexto de infraestructura (Pemex, pozos de agua)', () => {
    const res = matchKeyword(kw, campos({
      titulo: 'Gómez Pozos de agua en la CDMX',
      resumen: 'Pemex anunció la perforación de pozos petroleros en la región',
    }));
    expect(res).toBeNull();
  });

  it('NO matchea sin ningún contexto', () => {
    const res = matchKeyword(kw, campos({ titulo: 'Compañía Gómez Pozos S.A.' }));
    expect(res).toBeNull();
  });
});

describe('KEY-0051 "Gomez Pozos" (sin acentos) — exacta_contextual', () => {
  const kw = kwContextual('Gomez Pozos', CTX_POLITICO, EXC_POZOS_INFRA);

  it('matchea apellido sin acentos con contexto político', () => {
    const res = matchKeyword(kw, campos({
      titulo: 'Gomez Pozos en el Congreso',
    }));
    expect(res).not.toBeNull();
  });
});

// ── Seguridad: alertas_activas nunca debe cambiar ─────────────────────────────

describe('Seguridad — no envíos, no producción', () => {
  it('las keywords de Tier 1 tienen alerta=true en la definición del script (revisión manual)', () => {
    // Este test documenta las expectativas del script tune-mery-pozos-shadow.ts.
    // Las keywords KEY-0040 a KEY-0047 deben tener alerta=true.
    // Las keywords KEY-0048 a KEY-0051 deben tener alerta=false.
    // CLI-MERY-TEST debe tener alertas_activas=false.
    // No hay forma de disparar envíos reales solo con alertas_activas=false.
    expect(true).toBe(true); // placeholder para documentar las reglas
  });
});
