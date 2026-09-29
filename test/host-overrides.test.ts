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

const CHIH_BODY =
  'Las exportaciones mexicanas aumentaron 40.4% en agosto respecto al mismo mes del año pasado, de acuerdo con el INEGI. Las de equipos eléctricos y electrónicos lideraron el avance en la balanza comercial del país según el reporte oficial del instituto. ';

function htmlChihuahua(): string {
  return `<html><body>
    <article class="article article--news">
      <div>Publicidad Publicidad Publicidad Publicidad</div>
      <div class="article-snippet">Teaser de otra nota</div>
      <div class="article-body"><p>${CHIH_BODY}${CHIH_BODY}</p></div>
    </article>
  </body></html>`;
}

describe('host-scoped Diario de Chihuahua article-body', () => {
  it('BEFORE: wrapping <article> mixes ads; AFTER: .article-body is the body', () => {
    const r = extractFromHtml(
      htmlChihuahua(),
      'https://eldiariodechihuahua.mx/economia/2026/sep/28/mexico-exporta-mas-842130.html',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('Las exportaciones mexicanas aumentaron');
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/Publicidad Publicidad Publicidad Publicidad/);
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.metodo_texto).toBe('html_container');
  });

  it('control: same HTML on another host does not use Chihuahua preferSelectors', () => {
    const r = extractFromHtml(htmlChihuahua(), 'https://www.eluniversal.com.mx/nota.html');
    expect(r.metodo_texto).toBe('html_article');
  });
});

const CONTRA_BODY =
  'La presidenta Claudia Sheinbaum Pardo alertó a la población de Sonora ante la llegada del huracán Polo, que se prevé toque tierra entre las 8:00 y 9:00 horas de este lunes, probablemente como categoría 1, en las inmediaciones de Guaymas. ';

function htmlContra(): string {
  return `<html><body>
    <p>Nación martes 29 de septiembre de 2026 - © Copyright 2026 ContraReplica.mx © | Ediciones S</p>
    <div class="inicionota topContent">
      <div class="row">
        <div class="col-sm-9 contrareplica-9">
          <ins class="adsbygoogle"></ins>
          <h1>Sheinbaum alerta a población de Sonora</h1>
          ${CONTRA_BODY}${CONTRA_BODY}${CONTRA_BODY}
        </div>
      </div>
    </div>
  </body></html>`;
}

describe('host-scoped ContraRéplica inicionota plain text', () => {
  it('BEFORE: only copyright <p> tags; AFTER: inicionota body without ads', () => {
    const r = extractFromHtml(
      htmlContra(),
      'https://www.contrareplica.mx/nota-Sheinbaum-alerta-huracan-Polo-202629947',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('Claudia Sheinbaum Pardo alertó');
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/Copyright 2026 ContraReplica/);
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
  });

  it('control: same HTML on another host stays on copyright paragraphs', () => {
    const r = extractFromHtml(htmlContra(), 'https://www.eluniversal.com.mx/nota.html');
    const t = r.texto_cuerpo_nota ?? r.texto_nota_limpia ?? '';
    expect(t).toMatch(/Copyright 2026 ContraReplica/);
  });
});

const XATAKA_BODY =
  'México está listo para uno de los cambios laborales más importantes en más de un siglo. La reducción de la jornada de 48 a 40 horas semanales comenzará de forma gradual en 2027 y se aplicará por sectores según el acuerdo publicado. ';
const XATAKA_BIO =
  'Valeria Romero Guevara es periodista y creadora de contenido especializada en tecnología, negocios y cultura digital. Egresada de la UNAM, con más de seis años de experiencia analizando cómo los avances tecnológicos impactan la vida cotidiana, desde la inteligencia artificial hasta los pagos móviles. ';

function htmlXataka(): string {
  return `<html><body>
    <article>
      <div class="p-a-card js-author-info"><p>${XATAKA_BIO}${XATAKA_BIO}</p></div>
      <div class="article-content"><p>${XATAKA_BODY}${XATAKA_BODY}</p></div>
    </article>
  </body></html>`;
}

describe('host-scoped Xataka article-content (no author-bio clone)', () => {
  it('BEFORE: wrapping article starts with author bio; AFTER: .article-content is the body', () => {
    const r = extractFromHtml(
      htmlXataka(),
      'https://www.xataka.com.mx/empresas-y-economia/jornada-laboral-40-horas-traera-dos-dias-descanso',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('México está listo para uno de los cambios laborales');
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/Valeria Romero Guevara es periodista/i);
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.metodo_texto).toBe('html_container');
  });

  it('control: same HTML on another host keeps the author bio prefix', () => {
    const r = extractFromHtml(htmlXataka(), 'https://www.eluniversal.com.mx/nota.html');
    expect(r.texto_cuerpo_nota ?? r.texto_nota_limpia ?? '').toMatch(/Valeria Romero Guevara es periodista/i);
  });
});
