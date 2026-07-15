/**
 * Tests de los 2 fixes aplicados a export-patron-final-approved-no-pc.ts:
 * 1. mapaCol reconoce headers combinados ("titulo / titular") por palabra completa.
 * 2. El gate de escritura no exige human_review_rows=0 global — solo que ninguna
 *    fila de revisión humana esté en el set a escribir.
 */
import { describe, it, expect } from 'vitest';

// ─── Replica de mapaCol (fix #2: headers combinados) ─────────────────────────

function mapaCol(targetHeaders: string[], nombreLower: string): string | undefined {
  const exacto = targetHeaders.find((h) => h.trim().toLowerCase() === nombreLower);
  if (exacto) return exacto;
  return targetHeaders.find((h) =>
    h.toLowerCase().split(/[/,]/).map((p) => p.trim()).includes(nombreLower),
  );
}

describe('mapaCol (mapeo de headers reales de NoticiasPatron)', () => {
  const headersReales = [
    'idnoticia', 'estanteria', 'palabra', 'fecha_publicacion', 'medio', 'hora captura',
    'titulo / titular', 'nota completa', 'url', 'sentimiento', 'tema', 'hora_local',
    'ID Envio', 'Valoracion', 'FechaCaptura', 'HoraCaptura',
  ];

  it('encuentra "titulo" dentro del header combinado "titulo / titular"', () => {
    expect(mapaCol(headersReales, 'titulo')).toBe('titulo / titular');
  });

  it('encuentra "titular" dentro del mismo header combinado', () => {
    expect(mapaCol(headersReales, 'titular')).toBe('titulo / titular');
  });

  it('encuentra headers exactos sin combinar (idnoticia, url, medio)', () => {
    expect(mapaCol(headersReales, 'idnoticia')).toBe('idnoticia');
    expect(mapaCol(headersReales, 'url')).toBe('url');
    expect(mapaCol(headersReales, 'medio')).toBe('medio');
  });

  it('es case-insensitive para "id envio" → "ID Envio"', () => {
    expect(mapaCol(headersReales, 'id envio')).toBe('ID Envio');
  });

  it('devuelve undefined si el nombre no existe en ningún header', () => {
    expect(mapaCol(headersReales, 'columna_inexistente')).toBeUndefined();
  });

  it('no matchea substrings parciales (p.ej. "tit" no debe matchear "titulo")', () => {
    expect(mapaCol(headersReales, 'tit')).toBeUndefined();
  });
});

// ─── Replica del gate corregido (fix #1: human_review no bloquea globalmente) ─

interface FilaAprobada { url: string; }
interface FilaRevision { url: string; }

function calcularReadyToWrite(opts: {
  accesoTargetOk: boolean;
  columnasFaltantes: string[];
  jumexRows: number;
  rowsMissingFullText: number;
  newRows: FilaAprobada[];
  revisionHumana: FilaRevision[];
}): boolean {
  const revisionHumanaEnEscritura = opts.newRows.some((f) =>
    opts.revisionHumana.some((r) => r.url === f.url),
  );
  return (
    opts.accesoTargetOk &&
    opts.columnasFaltantes.length === 0 &&
    !revisionHumanaEnEscritura &&
    opts.jumexRows === 0 &&
    opts.rowsMissingFullText === 0 &&
    opts.newRows.length > 0
  );
}

describe('calcularReadyToWrite (gate corregido)', () => {
  it('pasa con 3 filas de revisión humana existentes, mientras NINGUNA esté en newRows', () => {
    const ready = calcularReadyToWrite({
      accesoTargetOk: true,
      columnasFaltantes: [],
      jumexRows: 0,
      rowsMissingFullText: 0,
      newRows: [{ url: 'a' }, { url: 'b' }],
      revisionHumana: [{ url: 'c' }, { url: 'd' }, { url: 'e' }], // 3 retenidas, correctas
    });
    expect(ready).toBe(true);
  });

  it('NO pasa si por error una fila de revisión humana se coló en newRows', () => {
    const ready = calcularReadyToWrite({
      accesoTargetOk: true,
      columnasFaltantes: [],
      jumexRows: 0,
      rowsMissingFullText: 0,
      newRows: [{ url: 'a' }, { url: 'c' }], // 'c' es de revisión humana
      revisionHumana: [{ url: 'c' }, { url: 'd' }, { url: 'e' }],
    });
    expect(ready).toBe(false);
  });

  it('NO pasa sin acceso a la hoja destino', () => {
    expect(calcularReadyToWrite({
      accesoTargetOk: false, columnasFaltantes: [], jumexRows: 0, rowsMissingFullText: 0,
      newRows: [{ url: 'a' }], revisionHumana: [],
    })).toBe(false);
  });

  it('NO pasa con columnas críticas faltantes', () => {
    expect(calcularReadyToWrite({
      accesoTargetOk: true, columnasFaltantes: ['idnoticia'], jumexRows: 0, rowsMissingFullText: 0,
      newRows: [{ url: 'a' }], revisionHumana: [],
    })).toBe(false);
  });

  it('NO pasa si hay filas Jumex', () => {
    expect(calcularReadyToWrite({
      accesoTargetOk: true, columnasFaltantes: [], jumexRows: 1, rowsMissingFullText: 0,
      newRows: [{ url: 'a' }], revisionHumana: [],
    })).toBe(false);
  });

  it('NO pasa si faltan notas completas', () => {
    expect(calcularReadyToWrite({
      accesoTargetOk: true, columnasFaltantes: [], jumexRows: 0, rowsMissingFullText: 2,
      newRows: [{ url: 'a' }], revisionHumana: [],
    })).toBe(false);
  });

  it('NO pasa si no hay filas nuevas que escribir', () => {
    expect(calcularReadyToWrite({
      accesoTargetOk: true, columnasFaltantes: [], jumexRows: 0, rowsMissingFullText: 0,
      newRows: [], revisionHumana: [],
    })).toBe(false);
  });
});
