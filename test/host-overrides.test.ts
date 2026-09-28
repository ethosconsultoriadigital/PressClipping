import { describe, it, expect } from 'vitest';
import { extractFromHtml } from '../src/extractors/html.js';

const ARTICULO_REAL =
  'Un hombre de 40 años murió durante la mañana del domingo luego de un reporte de violencia al interior de un domicilio en Salinas Victoria. ';

function htmlPosta(): string {
  return `<html><body>
    <article>
      <header><h1>Hombre muere tras presunta riña</h1></header>
      <div>
        <p class="resumen_nota">La muerte de un hombre en Salinas Victoria está siendo investigada.</p>
        <div class="disclaimer-texto ia-after-typing">¿Fue útil este resumen?</div>
        <p>Resumen y análisis automáticos realizados con Inteligencia Artificial</p>
        <p>Este resumen y su análisis fueron generados con apoyo de Inteligencia Artificial. Aunque buscamos ofrecer claridad y precisión, recomendamos contrastar la información.</p>
      </div>
      <p>${ARTICULO_REAL}${ARTICULO_REAL}</p>
      <p>${ARTICULO_REAL}${ARTICULO_REAL}</p>
      <div class="nota-relacionada">Te puede interesar: Encuentran a hombre muerto en colonia Independencia</div>
    </article>
  </body></html>`;
}

describe('host-scoped POSTA override', () => {
  it('BEFORE defect: cloned AI disclaimer would dominate without host cleanup — AFTER: article body, no IA clone', () => {
    const r = extractFromHtml(htmlPosta(), 'https://www.posta.com.mx/nuevo-leon/hombre-muere/vl1');
    expect(r.texto_cuerpo_nota ?? '').toContain('Un hombre de 40 años murió');
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/Resumen y análisis automáticos/i);
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/Te puede interesar/i);
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
  });

  it('control: same HTML on an unrelated host keeps the IA block (no global strip)', () => {
    const r = extractFromHtml(htmlPosta(), 'https://www.eluniversal.com.mx/estados/nota.html');
    expect(r.texto_cuerpo_nota ?? r.texto_nota_limpia ?? '').toMatch(
      /Resumen y análisis automáticos/i,
    );
  });
});
