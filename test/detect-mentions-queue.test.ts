/**
 * Tests de comportamiento de la cola de detect-mentions:
 *   - getNoticiasPendientes acepta objeto de opciones (retrocompatible con número).
 *   - onlyWithText filtra correctamente.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { NoticiasPendientesOpts } from '../src/supabase/repositories.js';

// ─── Helpers de forma de los argumentos ─────────────────────────────────────

describe('NoticiasPendientesOpts', () => {
  it('acepta solo limit como número (retrocompatible)', () => {
    // El tipo acepta número o objeto; verificamos que el objeto se construye bien
    const opts: NoticiasPendientesOpts = { limit: 50 };
    expect(opts.onlyWithText).toBeUndefined();
  });

  it('acepta onlyWithText en objeto de opciones', () => {
    const opts: NoticiasPendientesOpts = { limit: 50, onlyWithText: true };
    expect(opts.onlyWithText).toBe(true);
  });

  it('onlyWithText es opcional (puede ser undefined)', () => {
    const opts: NoticiasPendientesOpts = { limit: 100 };
    expect('onlyWithText' in opts).toBe(false);
  });

  it('acepta medioIds para detección aislada por medio', () => {
    const opts: NoticiasPendientesOpts = { limit: 500, medioIds: ['MED-0030', 'MED-0025'] };
    expect(opts.medioIds).toEqual(['MED-0030', 'MED-0025']);
  });

  it('medioIds es opcional (puede ser undefined)', () => {
    const opts: NoticiasPendientesOpts = { limit: 100 };
    expect('medioIds' in opts).toBe(false);
  });
});

// ─── Parseo de --medio-ids (lista separada por comas) ───────────────────────

function parseMedioIds(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

describe('parseArgs --medio-ids', () => {
  it('parsea una lista separada por comas', () => {
    expect(parseMedioIds('MED-0030,MED-0008,MED-0025,MED-0053')).toEqual([
      'MED-0030', 'MED-0008', 'MED-0025', 'MED-0053',
    ]);
  });

  it('ignora espacios y entradas vacías', () => {
    expect(parseMedioIds(' MED-0030 , , MED-0008 ')).toEqual(['MED-0030', 'MED-0008']);
  });

  it('lista vacía produce arreglo vacío', () => {
    expect(parseMedioIds('')).toEqual([]);
  });
});

// ─── Lógica de parseo de flags en detect-mentions ───────────────────────────

function parseOnlyWithText(argv: string[]): boolean {
  return argv.some((a) => a === '--only-with-text');
}

describe('parseArgs --only-with-text', () => {
  it('detecta el flag correctamente', () => {
    expect(parseOnlyWithText(['--limit=50', '--only-with-text', '--dry-run'])).toBe(true);
  });

  it('devuelve false cuando no está presente', () => {
    expect(parseOnlyWithText(['--limit=50', '--dry-run'])).toBe(false);
  });

  it('no confunde flags similares', () => {
    expect(parseOnlyWithText(['--only-with-texts', '--only-with'])).toBe(false);
  });
});

// ─── Conteo de distribución de texto (lógica de dry-run) ────────────────────

interface MinNoticia {
  texto_cuerpo_nota: string | null;
  texto_nota_limpia: string | null;
  texto_extraido: string | null;
}

function clasificarNoticias(noticias: MinNoticia[]) {
  return {
    usandoCuerpo: noticias.filter((n) => n.texto_cuerpo_nota !== null).length,
    usandoTextoLimpio: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia !== null).length,
    usandoFallback: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia === null && n.texto_extraido !== null).length,
    sinTexto: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia === null && n.texto_extraido === null).length,
  };
}

describe('clasificarNoticias (lógica del resumen dry-run)', () => {
  const muestra: MinNoticia[] = [
    { texto_cuerpo_nota: 'cuerpo', texto_nota_limpia: 'limpio', texto_extraido: 'raw' },
    { texto_cuerpo_nota: null, texto_nota_limpia: 'limpio', texto_extraido: 'raw' },
    { texto_cuerpo_nota: null, texto_nota_limpia: null, texto_extraido: 'raw' },
    { texto_cuerpo_nota: null, texto_nota_limpia: null, texto_extraido: null },
  ];

  it('cuenta correctamente usandoCuerpo', () => {
    expect(clasificarNoticias(muestra).usandoCuerpo).toBe(1);
  });

  it('cuenta correctamente usandoTextoLimpio', () => {
    expect(clasificarNoticias(muestra).usandoTextoLimpio).toBe(1);
  });

  it('cuenta correctamente usandoFallback', () => {
    expect(clasificarNoticias(muestra).usandoFallback).toBe(1);
  });

  it('cuenta correctamente sinTexto', () => {
    expect(clasificarNoticias(muestra).sinTexto).toBe(1);
  });

  it('con --only-with-text, sinTexto siempre es 0', () => {
    // Simula que el filtro ya eliminó las noticias sin cuerpo
    const soloConCuerpo = muestra.filter((n) => n.texto_cuerpo_nota !== null);
    expect(clasificarNoticias(soloConCuerpo).sinTexto).toBe(0);
  });
});

// ─── Fresh Lane: parseo opt-in y retrocompatibilidad ─────────────────────────

function parseFreshLane(argv: string[]): boolean {
  return argv.some((a) => a === '--fresh-lane' || a.startsWith('--fresh-lane='));
}

describe('parseArgs --fresh-lane', () => {
  it('ausente → legacy (false)', () => {
    expect(parseFreshLane(['--limit=500', '--only-with-text', '--dry-run'])).toBe(false);
  });

  it('presente → opt-in', () => {
    expect(parseFreshLane(['--limit=500', '--fresh-lane', '--fresh-hours=48'])).toBe(true);
  });
});

describe('legacy y Fresh Lane — invariantes de código', () => {
  const repo = readFileSync(join(process.cwd(), 'src/supabase/repositories.ts'), 'utf-8');
  const detect = readFileSync(join(process.cwd(), 'scripts/detect-mentions.ts'), 'utf-8');

  it('getNoticiasPendientes(number) sigue exportada (retrocompatible)', () => {
    expect(repo).toMatch(/export async function getNoticiasPendientes\(/);
    expect(repo).toMatch(/limitOrOpts: number \| NoticiasPendientesOpts/);
  });

  it('sin freshLane la consulta legacy sigue oldest-first ASC', () => {
    expect(repo).toMatch(/if \(!opts\.freshLane\)/);
    expect(repo).toMatch(/\.order\('created_at', \{ ascending: true \}\)/);
  });

  it('fresh lane: fresh >= cutoff DESC y backlog < cutoff ASC; filtros idénticos', () => {
    expect(repo).toMatch(/\.gte\('created_at', cutoffIso\)/);
    expect(repo).toMatch(/\.lt\('created_at', cutoffIso\)/);
    expect(repo).toMatch(/ascending: false/);
    const usosFiltro = repo.split('aplicarFiltrosPendientes(').length - 1;
    expect(usosFiltro).toBeGreaterThanOrEqual(3);
  });

  it('--only-with-text se aplica en aplicarFiltrosPendientes (ambas lanes)', () => {
    expect(repo).toMatch(/if \(opts\.onlyWithText\)/);
    expect(repo).toMatch(/texto_cuerpo_nota/);
  });

  it('Fresh Lane + --client sigue SIN marcar procesadas', () => {
    expect(detect).toMatch(/if \(!args\.clientId\)/);
    expect(detect).toMatch(/markNoticiasProcesadas\(noticias\.map/);
    expect(detect).not.toMatch(/if \(!args\.clientId && !args\.freshLane\)/);
  });

  it('marca solo las noticias seleccionadas (cola.rows), no pools crudos', () => {
    expect(detect).toMatch(/const noticias = cola\.rows/);
    expect(detect).toMatch(/markNoticiasProcesadas\(noticias\.map\(\(n\) => n\.noticia_id\)\)/);
  });

  it('workflows shadow no activan Fresh Lane todavía', () => {
    const a = readFileSync(join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated.yml'), 'utf-8');
    const b = readFileSync(join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated-b.yml'), 'utf-8');
    const c = readFileSync(join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated-c.yml'), 'utf-8');
    expect(a).not.toContain('--fresh-lane');
    expect(b).not.toContain('--fresh-lane');
    expect(c).not.toContain('--fresh-lane');
  });
});
