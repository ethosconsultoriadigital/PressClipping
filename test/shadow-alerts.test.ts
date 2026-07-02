import { describe, it, expect } from 'vitest';
import {
  verificarFlagsAlertasSombra,
  verificarAllowlistShadow,
  parseShadowClientAllowlist,
} from '../src/utils/shadowGuard.js';
import {
  evaluarMencion,
  evaluarLote,
  dedupeKey,
  normalizarValoracion,
  esCrisisBebidasP1,
  esKeywordAmpliaLaboral,
  tieneContextoCriticoLaboral,
  ALERTAS_SOMBRA_HEADERS,
  type MencionAlertaInput,
} from '../src/alerts/shadowAlertRules.js';

/** Mención base VÁLIDA y NO crítica (relevancia media → P2_RESUMEN). */
const base = (over: Partial<MencionAlertaInput> = {}): MencionAlertaInput => ({
  mencion_id: 'MEN-1',
  cliente_id: 'CLI-1',
  cliente: 'Cliente Uno',
  noticia_id: 'NOT-1',
  medio: 'El Economista',
  titulo: 'Una nota válida',
  url: 'https://example.com/nota-1',
  keyword: 'reforma laboral',
  sentimiento: 'neutro',
  valoracion: 0.4,
  prioridad_medio: 'media',
  cliente_activo: true,
  cliente_alertas_activas: true,
  keyword_activa: true,
  keyword_alerta: false,
  keyword_prioridad: 'media',
  tema_reputacional: false,
  es_falso_positivo: false,
  requiere_alerta: false,
  ...over,
});

describe('verificarFlagsAlertasSombra', () => {
  it('permite flags seguros y confirmaciones --no-*', () => {
    expect(
      verificarFlagsAlertasSombra([
        '--window-hours=48', '--output=sheet', '--dry-run',
        '--no-send', '--no-whatsapp', '--no-email',
      ]).ok,
    ).toBe(true);
  });

  it('bloquea --send con mensaje claro', () => {
    const r = verificarFlagsAlertasSombra(['--send']);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('Shadow alerts forbid real sending.');
  });

  it('bloquea --whatsapp/--email/--twilio/--gmail/--smtp/--enviar', () => {
    for (const f of ['--whatsapp', '--email', '--twilio', '--gmail', '--smtp', '--enviar']) {
      expect(verificarFlagsAlertasSombra([f]).ok).toBe(false);
    }
  });
});

describe('reglas P1/P2/P3 (anti sobre-alertamiento)', () => {
  it('sentimiento negativo + valoración alta → P1_INMEDIATA/whatsapp', () => {
    const d = evaluarMencion(base({ sentimiento: 'negativo', valoracion: 0.8 }));
    expect(d.estado_shadow).toBe('P1_INMEDIATA');
    expect(d.tipo_alerta_simulada).toBe('inmediata');
    expect(d.canal_simulado).toBe('whatsapp');
    expect(d.habria_alerta).toBe('SÍ');
    expect(d.regla_disparo).toContain('sentimiento_negativo_valoracion_alta');
  });

  it('valoración crítica (≥0.85) SOLA ya NO dispara P1 (calibración → P2)', () => {
    expect(evaluarMencion(base({ valoracion: 0.9 })).estado_shadow).toBe('P2_RESUMEN');
    expect(evaluarMencion(base({ valoracion: 1 })).estado_shadow).toBe('P2_RESUMEN');
  });

  it('requiere_alerta CON relevancia alta → P1; keyword_alerta exige prioridad alta', () => {
    expect(evaluarMencion(base({ requiere_alerta: true, valoracion: 0.9 })).estado_shadow).toBe('P1_INMEDIATA');
    expect(evaluarMencion(base({ keyword_alerta: true, keyword_prioridad: 'alta', valoracion: 0.9 })).estado_shadow).toBe('P1_INMEDIATA');
    // keyword_alerta con prioridad media (no alta) no basta para P1.
    expect(evaluarMencion(base({ keyword_alerta: true, valoracion: 0.9 })).estado_shadow).toBe('P2_RESUMEN');
  });

  it('tema_reputacional SOLO ya NO dispara P1 (calibración → P2)', () => {
    expect(evaluarMencion(base({ tema_reputacional: true })).estado_shadow).toBe('P2_RESUMEN');
  });

  it('keyword_alerta/requiere_alerta SIN relevancia alta NO disparan P1 (→ P2)', () => {
    expect(evaluarMencion(base({ keyword_alerta: true, valoracion: 0.4 })).estado_shadow).toBe('P2_RESUMEN');
    expect(evaluarMencion(base({ requiere_alerta: true, valoracion: 0.4 })).estado_shadow).toBe('P2_RESUMEN');
  });

  it('medio prioridad ALTA por sí solo NO dispara P1 (→ P2)', () => {
    const d = evaluarMencion(base({ prioridad_medio: 'alta' }));
    expect(d.estado_shadow).toBe('P2_RESUMEN');
  });

  it('keyword crítica por sí sola NO dispara P1 si no hay señal fuerte (→ P2)', () => {
    const d = evaluarMencion(base({ keyword_prioridad: 'critica' }));
    expect(d.estado_shadow).toBe('P2_RESUMEN');
  });

  it('sentimiento negativo SIN valoración alta NO es P1 (→ P2)', () => {
    const d = evaluarMencion(base({ sentimiento: 'negativo', valoracion: 0.4 }));
    expect(d.estado_shadow).toBe('P2_RESUMEN');
  });

  it('mención laboral/regulatoria neutra relevante → P2_RESUMEN/email', () => {
    const d = evaluarMencion(base());
    expect(d.estado_shadow).toBe('P2_RESUMEN');
    expect(d.tipo_alerta_simulada).toBe('resumen');
    expect(d.canal_simulado).toBe('email');
    expect(d.habria_alerta).toBe('SÍ');
  });

  it('monitoreo general (baja urgencia) → P3_DASHBOARD/dashboard, sin alerta', () => {
    const d = evaluarMencion(base({ valoracion: 0.2, prioridad_medio: 'baja', keyword_prioridad: 'baja' }));
    expect(d.estado_shadow).toBe('P3_DASHBOARD');
    expect(d.tipo_alerta_simulada).toBe('monitoreo');
    expect(d.canal_simulado).toBe('dashboard');
    expect(d.habria_alerta).toBe('NO');
  });
});

describe('calibración P1 — casos reales del dry-run', () => {
  // Nota laboral: base con keyword amplia, tema_reputacional y valoración variable.
  const laboral = (over: Partial<MencionAlertaInput> = {}): MencionAlertaInput =>
    base({ cliente_id: 'CLI-0003', cliente: 'Reforma laboral', tema_reputacional: true, keyword_alerta: true, ...over });
  // Nota de bebidas: cliente crisis, keyword de crisis.
  const bebidas = (over: Partial<MencionAlertaInput> = {}): MencionAlertaInput =>
    base({ cliente_id: 'CLI-0002', cliente: 'Bebidas alcohólicas', keyword: 'tequila adulterado', keyword_alerta: true, requiere_alerta: true, valoracion: 0.5, ...over });

  describe('DEBEN bajar de P1 (ruido keyword amplia laboral)', () => {
    const casos: Array<[string, string, number]> = [
      ['Qué pasa si ICE llega a tu trabajo en California: derechos del empleado', 'trabajadores', 0.5],
      ['Maestros en Guanajuato reciben mil 125 plazas definitivas', 'sindicato', 0.5],
      ['Volkswagen en Alemania analiza cerrar cuatro fábricas', 'sindicato', 0.6],
      ['La educación no puede ser rehén de intereses políticos y económicos', 'derechos laborales', 0.5],
      ['Sates llama a aprovechar descuentos en trámites vehiculares', 'sindicato', 0.4],
      ['¿Cuándo regresan a clases en la UABC? Ya hay fecha para el semestre 2026', 'sindicato', 0.5],
      ['Agotamiento e irritabilidad: 5 señales de burnout bajo la NOM-035', 'trabajadores', 0.9],
      ['Bolivia libera el precio del dólar tras 15 años de cotización fijada', 'sindicato', 0.6],
    ];
    for (const [titulo, keyword, valoracion] of casos) {
      it(`NO P1: "${titulo.slice(0, 40)}" (${keyword})`, () => {
        const d = evaluarMencion(laboral({ titulo, keyword, valoracion }));
        expect(d.estado_shadow).not.toBe('P1_INMEDIATA');
        expect(['P2_RESUMEN', 'P3_DASHBOARD']).toContain(d.estado_shadow);
      });
    }
  });

  describe('DEBEN conservar P1/P2 fuerte (contexto crítico laboral)', () => {
    it('P1: Stashag — estalla la huelga (huelga + valoración crítica)', () => {
      const d = evaluarMencion(laboral({ titulo: 'Stashag decide esta noche en voto secreto si estalla la huelga este martes', keyword: 'huelga', valoracion: 0.9 }));
      expect(d.estado_shadow).toBe('P1_INMEDIATA');
      expect(d.regla_disparo).toContain('contexto_critico_laboral');
    });
    it('P1: trabajadores de la CFE desaparecidos (contexto crítico + val crítica)', () => {
      const d = evaluarMencion(laboral({ titulo: 'FGR tomará caso de trabajadores de la CFE desaparecidos en Hidalgo', keyword: 'trabajadores', valoracion: 0.9 }));
      expect(d.estado_shadow).toBe('P1_INMEDIATA');
    });
    it('P1: Sindicato Minero + narco (contexto crítico)', () => {
      const d = evaluarMencion(laboral({ titulo: 'Denuncia Sindicato Minero intromisión del narco con apoyo de trasnacionales', keyword: 'sindicato', valoracion: 0.9 }));
      expect(d.estado_shadow).toBe('P1_INMEDIATA');
    });
    it('P2 (no inmediata): contratos colectivos / litigios sin gravedad', () => {
      const d = evaluarMencion(laboral({ titulo: 'Disputas por titularidad de contratos colectivos disparan litigios laborales: INEGI', keyword: 'trabajadores', valoracion: 0.5, sentimiento: 'neutro' }));
      expect(d.estado_shadow).toBe('P2_RESUMEN');
    });
  });

  describe('DEBEN conservar P1 (crisis bebidas)', () => {
    const crisis: Array<[string, string]> = [
      ['Suman seis los muertos por consumo de tequila adulterado', 'tequila adulterado'],
      ['Causa ceguera y convulsiones tequila adulterado: SSEG', 'tequila adulterado'],
      ['Fiscalía catea vinatería por muerte ligada a tequila adulterado', 'tequila adulterado'],
      ['Intoxicación por metanol deja varios hospitalizados', 'metanol'],
      ['Muere hombre por consumir tequila adulterado en Guanajuato', 'tequila adulterado'],
    ];
    for (const [titulo, keyword] of crisis) {
      it(`P1: "${titulo.slice(0, 40)}"`, () => {
        const d = evaluarMencion(bebidas({ titulo, keyword, valoracion: 0.5 }));
        expect(d.estado_shadow).toBe('P1_INMEDIATA');
        expect(d.regla_disparo).toContain('crisis_bebidas');
      });
    }

    it('P1: keyword de crisis + requiere_alerta si el título menciona alcohol/bebida', () => {
      const d = evaluarMencion(bebidas({ titulo: 'Operativo por venta de alcohol en Irapuato', keyword: 'alcohol adulterado', requiere_alerta: true, valoracion: 0.3 }));
      expect(d.estado_shadow).toBe('P1_INMEDIATA');
      expect(d.regla_disparo).toContain('crisis_bebidas');
    });

    it('NO P1: contaminación de keyword (fútbol/tala) con título ajeno a bebidas', () => {
      const futbol = evaluarMencion(bebidas({ titulo: 'Contrata Club Irapuato como vicepresidente a Alfredo Castillo', keyword: 'alcohol adulterado', requiere_alerta: true, valoracion: 0.3 }));
      expect(futbol.estado_shadow).not.toBe('P1_INMEDIATA');
      const tala = evaluarMencion(bebidas({ titulo: 'Vecinos denuncian presunta tala ilegal de árboles en Quintanilla', keyword: 'alcohol adulterado', requiere_alerta: true, valoracion: 0.3 }));
      expect(tala.estado_shadow).not.toBe('P1_INMEDIATA');
    });
  });

  describe('las 2 residuales descartadas de MED-0171 NO reaparecen como P1', () => {
    // Descartadas: requiere_alerta=false, título NO es crisis (keyword contaminada).
    it('NO P1: Pronostican inundaciones (keyword tequila adulterado, requiere_alerta=false)', () => {
      const d = evaluarMencion(bebidas({ titulo: 'Pronostican inundaciones en diversas zonas de Guanajuato', requiere_alerta: false, valoracion: 0.4 }));
      expect(d.estado_shadow).not.toBe('P1_INMEDIATA');
    });
    it('NO P1: Dan 60 años a secuestradores (keyword tequila adulterado, requiere_alerta=false)', () => {
      const d = evaluarMencion(bebidas({ titulo: 'Dan 60 años de cárcel a secuestradores de Salamanca', requiere_alerta: false, valoracion: 0.4 }));
      expect(d.estado_shadow).not.toBe('P1_INMEDIATA');
    });
  });

  describe('helpers de calibración', () => {
    it('esKeywordAmpliaLaboral detecta trabajador/sindicato/derechos laborales', () => {
      expect(esKeywordAmpliaLaboral(base({ keyword: 'trabajadores' }))).toBe(true);
      expect(esKeywordAmpliaLaboral(base({ keyword: 'sindicato' }))).toBe(true);
      expect(esKeywordAmpliaLaboral(base({ keyword: 'derechos laborales' }))).toBe(true);
      expect(esKeywordAmpliaLaboral(base({ keyword: 'huelga' }))).toBe(false);
      expect(esKeywordAmpliaLaboral(base({ keyword: 'tequila adulterado' }))).toBe(false);
    });
    it('tieneContextoCriticoLaboral detecta huelga/narco/desaparecidos', () => {
      expect(tieneContextoCriticoLaboral(base({ titulo: 'estalla la huelga en Guasave' }))).toBe(true);
      expect(tieneContextoCriticoLaboral(base({ titulo: 'Sindicato Minero y el narco' }))).toBe(true);
      expect(tieneContextoCriticoLaboral(base({ titulo: 'trabajadores desaparecidos en Hidalgo' }))).toBe(true);
      expect(tieneContextoCriticoLaboral(base({ titulo: 'Maestros reciben plazas' }))).toBe(false);
    });
    it('esCrisisBebidasP1 exige título de crisis o keyword+requiere_alerta', () => {
      expect(esCrisisBebidasP1(base({ titulo: 'Muertos por tequila adulterado', keyword: 'tequila adulterado' }))).toBe(true);
      expect(esCrisisBebidasP1(base({ titulo: 'Pronostican inundaciones', keyword: 'tequila adulterado', requiere_alerta: false }))).toBe(false);
      // keyword de crisis + requiere_alerta pero título ajeno (fútbol) → NO crisis.
      expect(esCrisisBebidasP1(base({ titulo: 'Club Irapuato va por el ascenso', keyword: 'alcohol adulterado', requiere_alerta: true }))).toBe(false);
      // keyword de crisis + requiere_alerta con título que menciona alcohol → crisis.
      expect(esCrisisBebidasP1(base({ titulo: 'Operativo por alcohol en Irapuato', keyword: 'alcohol adulterado', requiere_alerta: true }))).toBe(true);
    });
  });
});

describe('allowlist shadow-only (CLI-0002 alertas_activas=false)', () => {
  // Simula una mención de CLI-0002 Bebidas alcohólicas con alertas_activas=false.
  const cli2 = (over: Partial<MencionAlertaInput> = {}): MencionAlertaInput =>
    base({
      cliente_id: 'CLI-0002', cliente: 'Bebidas alcohólicas',
      cliente_alertas_activas: false, keyword: 'tequila adulterado',
      keyword_alerta: true, requiere_alerta: true, valoracion: 0.5, ...over,
    });

  it('sin allowlist: crisis bebidas de CLI-0002 queda BLOQUEADA (alertas_cliente_desactivadas)', () => {
    const d = evaluarMencion(cli2({ titulo: 'Suman seis muertos por tequila adulterado' }));
    expect(d.estado_shadow).toBe('BLOQUEADA');
    expect(d.motivo_bloqueo).toBe('alertas_cliente_desactivadas');
  });

  it('con allowlist (permitir_shadow_cliente_inactivo): crisis bebidas → P1_INMEDIATA', () => {
    const d = evaluarMencion(cli2({ titulo: 'Suman seis muertos por tequila adulterado', permitir_shadow_cliente_inactivo: true }));
    expect(d.estado_shadow).toBe('P1_INMEDIATA');
    expect(d.regla_disparo).toContain('crisis_bebidas');
  });

  it('con allowlist: nota de bebidas NO crisis no sube a P1 (→ P2/P3)', () => {
    const d = evaluarMencion(cli2({ titulo: 'Isadora y Minerva son excluidas de un evento social', keyword: 'tequila', requiere_alerta: false, valoracion: 0.4, permitir_shadow_cliente_inactivo: true }));
    expect(d.estado_shadow).not.toBe('P1_INMEDIATA');
    expect(['P2_RESUMEN', 'P3_DASHBOARD']).toContain(d.estado_shadow);
  });

  it('cliente_inactivo NO se levanta por el allowlist (sigue BLOQUEADA)', () => {
    const d = evaluarMencion(cli2({ titulo: 'Muertos por tequila adulterado', cliente_activo: false, permitir_shadow_cliente_inactivo: true }));
    expect(d.estado_shadow).toBe('BLOQUEADA');
    expect(d.motivo_bloqueo).toBe('cliente_inactivo');
  });

  it('el allowlist para CLI-0002 NO afecta la calibración de CLI-0003 (genérico NO P1)', () => {
    const d = evaluarMencion(base({ cliente_id: 'CLI-0003', keyword: 'trabajadores', titulo: 'Maestros reciben plazas', tema_reputacional: true }));
    expect(d.estado_shadow).not.toBe('P1_INMEDIATA');
  });

  describe('guardas del flag --shadow-client-allowlist', () => {
    it('permitido en modo dry-run sin envío', () => {
      expect(verificarAllowlistShadow(['--shadow-client-allowlist=CLI-0002', '--dry-run', '--no-send']).ok).toBe(true);
    });
    it('aborta si coexiste con --send / --whatsapp / --email', () => {
      expect(verificarAllowlistShadow(['--shadow-client-allowlist=CLI-0002', '--send']).ok).toBe(false);
      expect(verificarAllowlistShadow(['--shadow-client-allowlist=CLI-0002', '--whatsapp']).ok).toBe(false);
      expect(verificarAllowlistShadow(['--shadow-client-allowlist=CLI-0002', '--email']).ok).toBe(false);
    });
    it('sin allowlist no impone restricción extra', () => {
      expect(verificarAllowlistShadow(['--dry-run']).ok).toBe(true);
    });
    it('parseShadowClientAllowlist separa CSV y limpia', () => {
      expect(parseShadowClientAllowlist(['--shadow-client-allowlist=CLI-0002, CLI-0009 '])).toEqual(['CLI-0002', 'CLI-0009']);
      expect(parseShadowClientAllowlist(['--window-hours=48'])).toEqual([]);
    });
  });
});

describe('bloqueos', () => {
  it('cliente inactivo / alertas desactivadas / keyword inactiva', () => {
    expect(evaluarMencion(base({ cliente_activo: false, keyword_alerta: true })).estado_shadow).toBe('BLOQUEADA');
    expect(evaluarMencion(base({ cliente_alertas_activas: false })).motivo_bloqueo).toBe('alertas_cliente_desactivadas');
    expect(evaluarMencion(base({ keyword_activa: false })).motivo_bloqueo).toBe('keyword_inactiva');
  });

  it('falso positivo / sin url / sin título / sin medio', () => {
    expect(evaluarMencion(base({ es_falso_positivo: true })).motivo_bloqueo).toBe('posible_falso_positivo');
    expect(evaluarMencion(base({ url: '' })).motivo_bloqueo).toBe('sin_url');
    expect(evaluarMencion(base({ titulo: '' })).motivo_bloqueo).toBe('sin_titulo');
    expect(evaluarMencion(base({ medio: '' })).motivo_bloqueo).toBe('sin_medio');
  });

  it('baja relevancia extrema (≈0 + medio baja prioridad) → BLOQUEADA', () => {
    const d = evaluarMencion(base({ valoracion: 0.02, prioridad_medio: 'baja', keyword_prioridad: 'baja' }));
    expect(d.estado_shadow).toBe('BLOQUEADA');
    expect(d.motivo_bloqueo).toBe('baja_relevancia_extrema');
  });
});

describe('dedupe fuerte + agrupación de keywords', () => {
  it('dedupe_key usa cliente_id + noticia_id (no mencion_id)', () => {
    expect(dedupeKey(base())).toBe('CLI-1::NOT-1');
    // distinta mención/keyword, misma nota → misma key
    expect(dedupeKey(base({ mencion_id: 'MEN-2', keyword: 'otra' }))).toBe('CLI-1::NOT-1');
  });

  it('dedupe_key cae a cliente_id + url_norm sin noticia_id', () => {
    const k = dedupeKey(base({ noticia_id: null }));
    expect(k.startsWith('CLI-1::')).toBe(true);
    expect(k).not.toBe('CLI-1::NOT-1');
  });

  it('dedupe_key cae a cliente+titulo+medio+fecha sin noticia_id ni url', () => {
    const k = dedupeKey(base({ noticia_id: null, url: '', fecha_publicacion: '2026-06-29' }));
    expect(k).toContain('una nota válida');
    expect(k).toContain('2026-06-29');
  });

  it('misma nota con 3 keywords → 1 alerta agrupada (no 3 inmediatas) + 2 DUPLICADA', () => {
    const { candidatos, resumen } = evaluarLote([
      base({ mencion_id: 'M1', keyword: 'reforma laboral', requiere_alerta: true, valoracion: 1 }),
      base({ mencion_id: 'M2', keyword: 'conciliación laboral' }),
      base({ mencion_id: 'M3', keyword: 'Centro de Conciliación Laboral' }),
    ]);
    expect(candidatos).toHaveLength(3);
    expect(candidatos[0]!.estado_shadow).toBe('P1_INMEDIATA');
    expect(candidatos[1]!.estado_shadow).toBe('DUPLICADA');
    expect(candidatos[2]!.estado_shadow).toBe('DUPLICADA');
    expect(resumen.p1_inmediata).toBe(1);
    expect(resumen.duplicada).toBe(2);
  });

  it('notas/keywords_detectadas incluye las keywords agrupadas', () => {
    const { candidatos } = evaluarLote([
      base({ mencion_id: 'M1', keyword: 'reforma laboral' }),
      base({ mencion_id: 'M2', keyword: 'conciliación laboral' }),
    ]);
    expect(candidatos[0]!.keywords_detectadas).toContain('reforma laboral');
    expect(candidatos[0]!.keywords_detectadas).toContain('conciliación laboral');
  });

  it('notas no genera P1 múltiple por keywords de la misma nota', () => {
    const { resumen } = evaluarLote([
      base({ mencion_id: 'M1', keyword: 'k1', requiere_alerta: true, valoracion: 1 }),
      base({ mencion_id: 'M2', keyword: 'k2', requiere_alerta: true, valoracion: 1 }),
      base({ mencion_id: 'M3', keyword: 'k3', requiere_alerta: true, valoracion: 1 }),
    ]);
    expect(resumen.p1_inmediata).toBe(1);
    expect(resumen.duplicada).toBe(2);
  });
});

describe('normalizarValoracion', () => {
  it('mantiene 0–1 y convierte 0–100', () => {
    expect(normalizarValoracion(0.8)).toBeCloseTo(0.8);
    expect(normalizarValoracion(80)).toBeCloseTo(0.8);
    expect(normalizarValoracion(null)).toBe(0);
  });
});

describe('contrato 10_Alertas_Sombra', () => {
  it('headers correctos y en orden (25)', () => {
    expect(ALERTAS_SOMBRA_HEADERS).toEqual([
      'run_id', 'fecha_ejecucion', 'modo', 'cliente_id', 'cliente', 'mencion_id',
      'noticia_id', 'fecha_publicacion', 'medio', 'titulo', 'url', 'keyword',
      'grupo_tema', 'sentimiento', 'valoracion', 'prioridad_medio',
      'tipo_alerta_simulada', 'canal_simulado', 'habria_alerta', 'motivo_alerta',
      'motivo_bloqueo', 'regla_disparo', 'dedupe_key', 'estado_shadow', 'notas',
    ]);
    expect(ALERTAS_SOMBRA_HEADERS).toHaveLength(25);
  });
});
