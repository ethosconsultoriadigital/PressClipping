/**
 * Tests de la lógica pura de consolidación editorial (sin PressClipping).
 */
import { describe, it, expect } from 'vitest';
import {
  decodeHtmlEntities,
  clasificarConsolidado,
  consolidar,
  dedupeKeyConsolidado,
  type FilaCruda,
} from '../src/editorial/consolidation.js';

// ─── Decodificación de HTML entities ─────────────────────────────────────────

describe('decodeHtmlEntities', () => {
  it('decodifica comillas tipográficas numéricas (&#8220; &#8221;)', () => {
    expect(decodeHtmlEntities('&#8220;Defendemos&#8221; el territorio')).toBe('“Defendemos” el territorio');
  });

  it('decodifica comillas simples (&#8216; &#8217;)', () => {
    expect(decodeHtmlEntities('lo &#8216;mejor&#8217;')).toBe('lo ‘mejor’');
  });

  it('decodifica &amp; sin doble-decodificar', () => {
    expect(decodeHtmlEntities('Gamesa &amp; Sabritas')).toBe('Gamesa & Sabritas');
  });

  it('decodifica entities nombradas comunes', () => {
    expect(decodeHtmlEntities('a &lt; b &gt; c &quot;d&quot;')).toBe('a < b > c "d"');
  });

  it('decodifica hex (&#x201C;)', () => {
    expect(decodeHtmlEntities('&#x201C;hola&#x201D;')).toBe('“hola”');
  });

  it('deja intacto un título sin entities', () => {
    expect(decodeHtmlEntities('Tequila adulterado en Guanajuato')).toBe('Tequila adulterado en Guanajuato');
  });

  it('cadena vacía → vacía', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

// ─── CLI-0002 (Patrón) — reglas editoriales ──────────────────────────────────

describe('clasificarConsolidado CLI-0002 (Patrón)', () => {
  it('crisis alcohol adulterado = ALTA_RELEVANCIA / negativo', () => {
    const c = clasificarConsolidado('CLI-0002', ['alcohol adulterado'], 'Detectan alcohol adulterado en cantina');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c.grupo_tema).toBe('CRISIS_ALCOHOL_ADULTERADO');
    expect(c.sentimiento).toBe('negativo');
    expect(c.valoracion).toBe('ALTA');
    expect(c.estado_editorial).toBe('GO_ALTA');
  });

  it('tequila adulterado en título (keyword amplia) = ALTA por crisis', () => {
    const c = clasificarConsolidado('CLI-0002', ['tequila'], 'Detectan tequila adulterado en Rincón de Tamayo');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c.grupo_tema).toBe('CRISIS_ALCOHOL_ADULTERADO');
  });

  it('marca directa Tequila Patrón = ALTA / REPUTACION_MARCA', () => {
    const c = clasificarConsolidado('CLI-0002', ['Tequila Patrón'], 'Tequila Patrón lanza nueva edición');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c.grupo_tema).toBe('REPUTACION_MARCA');
    expect(c.valoracion).toBe('ALTA');
  });

  it('Bacardí = ALTA / marca directa', () => {
    const c = clasificarConsolidado('CLI-0002', ['Bacardí'], 'Bacardí anuncia inversión');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c.grupo_tema).toBe('REPUTACION_MARCA');
  });

  it('COFEPRIS con contexto bebida = ALTA / REGULATORIO_COFEPRIS', () => {
    const c = clasificarConsolidado('CLI-0002', ['COFEPRIS'], 'COFEPRIS alerta por bebidas alcohólicas adulteradas');
    // "adulteradas" dispara crisis primero (correcto), pero probamos sin esa palabra:
    const c2 = clasificarConsolidado('CLI-0002', ['COFEPRIS'], 'COFEPRIS revisa bebidas alcohólicas en el mercado');
    expect(c2.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c2.grupo_tema).toBe('REGULATORIO_COFEPRIS');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA'); // crisis
  });

  it('COFEPRIS sin contexto bebida = POSIBLE_FP / EXCLUIR', () => {
    const c = clasificarConsolidado('CLI-0002', ['COFEPRIS'], 'COFEPRIS aprueba nuevo medicamento oncológico');
    expect(c.relevancia_editorial).toBe('POSIBLE_FP');
    expect(c.estado_editorial).toBe('EXCLUIR');
    expect(c.fp_flags).toContain('cofepris_sin_contexto_bebida');
  });

  it('T-MEC sin contexto bebida = POSIBLE_FP / EXCLUIR', () => {
    const c = clasificarConsolidado('CLI-0002', ['T-MEC'], 'T-MEC: negociaciones sobre autopartes y acero');
    expect(c.relevancia_editorial).toBe('POSIBLE_FP');
    expect(c.estado_editorial).toBe('EXCLUIR');
    expect(c.fp_flags).toContain('tmec_sin_contexto_bebida');
  });

  it('T-MEC con contexto tequila/exportación = MEDIA / EXPORTACION_COMERCIO', () => {
    const c = clasificarConsolidado('CLI-0002', ['T-MEC', 'exportación de tequila'], 'T-MEC y la exportación de tequila a EU');
    expect(c.relevancia_editorial).toBe('MEDIA_RELEVANCIA');
    expect(c.grupo_tema).toBe('EXPORTACION_COMERCIO');
  });

  it('turismo tequila / paisaje agavero = BAJA_RELEVANCIA / EXCLUIR', () => {
    const c = clasificarConsolidado('CLI-0002', ['tequila'], 'Tequila: Paisaje Agavero, Patrimonio Mundial y destino turístico');
    expect(c.relevancia_editorial).toBe('BAJA_RELEVANCIA');
    expect(c.grupo_tema).toBe('TURISMO_LIFESTYLE_BAJO_VALOR');
    expect(c.fp_flags).toContain('turismo_lifestyle');
  });

  it('mezcal incidental en nota de seguridad = POSIBLE_FP / SEGURIDAD_INCIDENTAL', () => {
    const c = clasificarConsolidado('CLI-0002', ['mezcal'], 'Pobladores acusan ataques con drones en Guerrero');
    expect(c.relevancia_editorial).toBe('POSIBLE_FP');
    expect(c.grupo_tema).toBe('SEGURIDAD_INCIDENTAL');
    expect(c.fp_flags).toContain('seguridad_incidental');
  });

  it('exportación de tequila (sectorial) = MEDIA_RELEVANCIA', () => {
    const c = clasificarConsolidado('CLI-0002', ['exportación de tequila'], 'Crecen las exportaciones de tequila en 2026');
    expect(c.relevancia_editorial).toBe('MEDIA_RELEVANCIA');
    expect(['EXPORTACION_COMERCIO', 'INDUSTRIA_TEQUILA']).toContain(c.grupo_tema);
  });

  it('CRT-name-only sin tequila en título (stale FP tech) = POSIBLE_FP / EXCLUIR', () => {
    const c = clasificarConsolidado('CLI-0002', ['Consejo Regulador del Tequila'], 'CFE Internet por 35 pesos al mes: qué incluye el paquete');
    expect(c.relevancia_editorial).toBe('POSIBLE_FP');
    expect(c.estado_editorial).toBe('EXCLUIR');
    expect(c.fp_flags).toContain('crt_sin_contexto_titulo');
  });

  it('CRT-name con tequila en el título = MEDIA (sectorial legítimo)', () => {
    const c = clasificarConsolidado('CLI-0002', ['Consejo Regulador del Tequila'], 'El Consejo Regulador del Tequila reporta récord de producción de tequila');
    expect(c.relevancia_editorial).toBe('MEDIA_RELEVANCIA');
    expect(c.grupo_tema).toBe('INDUSTRIA_TEQUILA');
  });

  // ── Guard anti-FP: crisis solo por nombre de keyword, no confirmada en título ──
  // Casos reales de la auditoría editorial GPT (2026-07-13): 3 notas se colaron
  // como ALTA/crisis porque la keyword detectada (p.ej. "alcohol adulterado")
  // matcheó en el CUERPO, sin que el título hablara del tema.

  it('keyword "alcohol adulterado" sin esa palabra en el título = REVISAR, no GO_ALTA', () => {
    const c = clasificarConsolidado('CLI-0002', ['alcohol adulterado'], 'Arriban a Topolobampo equipos de alta tecnología para la Planta de Fertilizantes');
    expect(c.estado_editorial).toBe('REVISAR');
    expect(c.relevancia_editorial).toBe('MEDIA_RELEVANCIA');
    expect(c.fp_flags).toContain('crisis_solo_en_keyword_no_en_titulo');
  });

  it('keyword de crisis sin relación real con el título (Jardín Corona) = REVISAR', () => {
    const c = clasificarConsolidado('CLI-0002', ['bebidas adulteradas'], 'Jardín Corona más de 55 años de tradición única en Irapuato; conoce uno de los pocos espacios solo para hombres en la ciudad');
    expect(c.estado_editorial).toBe('REVISAR');
  });

  it('keyword de crisis sin relación real con el título (Gamesa/Sabritas/Turín) = REVISAR', () => {
    const c = clasificarConsolidado('CLI-0002', ['tequila adulterado'], 'Gamesa, Sabritas y Turín: las 10 empresas mexicanas que ahora pertenecen a gigantes extranjeros');
    expect(c.estado_editorial).toBe('REVISAR');
  });

  it('crisis SÍ confirmada en título (Rincón de Tamayo) sigue GO_ALTA', () => {
    const c = clasificarConsolidado('CLI-0002', ['tequila adulterado'], 'Detectan tequila presuntamente adulterado en Rincón de Tamayo');
    expect(c.estado_editorial).toBe('GO_ALTA');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
  });

  it('crisis SÍ confirmada en título (muertes/Salamanca) sigue GO_ALTA', () => {
    const c = clasificarConsolidado('CLI-0002', ['alcohol adulterado'], 'Muertes por alcohol adulterado bajan un 30% la clientela en bares y cantinas de Salamanca');
    expect(c.estado_editorial).toBe('GO_ALTA');
  });

  it('crisis SÍ confirmada en título (intoxicaciones/tequila Centenario) sigue GO_ALTA', () => {
    const c = clasificarConsolidado('CLI-0002', ['tequila adulterado'], 'Caen ventas de tequila Centenario tras intoxicaciones en Guanajuato');
    expect(c.estado_editorial).toBe('GO_ALTA');
  });
});

// ─── CLI-0001 (Jumex) — reglas editoriales ───────────────────────────────────

describe('clasificarConsolidado CLI-0001 (Jumex)', () => {
  it('Museo Jumex sin contexto bebidas = MUSEO_JUMEX_EXCLUIR', () => {
    const c = clasificarConsolidado('CLI-0001', ['Museo Jumex'], 'El Museo Jumex inaugura exposición de arte contemporáneo');
    expect(c.estado_editorial).toBe('MUSEO_JUMEX_EXCLUIR');
    expect(c.grupo_tema).toBe('MUSEO_JUMEX_EXCLUIR');
    expect(c.relevancia_editorial).toBe('POSIBLE_FP');
    expect(c.fp_flags).toContain('museo_jumex');
  });

  it('Fundación Jumex cultura = MUSEO_JUMEX_EXCLUIR', () => {
    const c = clasificarConsolidado('CLI-0001', ['Jumex'], 'Fundación Jumex presenta muestra de galería');
    expect(c.estado_editorial).toBe('MUSEO_JUMEX_EXCLUIR');
  });

  it('IEPS bebidas azucaradas = ALTA_RELEVANCIA / REGULATORIO_IEPS', () => {
    const c = clasificarConsolidado('CLI-0001', ['IEPS bebidas azucaradas'], 'Proponen aumentar IEPS a bebidas azucaradas');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c.grupo_tema).toBe('REGULATORIO_IEPS');
    expect(c.valoracion).toBe('ALTA');
  });

  it('retiro de producto = ALTA / negativo', () => {
    const c = clasificarConsolidado('CLI-0001', ['retiro de producto'], 'Profeco ordena retiro de producto por contaminación');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c.sentimiento).toBe('negativo');
  });

  it('Profeco con contexto = ALTA / PROFECO_COFEPRIS', () => {
    const c = clasificarConsolidado('CLI-0001', ['Profeco'], 'Profeco sanciona a embotelladora de jugos');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
    expect(c.grupo_tema).toBe('PROFECO_COFEPRIS');
  });

  it('jugos/néctares sectorial = MEDIA_RELEVANCIA', () => {
    const c = clasificarConsolidado('CLI-0001', ['jugos'], 'Mercado de jugos y néctares crece en México');
    expect(c.relevancia_editorial).toBe('MEDIA_RELEVANCIA');
    expect(c.grupo_tema).toBe('SALUD_PUBLICA_BEBIDAS');
  });

  it('Jumex sin contexto (posible FP corporativo) = BAJA / REVISAR', () => {
    const c = clasificarConsolidado('CLI-0001', ['Jumex'], 'Diecisiete toneladas de mango donadas a familias');
    expect(c.relevancia_editorial).toBe('BAJA_RELEVANCIA');
    expect(c.estado_editorial).toBe('REVISAR');
    expect(c.fp_flags).toContain('jumex_sin_contexto');
  });

  it('Museo Jumex NO gana si hay contexto regulatorio (IEPS) real', () => {
    const c = clasificarConsolidado('CLI-0001', ['Jumex', 'IEPS bebidas azucaradas'], 'Museo Jumex y el debate del IEPS a bebidas azucaradas');
    expect(c.estado_editorial).not.toBe('MUSEO_JUMEX_EXCLUIR');
    expect(c.relevancia_editorial).toBe('ALTA_RELEVANCIA');
  });
});

// ─── Consolidación por url_norm ──────────────────────────────────────────────

describe('consolidar', () => {
  const base: Omit<FilaCruda, 'keyword'> = {
    cliente_id: 'CLI-0002',
    cliente_nombre: 'Bebidas alcoholicas',
    medio: 'Periódico Correo',
    medio_id: 'MED-0164',
    fecha_noticia: '2026-07-11T03:27:02+00:00',
    titulo: 'Detectan tequila adulterado en Rincón de Tamayo',
    url: 'https://periodicocorreo.com.mx/nota-x',
    url_norm: 'https://periodicocorreo.com.mx/nota-x',
    requiere_alerta: false,
    prioridad: 'Media',
    texto_limpio_chars: 5152,
    texto_limpio_ok: true,
    fuente: 'ethos',
  };

  it('agrupa varias keywords de la misma URL en una fila', () => {
    const filas: FilaCruda[] = [
      { ...base, keyword: 'tequila adulterado', requiere_alerta: true, prioridad: 'Alta' },
      { ...base, keyword: 'tequila' },
      { ...base, keyword: 'bebidas adulteradas', requiere_alerta: true, prioridad: 'Alta' },
      { ...base, keyword: 'alcohol adulterado', requiere_alerta: true, prioridad: 'Alta' },
    ];
    const out = consolidar(filas);
    expect(out).toHaveLength(1);
    expect(out[0]!.keywords_count).toBe(4);
    expect(out[0]!.keywords_detectadas).toEqual(['tequila adulterado', 'tequila', 'bebidas adulteradas', 'alcohol adulterado']);
  });

  it('requiere_alerta consolidado = true si alguna keyword lo pide', () => {
    const filas: FilaCruda[] = [
      { ...base, keyword: 'tequila', requiere_alerta: false, prioridad: 'Media' },
      { ...base, keyword: 'tequila adulterado', requiere_alerta: true, prioridad: 'Alta' },
    ];
    expect(consolidar(filas)[0]!.requiere_alerta).toBe(true);
  });

  it('prioridad consolidada = la más alta del grupo', () => {
    const filas: FilaCruda[] = [
      { ...base, keyword: 'tequila', prioridad: 'Media' },
      { ...base, keyword: 'tequila adulterado', prioridad: 'Alta' },
    ];
    expect(consolidar(filas)[0]!.prioridad).toBe('Alta');
  });

  it('dedupe_key_consolidado = cliente_id::url_norm (una fila por noticia)', () => {
    const filas: FilaCruda[] = [{ ...base, keyword: 'tequila' }];
    expect(consolidar(filas)[0]!.dedupe_key_consolidado).toBe(dedupeKeyConsolidado('CLI-0002', base.url_norm));
  });

  it('separa dos URLs distintas del mismo cliente en dos filas', () => {
    const filas: FilaCruda[] = [
      { ...base, keyword: 'tequila' },
      { ...base, url_norm: 'https://otro.com/y', keyword: 'mezcal' },
    ];
    expect(consolidar(filas)).toHaveLength(2);
  });

  it('reduce filas raw a consolidadas (34 repetidas → menos)', () => {
    const filas: FilaCruda[] = [];
    for (let i = 0; i < 5; i++) filas.push({ ...base, keyword: `kw-${i}` }); // 5 keywords, misma URL
    const out = consolidar(filas);
    expect(out).toHaveLength(1);
    expect(out[0]!.keywords_count).toBe(5);
  });

  it('decodifica el título en la salida consolidada', () => {
    const filas: FilaCruda[] = [{ ...base, titulo: '&#8220;Alerta&#8221; por alcohol adulterado', keyword: 'alcohol adulterado' }];
    const out = consolidar(filas);
    expect(out[0]!.titulo).toBe('“Alerta” por alcohol adulterado');
    expect(out[0]!.titulo_original).toBe('&#8220;Alerta&#8221; por alcohol adulterado');
  });
});
