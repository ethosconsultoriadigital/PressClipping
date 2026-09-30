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

const ROMPE_SHOW =
  'Por www.rompeviento.tv y Rompeviento TV en YouTube. Una colaboración con el Movimiento de Los Pueblos Por La Paz y La Justicia, Global Exchange y RompevientoTV analiza el escenario jurídico internacional de la cumbre. ';
const ROMPE_ARTICULO =
  'Aquí la disputa por el sentido adquiere una dimensión material. Las palabras no flotan inocentemente sobre la sociedad. Mérito, competencia, libertad y progreso se disputan el significado en la esfera pública mexicana. ';

function htmlRompevientoVideo(): string {
  return `<html><body>
    <div class="single-post-content fl-wrap">
      <div class="single-post-content_text">
        <p>17/Septiembre/26 #LaEncrucijada 16:00 hrs.</p>
        <p>– Justicia popular para Donald Trump</p>
        <p>${ROMPE_SHOW}${ROMPE_SHOW}</p>
        <p>#Encrucijada #MPPJ #CumbrePorLaPaz</p>
        <p>¡Síguenos en nuestras redes sociales!</p>
        <p>► Faceboook https://www.facebook.com/rompeviento.tv/</p>
        <p>► Instagram https://www.instagram.com/rompevientotv/</p>
      </div>
    </div>
    <p>Tu dirección de correo electrónico no será publicada. Los campos obligatorios están marcados con *</p>
  </body></html>`;
}

function htmlRompevientoArticulo(): string {
  return `<html><body>
    <div class="single-post-content fl-wrap">
      <div class="single-post-content_text">
        <p>${ROMPE_ARTICULO}${ROMPE_ARTICULO}</p>
        <p>${ROMPE_ARTICULO}${ROMPE_ARTICULO}</p>
      </div>
    </div>
    <p>¡Síguenos en nuestras redes sociales!</p>
    <p>► Faceboook https://www.facebook.com/rompeviento.tv/</p>
  </body></html>`;
}

describe('host-scoped Rompeviento TV social CTA strip', () => {
  it('AFTER: article body kept, social CTA removed', () => {
    const r = extractFromHtml(
      htmlRompevientoArticulo(),
      'https://www.rompeviento.tv/mexico-independencia-inconclusa/',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('Aquí la disputa por el sentido');
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/síguenos en nuestras redes sociales/i);
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
  });

  it('AFTER: video show page is not the social-follow boilerplate', () => {
    const r = extractFromHtml(
      htmlRompevientoVideo(),
      'https://www.rompeviento.tv/justicia-popular-para-donald-trump-la-encrucijada-2026/',
    );
    const t = `${r.texto_cuerpo_nota ?? ''} ${r.texto_nota_limpia ?? ''}`;
    expect(t).not.toMatch(/síguenos en nuestras redes sociales/i);
    expect(t).not.toMatch(/facebook\.com\/rompeviento/i);
    expect(r.texto_nota_limpia ?? '').toMatch(/colaboración con el Movimiento/i);
  });

  it('control: same HTML on another host keeps the social CTA in paragraphs', () => {
    const r = extractFromHtml(htmlRompevientoArticulo(), 'https://www.eluniversal.com.mx/nota.html');
    expect(r.texto_cuerpo_nota ?? r.texto_nota_limpia ?? '').toMatch(/síguenos en nuestras redes sociales/i);
  });
});

const YAQUI_BODY =
  'De acuerdo con los avances presentados por el titular de Conagua, Efraín Morales López, también se contempla infraestructura hídrica para Cananea y las comunidades del Plan de Justicia. ';

function htmlYaqui(): string {
  return `<html><body>
    <article class="post">
      <div class="post_content">
        <div class="w-full max-w-3xl mx-auto font-asap my-8 select-none">
          <p>Resumen y análisis automáticos realizados con Inteligencia Artificial</p>
          <p>Este resumen y su análisis fueron generados con apoyo de Inteligencia Artificial.</p>
        </div>
        <p>${YAQUI_BODY}${YAQUI_BODY}</p>
        <p>${YAQUI_BODY}${YAQUI_BODY}</p>
      </div>
    </article>
  </body></html>`;
}

describe('host-scoped Diario del Yaqui post_content', () => {
  it('AFTER: .post_content is the body and SACS IA widget is stripped', () => {
    const r = extractFromHtml(
      htmlYaqui(),
      'https://diariodelyaqui.mx/nacional/conagua-destaca-avances/144724',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('titular de Conagua');
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/Resumen y análisis automáticos/i);
    expect(r.texto_cuerpo_nota ?? '').not.toMatch(/SACS IA/i);
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.metodo_texto).toBe('html_container');
  });

  it('control: same HTML on another host does not use Yaqui preferSelectors', () => {
    const r = extractFromHtml(htmlYaqui(), 'https://www.eluniversal.com.mx/nota.html');
    expect(r.metodo_texto).toBe('html_article');
  });
});

const VANGUARDIA_BODY =
  'Apple publicó nuevas actualizaciones de seguridad para sus dispositivos después de identificar una vulnerabilidad que podría permitir ejecutar código malicioso en iPhone y Mac. ';

function htmlVanguardia(): string {
  return `<html><body>
    <article class="td-post-template-7"></article>
    <div class="td-ss-main-content">
      <div class="td-post-content">
        <p>${VANGUARDIA_BODY}${VANGUARDIA_BODY}</p>
        <p>${VANGUARDIA_BODY}${VANGUARDIA_BODY}</p>
      </div>
    </div>
  </body></html>`;
}

describe('host-scoped Periodico Vanguardia td-post-content', () => {
  it('AFTER: TagDiv empty article wrapper does not hide .td-post-content', () => {
    const r = extractFromHtml(
      htmlVanguardia(),
      'https://periodicovanguardia.mx/2026/09/30/apple-corrige-una-vulnerabilidad/',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('actualizaciones de seguridad');
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.metodo_texto).toBe('html_container');
  });
});

const BRAVO_BODY =
  'Líderes del campo de Matamoros se comprometieron a impulsar la producción agropecuaria en Tamaulipas durante una reunión con autoridades municipales y estatales. ';

function htmlBravo(): string {
  return `<html><body>
    <article></article>
    <div class="the-content">
      <p>${BRAVO_BODY}${BRAVO_BODY}</p>
      <p>${BRAVO_BODY}${BRAVO_BODY}</p>
    </div>
  </body></html>`;
}

describe('host-scoped El Bravo .the-content', () => {
  it('AFTER: empty article does not hide .the-content', () => {
    const r = extractFromHtml(
      htmlBravo(),
      'https://www.elbravo.mx/lideres-de-campo-se-comprometen/',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('producción agropecuaria');
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.metodo_texto).toBe('html_container');
  });
});

const DIARIO_BODY =
  'El Congreso de Tamaulipas aprobó la reforma de nacionalidad única para gobernantes electos en el estado. La medida entra en vigor tras su publicación. ';

function htmlDiarioVictoria(): string {
  return `<html><body>
    <article class="brxe-container"><h1>Título</h1></article>
    <div class="brxe-post-content">
      <p>${DIARIO_BODY}${DIARIO_BODY}</p>
      <p>${DIARIO_BODY}${DIARIO_BODY}</p>
    </div>
  </body></html>`;
}

describe('host-scoped El Diario de Victoria brxe-post-content', () => {
  it('AFTER: Bricks empty article does not hide .brxe-post-content', () => {
    const r = extractFromHtml(
      htmlDiarioVictoria(),
      'https://eldiariomx.com/2026/09/30/tamaulipas-aprueba-nacionalidad-unica/',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('nacionalidad única');
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.metodo_texto).toBe('html_container');
  });
});

describe('host-scoped Primera Plana Michoacán td-post-content', () => {
  it('AFTER: TagDiv empty article wrapper does not hide .td-post-content', () => {
    const r = extractFromHtml(
      htmlVanguardia(),
      'https://primeraplana.mx/archivos/1157740',
    );
    expect(r.texto_cuerpo_nota ?? '').toContain('actualizaciones de seguridad');
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.metodo_texto).toBe('html_container');
  });
});
