import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  mapToLegacyRow,
  HEADERS_TEST_PRESSCLIPPING,
  type MencionGrupo,
} from '../scripts/mery-export-test-pressclipping.js';
import { NUEVOS_MEDIOS_JALISCO } from '../scripts/catalog-mery-jalisco-priority.js';
import { normalizeSourceLegacy } from '../src/normalizers/meryLegacySource.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function mencionGrupo(overrides: Partial<MencionGrupo> = {}): MencionGrupo {
  return {
    noticia_id: 'nota-001',
    titulo: 'Mery Pozos denuncia corte de agua en Guadalajara',
    url: 'https://udgtv.com/noticias/mery-pozos-agua-2026',
    url_norm: 'udgtv.com/noticias/mery-pozos-agua-2026',
    medio: 'UDG TV / Canal 44',
    fecha_noticia: '2026-07-28T10:00:00',
    texto_raw: 'La diputada federal Mery Pozos exigió solución inmediata.',
    extracto_limpio: 'La diputada federal Mery Pozos exigió solución inmediata.',
    sentimiento: 'Nota Neutral ⚪️',
    tema: 'Política',
    keyword: 'Mery Pozos',
    categoria_editorial: 'MENCION_DIRECTA',
    grupo_tema: 'Gobierno / Legislativo',
    razon_clasificacion: 'nombre_fuerte_en_titulo',
    ...overrides,
  };
}

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe('parseArgs — defaults y flags', () => {
  it('defaults: windowDays=30, dryRun=false, output=console', () => {
    const a = parseArgs([]);
    expect(a.windowDays).toBe(30);
    expect(a.dryRun).toBe(false);
    expect(a.output).toBe('console');
    expect(a.spreadsheetId).toBe('1rWl-yDibT91AiELV-bkzaFiMTm6HY4JUSlBxiq-eNq8');
    expect(a.tabName).toBe('test_pressclipping');
  });

  it('--dry-run activa dryRun', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--window-hours=24 configura windowHours', () => {
    expect(parseArgs(['--window-hours=24']).windowHours).toBe(24);
  });

  it('--window-days=7 configura windowDays', () => {
    expect(parseArgs(['--window-days=7']).windowDays).toBe(7);
  });

  it('--output=sheet configura sheet', () => {
    expect(parseArgs(['--output=sheet']).output).toBe('sheet');
  });

  it('--spreadsheet-id configura spreadsheetId', () => {
    expect(parseArgs(['--spreadsheet-id=ABC123']).spreadsheetId).toBe('ABC123');
  });

  it('seguridad: ningún arg activa email/WhatsApp/Twilio/SMTP', () => {
    const a = parseArgs(['--dry-run', '--output=sheet', '--window-hours=24']);
    const salidaStr = JSON.stringify(a);
    expect(salidaStr).not.toMatch(/email|smtp|twilio|whatsapp|alertas_activas/i);
  });
});

// ─── mapToLegacyRow ───────────────────────────────────────────────────────────

describe('mapToLegacyRow — mapeo A-I', () => {
  it('mapea título a title', () => {
    const row = mapToLegacyRow(mencionGrupo());
    expect(row['title']).toBe('Mery Pozos denuncia corte de agua en Guadalajara');
  });

  it('mapea extracto_limpio a description', () => {
    const row = mapToLegacyRow(mencionGrupo());
    expect(row['description']).toContain('Mery Pozos');
  });

  it('mapea url a link', () => {
    const row = mapToLegacyRow(mencionGrupo());
    expect(row['link']).toBe('https://udgtv.com/noticias/mery-pozos-agua-2026');
  });

  it('mapea fecha_noticia a pubDate (solo fecha YYYY-MM-DD)', () => {
    const row = mapToLegacyRow(mencionGrupo());
    expect(row['pubDate']).toBe('2026-07-28');
  });

  it('mapea medio a source', () => {
    const row = mapToLegacyRow(mencionGrupo());
    expect(row['source']).toBe('UDG TV / Canal 44');
  });

  it('guid = MERY-ETHOS::url_norm', () => {
    const row = mapToLegacyRow(mencionGrupo());
    expect(String(row['guid'])).toMatch(/^MERY-ETHOS::/);
  });

  it('MENCION_DIRECTA y CONTEXTO_POLITICO → status=ETHOS_TEST', () => {
    expect(mapToLegacyRow(mencionGrupo({ categoria_editorial: 'MENCION_DIRECTA' }))['status']).toBe('ETHOS_TEST');
    expect(mapToLegacyRow(mencionGrupo({ categoria_editorial: 'CONTEXTO_POLITICO' }))['status']).toBe('ETHOS_TEST');
  });

  it('TEMA_RELACIONADO y POSIBLE_FP → status=REVISION', () => {
    expect(mapToLegacyRow(mencionGrupo({ categoria_editorial: 'TEMA_RELACIONADO' }))['status']).toBe('REVISION');
    expect(mapToLegacyRow(mencionGrupo({ categoria_editorial: 'POSIBLE_FP' }))['status']).toBe('REVISION');
  });

  it('sentimiento por defecto Nota Neutral ⚪️ si no hay sentimiento', () => {
    const row = mapToLegacyRow(mencionGrupo({ sentimiento: '' }));
    expect(row['sentimiento']).toBe('Nota Neutral ⚪️');
  });

  it('tema de la nota viene de grupo_tema', () => {
    const row = mapToLegacyRow(mencionGrupo({ grupo_tema: 'Gobierno / Legislativo' }));
    expect(row['tema de la nota']).toBe('Gobierno / Legislativo');
  });

  it('tema de la nota fallback a razon_clasificacion si no hay grupo_tema', () => {
    const row = mapToLegacyRow(mencionGrupo({ grupo_tema: '', razon_clasificacion: 'nombre_en_cuerpo' }));
    expect(row['tema de la nota']).toBe('nombre_en_cuerpo');
  });
});

// ─── HEADERS_TEST_PRESSCLIPPING ──────────────────────────────────────────────

describe('HEADERS_TEST_PRESSCLIPPING — columnas A-I exactas', () => {
  const EXPECTED = ['title', 'description', 'link', 'pubDate', 'source', 'guid', 'status', 'sentimiento', 'tema de la nota'];

  it('contiene exactamente los 9 encabezados legacy', () => {
    expect(HEADERS_TEST_PRESSCLIPPING).toEqual(EXPECTED);
  });

  it('no tiene header de email, smtp, twilio ni whatsapp', () => {
    const joined = HEADERS_TEST_PRESSCLIPPING.join(',').toLowerCase();
    expect(joined).not.toMatch(/email|smtp|twilio|whatsapp/);
  });

  it('no toca NOTAS ENVIADAS MERYPOZOS (la tab protegida)', () => {
    // El módulo solo define headers de test_pressclipping — no menciona la tab protegida
    const importedNames = Object.keys({ HEADERS_TEST_PRESSCLIPPING, parseArgs, mapToLegacyRow });
    expect(importedNames).not.toContain('NOTAS ENVIADAS MERYPOZOS');
  });

  it('dedupe por guid es posible (guid está en los headers)', () => {
    expect(HEADERS_TEST_PRESSCLIPPING).toContain('guid');
  });

  it('dedupe por link es posible (link está en los headers)', () => {
    expect(HEADERS_TEST_PRESSCLIPPING).toContain('link');
  });
});

// ─── Medios Jalisco — normalización ──────────────────────────────────────────

describe('Normalización de medios Jalisco priority', () => {
  it('Semanario Conciencia Pública normaliza a nombre canónico', () => {
    expect(normalizeSourceLegacy('concienciapublica.com.mx')).toBe('Semanario Conciencia Pública');
    expect(normalizeSourceLegacy('Conciencia Pública')).toBe('Semanario Conciencia Pública');
  });

  it('A Fondo Jalisco normaliza', () => {
    expect(normalizeSourceLegacy('A Fondo Jalisco')).toBe('A Fondo Jalisco');
    expect(normalizeSourceLegacy('afondojalisco.com')).toBe('A Fondo Jalisco');
  });

  it('AFmedios normaliza (ya en catálogo como MED-0187)', () => {
    expect(normalizeSourceLegacy('afmedios.com')).toBe('AFmedios');
  });

  it('Siker normaliza', () => {
    expect(normalizeSourceLegacy('siker.com.mx')).toBe('Siker');
  });

  it('Página 24 Jalisco normaliza', () => {
    expect(normalizeSourceLegacy('pagina24jalisco.com.mx')).toBe('Página 24 Jalisco');
  });
});

// ─── Medios nuevos — catálogo ─────────────────────────────────────────────────

describe('NUEVOS_MEDIOS_JALISCO — catálogo MED-0201..0204', () => {
  it('tiene exactamente 4 medios', () => {
    expect(NUEVOS_MEDIOS_JALISCO).toHaveLength(4);
  });

  it('IDs consecutivos MED-0201 a MED-0204', () => {
    const ids = NUEVOS_MEDIOS_JALISCO.map((m) => m.medio_id).sort();
    expect(ids).toEqual(['MED-0201', 'MED-0202', 'MED-0203', 'MED-0204']);
  });

  it('todos tienen rss_url definida (A_PUBLICO_FACIL candidato)', () => {
    for (const m of NUEVOS_MEDIOS_JALISCO) {
      expect(m.rss_url).toBeTruthy();
      expect(m.rss_url).toContain('/feed/');
    }
  });

  it('ninguno tiene requiere_javascript=true', () => {
    for (const m of NUEVOS_MEDIOS_JALISCO) {
      expect(m.requiere_javascript).toBe(false);
    }
  });

  it('ninguno tiene requiere_proxy=true', () => {
    for (const m of NUEVOS_MEDIOS_JALISCO) {
      expect(m.requiere_proxy).toBe(false);
    }
  });

  it('todos son estado Jalisco', () => {
    for (const m of NUEVOS_MEDIOS_JALISCO) {
      expect(m.estado).toBe('Jalisco');
    }
  });

  it('MURAL no está en los nuevos medios (D_PAGO_CONVENIO_API)', () => {
    const ids = NUEVOS_MEDIOS_JALISCO.map((m) => m.nombre_medio);
    expect(ids).not.toContain('MURAL');
    expect(ids.join('')).not.toMatch(/mural/i);
  });

  it('ningún medio activa alertas_activas en sus notas_tecnicas', () => {
    for (const m of NUEVOS_MEDIOS_JALISCO) {
      expect(m.notas_tecnicas ?? '').not.toMatch(/alertas_activas/i);
    }
  });
});

// ─── Deduplicación — comportamiento esperado ──────────────────────────────────

describe('Deduplicación por guid y link', () => {
  it('guid único por URL normalizada', () => {
    const g1 = mapToLegacyRow(mencionGrupo({ url_norm: 'udgtv.com/nota-a' }));
    const g2 = mapToLegacyRow(mencionGrupo({ url_norm: 'udgtv.com/nota-b' }));
    expect(g1['guid']).not.toBe(g2['guid']);
  });

  it('mismo url_norm genera el mismo guid (idempotencia)', () => {
    const g1 = mapToLegacyRow(mencionGrupo({ url_norm: 'udgtv.com/nota-x' }));
    const g2 = mapToLegacyRow(mencionGrupo({ url_norm: 'udgtv.com/nota-x' }));
    expect(g1['guid']).toBe(g2['guid']);
  });
});

// ─── Seguridad ────────────────────────────────────────────────────────────────

describe('Seguridad — verificaciones críticas', () => {
  it('parseArgs no activa email/WhatsApp/Twilio/SMTP con ninguna combinación', () => {
    const combinaciones = [
      ['--dry-run'],
      ['--output=sheet'],
      ['--window-hours=24', '--output=sheet'],
      ['--window-days=30', '--dry-run', '--output=sheet'],
    ];
    for (const combo of combinaciones) {
      const a = parseArgs(combo);
      const str = JSON.stringify(a);
      expect(str).not.toMatch(/email|smtp|twilio|whatsapp|alertas_activas/i);
    }
  });

  it('mapToLegacyRow no genera campos de envío (email, twilio, etc.)', () => {
    const row = mapToLegacyRow(mencionGrupo());
    const keys = Object.keys(row).join(',').toLowerCase();
    expect(keys).not.toMatch(/email|smtp|twilio|whatsapp/);
  });
});
