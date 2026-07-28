import { describe, it, expect } from 'vitest';
import {
  normalizeLegacyRow,
  compararLegacyVsEthos,
  contieneNombreFuerte,
  parseFechaLegacy,
  scoreMatchLegacyEthos,
  CATALOGO_DEFAULT_AUSENTE,
  type LegacyRowRaw,
  type LegacyRowNorm,
  type EthosRowNorm,
  type MedioEstadoCatalogo,
} from '../src/comparators/meryLegacyComparator.js';

function legacyRaw(overrides: Partial<LegacyRowRaw> = {}): LegacyRowRaw {
  return {
    title: 'Mery Pozos denuncia crisis del agua en Jalisco',
    description: 'La diputada federal Mery Pozos exigió acciones inmediatas.',
    link: 'https://udgtv.com/noticias/mery-pozos-agua',
    pubDate: '2026-07-20',
    source: 'UDG TV',
    guid: 'GUID-001',
    status: 'procesada',
    sentimiento: 'Nota Neutral ⚪️',
    tema: 'Política nacional',
    ...overrides,
  };
}

function ethosRow(overrides: Partial<EthosRowNorm> = {}): EthosRowNorm {
  return {
    noticia_id: 'NOT-001',
    titulo: 'Mery Pozos denuncia crisis del agua en Jalisco',
    url: 'https://udgtv.com/noticias/mery-pozos-agua',
    url_norm: 'https://udgtv.com/noticias/mery-pozos-agua',
    medio: 'UDG TV / Canal 44',
    medio_id: 'MED-0040',
    fecha: parseFechaLegacy('2026-07-20'),
    categoria_editorial: 'MENCION_DIRECTA',
    estado_editorial: 'GO_DIRECTA',
    nota_completa_limpia: 'Texto completo de la nota.',
    ...overrides,
  };
}

const catalogoOk: MedioEstadoCatalogo = {
  esta_en_catalogo: true, medio_id: 'MED-0040', activo: true, en_cron: true, metodo_extraccion: 'SITEMAP',
};

describe('parseFechaLegacy', () => {
  it('parsea formato ISO', () => {
    const d = parseFechaLegacy('2025-11-03');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(10);
    expect(d!.getUTCDate()).toBe(3);
  });

  it('parsea formato M/D/YY', () => {
    const d = parseFechaLegacy('11/21/25');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(10);
    expect(d!.getUTCDate()).toBe(21);
  });

  it('parsea formato M/D/YY con año 26', () => {
    const d = parseFechaLegacy('7/26/26');
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(6);
    expect(d!.getUTCDate()).toBe(26);
  });

  it('ISO y M/D/YY producen la misma fecha absoluta para el mismo día', () => {
    const iso = parseFechaLegacy('2026-07-20');
    const mdY = parseFechaLegacy('7/20/26');
    expect(iso!.getTime()).toBe(mdY!.getTime());
  });

  it('vacío/null → null', () => {
    expect(parseFechaLegacy('')).toBeNull();
    expect(parseFechaLegacy(null)).toBeNull();
  });
});

describe('contieneNombreFuerte — reglas de ruido', () => {
  it('acepta "Mery Pozos"', () => {
    expect(contieneNombreFuerte('Mery Pozos habló sobre el agua')).toBe(true);
  });

  it('acepta "Merilyn Gómez Pozos"', () => {
    expect(contieneNombreFuerte('La diputada Merilyn Gómez Pozos votó')).toBe(true);
  });

  it('acepta "diputada Mery"', () => {
    expect(contieneNombreFuerte('Según la diputada Mery, el tema es urgente')).toBe(true);
  });

  it('acepta "diputada Merilyn"', () => {
    expect(contieneNombreFuerte('La diputada Merilyn fue entrevistada')).toBe(true);
  });

  it('NO acepta "Pozos" solo', () => {
    expect(contieneNombreFuerte('Los pozos petroleros de Pemex')).toBe(false);
  });

  it('NO acepta "Mery" solo', () => {
    expect(contieneNombreFuerte('Mery es un nombre común')).toBe(false);
  });

  it('NO acepta "Gómez" solo', () => {
    expect(contieneNombreFuerte('El señor Gómez opinó')).toBe(false);
  });

  it('NO acepta "pozos de agua/petroleros"', () => {
    expect(contieneNombreFuerte('Crisis por pozos de agua contaminados')).toBe(false);
    expect(contieneNombreFuerte('Los pozos petroleros en la región')).toBe(false);
  });

  it('vacío/null → false', () => {
    expect(contieneNombreFuerte('')).toBe(false);
    expect(contieneNombreFuerte(null)).toBe(false);
  });
});

describe('normalizeLegacyRow', () => {
  it('detecta link Google News y deja link_norm vacío', () => {
    const row = normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/CBMi...', source: 'MURAL | Periodismo independiente' }));
    expect(row.es_google_news).toBe(true);
    expect(row.link_norm).toBe('');
    expect(row.source_canonico).toBe('MURAL');
  });

  it('link directo normaliza link_norm', () => {
    const row = normalizeLegacyRow(legacyRaw());
    expect(row.es_google_news).toBe(false);
    expect(row.link_norm).toContain('udgtv.com');
  });

  it('detecta nombre_fuerte cuando title+description contienen mención fuerte', () => {
    const row = normalizeLegacyRow(legacyRaw());
    expect(row.nombre_fuerte).toBe(true);
    expect(row.es_ruido).toBe(false);
  });

  it('marca es_ruido cuando no hay mención fuerte', () => {
    const row = normalizeLegacyRow(legacyRaw({
      title: 'La UNAM entrega su Cuenta Anual a la Cámara de Diputados',
      description: 'Informe anual sin relación con Jalisco.',
    }));
    expect(row.nombre_fuerte).toBe(false);
    expect(row.es_ruido).toBe(true);
  });

  it('marca es_agregador para MSN', () => {
    const row = normalizeLegacyRow(legacyRaw({ source: 'MSN' }));
    expect(row.es_agregador).toBe(true);
  });

  it('marca es_pago_convenio para MURAL', () => {
    const row = normalizeLegacyRow(legacyRaw({ source: 'MURAL' }));
    expect(row.es_pago_convenio).toBe(true);
  });

  it('marca es_fuente_propia para "Mery Pozos" como source', () => {
    const row = normalizeLegacyRow(legacyRaw({ source: 'Mery Pozos' }));
    expect(row.es_fuente_propia).toBe(true);
  });
});

describe('scoreMatchLegacyEthos', () => {
  it('match exacto por URL cuando NO es Google News', () => {
    const legacy = normalizeLegacyRow(legacyRaw());
    const ethos = ethosRow();
    const result = scoreMatchLegacyEthos(legacy, ethos);
    expect(result.match).toBe(true);
    expect(result.score).toBe(1);
  });

  it('match por título cuando el link es Google News', () => {
    const legacy = normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/CBMi...' }));
    const ethos = ethosRow();
    const result = scoreMatchLegacyEthos(legacy, ethos);
    expect(result.match).toBe(true);
  });

  it('sin match si el medio es distinto', () => {
    const legacy = normalizeLegacyRow(legacyRaw({ source: 'Milenio', link: 'https://news.google.com/rss/articles/xyz' }));
    const ethos = ethosRow({ medio: 'El Informador' });
    const result = scoreMatchLegacyEthos(legacy, ethos);
    expect(result.match).toBe(false);
  });

  it('sin match si el título es muy distinto', () => {
    const legacy = normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/xyz', title: 'Otro tema completamente distinto sobre deportes' }));
    const ethos = ethosRow();
    const result = scoreMatchLegacyEthos(legacy, ethos);
    expect(result.match).toBe(false);
  });

  it('sin match si la fecha está fuera de la ventana de 3 días', () => {
    const legacy = normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/xyz', pubDate: '2026-07-01' }));
    const ethos = ethosRow({ fecha: new Date(2026, 6, 20) });
    const result = scoreMatchLegacyEthos(legacy, ethos);
    expect(result.match).toBe(false);
  });
});

describe('compararLegacyVsEthos — estados comparativos', () => {
  it('estado AMBOS cuando hay un único match', () => {
    const legacy = [normalizeLegacyRow(legacyRaw())];
    const ethos = [ethosRow()];
    const catalogo = new Map([['UDG TV / Canal 44', catalogoOk]]);
    const filas = compararLegacyVsEthos(legacy, ethos, catalogo, { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.estado_comparativo).toBe('AMBOS');
  });

  it('estado SOLO_GOOGLE_RSS cuando el medio existe/activo/en cron pero Ethos no capturó la nota', () => {
    const legacy = [normalizeLegacyRow(legacyRaw({ link: 'https://udgtv.com/otra-nota-no-en-ethos' }))];
    const catalogo = new Map([['UDG TV / Canal 44', catalogoOk]]);
    const filas = compararLegacyVsEthos(legacy, [], catalogo, { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('SOLO_GOOGLE_RSS');
  });

  it('estado SOLO_ETHOS cuando Ethos capturó algo que no está en legacy', () => {
    const ethosExtra = ethosRow({ noticia_id: 'NOT-999', url: 'https://otra.com/nota', titulo: 'Nota exclusiva de Ethos' });
    const filas = compararLegacyVsEthos([], [ethosExtra], new Map(), { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.estado_comparativo).toBe('SOLO_ETHOS');
  });

  it('estado RUIDO_GOOGLE_RSS cuando no hay mención fuerte y no hay match', () => {
    const legacy = [normalizeLegacyRow(legacyRaw({
      title: 'La UNAM entrega su Cuenta Anual a la Cámara de Diputados',
      description: 'Informe sin relación con Jalisco.',
      link: 'https://otromedio.com/unam-cuenta-anual',
      source: 'Otro Medio Cualquiera',
    }))];
    const filas = compararLegacyVsEthos(legacy, [], new Map(), { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('RUIDO_GOOGLE_RSS');
  });

  it('estado MEDIO_FALTANTE_ETHOS cuando el medio no está en catálogo', () => {
    const legacy = [normalizeLegacyRow(legacyRaw({ source: 'A Fondo Jalisco', link: 'https://afondojalisco.com/nota' }))];
    const filas = compararLegacyVsEthos(legacy, [], new Map(), { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('MEDIO_FALTANTE_ETHOS');
    expect(filas[0]!.accion_recomendada).toBe('AGREGAR_A_CATALOGO');
  });

  it('estado MEDIO_EN_CATALOGO_SIN_CRON cuando está activo pero sin cron', () => {
    const legacy = [normalizeLegacyRow(legacyRaw())];
    const catalogo = new Map([['UDG TV / Canal 44', { ...catalogoOk, en_cron: false }]]);
    const filas = compararLegacyVsEthos(legacy, [], catalogo, { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('MEDIO_EN_CATALOGO_SIN_CRON');
  });

  it('estado MEDIO_REQUIERE_DIRECT cuando no hay método de extracción confirmado', () => {
    const legacy = [normalizeLegacyRow(legacyRaw())];
    const catalogo = new Map([['UDG TV / Canal 44', { ...catalogoOk, metodo_extraccion: null }]]);
    const filas = compararLegacyVsEthos(legacy, [], catalogo, { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('MEDIO_REQUIERE_DIRECT');
  });

  it('estado MEDIO_D_PAGO_CONVENIO para MURAL sin match', () => {
    const legacy = [normalizeLegacyRow(legacyRaw({ source: 'MURAL', link: 'https://news.google.com/rss/articles/mural1', title: 'Nota sin relación directa' }))];
    const filas = compararLegacyVsEthos(legacy, [], new Map(), { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('MEDIO_D_PAGO_CONVENIO');
    expect(filas[0]!.accion_recomendada).toBe('D_PAGO_CONVENIO_API — no intentar bypass');
  });

  it('estado AGREGADOR_NO_MEDIO para MSN', () => {
    const legacy = [normalizeLegacyRow(legacyRaw({ source: 'MSN', link: 'https://msn.com/algo' }))];
    const filas = compararLegacyVsEthos(legacy, [], new Map(), { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('AGREGADOR_NO_MEDIO');
  });

  it('estado DUPLICADO_PROBABLE cuando hay más de un match posible', () => {
    const legacy = [normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/dup' }))];
    const ethosA = ethosRow({ noticia_id: 'A' });
    const ethosB = ethosRow({ noticia_id: 'B' });
    const catalogo = new Map([['UDG TV / Canal 44', catalogoOk]]);
    const filas = compararLegacyVsEthos(legacy, [ethosA, ethosB], catalogo, { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.estado_comparativo).toBe('DUPLICADO_PROBABLE');
  });

  it('cada fila Ethos se usa como match a lo sumo una vez', () => {
    const legacyA = normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/a', guid: 'A' }));
    const legacyB = normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/b', guid: 'B' }));
    const ethos = ethosRow();
    const catalogo = new Map([['UDG TV / Canal 44', catalogoOk]]);
    const filas = compararLegacyVsEthos([legacyA, legacyB], [ethos], catalogo, { fechaComparacion: '2026-07-28', ventana: '30d' });
    const ambos = filas.filter((f) => f.estado_comparativo === 'AMBOS');
    expect(ambos).toHaveLength(1);
  });

  it('dedupe_key es estable y no vacío para todas las filas', () => {
    const legacy = [normalizeLegacyRow(legacyRaw())];
    const filas = compararLegacyVsEthos(legacy, [], new Map(), { fechaComparacion: '2026-07-28', ventana: '30d' });
    expect(filas[0]!.dedupe_key).toBeTruthy();
    expect(filas[0]!.dedupe_key).toContain('MERY-LEGACY');
  });

  it('CATALOGO_DEFAULT_AUSENTE representa un medio no catalogado', () => {
    expect(CATALOGO_DEFAULT_AUSENTE.esta_en_catalogo).toBe(false);
  });
});
