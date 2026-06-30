/**
 * Cron sombra NACIONAL limitado (Tier B) — no producción.
 *
 * A diferencia del shadow scheduler base (que aísla solo el crawl y luego corre
 * enrich/detect sobre el backlog GLOBAL), este script aísla TODO el pipeline por
 * `medio_id` para los medios del tier nacional:
 *
 *   crawl dirigido  →  prefiltro título (solo medios con prefiltro_titulo)  →
 *   enrich aislado  →  detect dry-run aislado (gate)  →  detect real aislado  →
 *   live-comparison 48h (import XML + compare + append 07).
 *
 * Fuerza modo sombra por código y bloquea flags de producción (export-results,
 * alertas, generate-xml, classify-ia, export-raw-news). NO toca 01/02/04. El
 * prefiltro NO borra noticias: marca como procesadas (flag reversible) las notas
 * claramente irrelevantes (deportes/espectáculos) para que enrich/detect las salten,
 * conservando SIEMPRE las de alto valor (laboral/crisis/marcas).
 *
 * Uso:
 *   npm run shadow-national-tier -- --tier=B --window-hours=48 --output=sheet \
 *     --append-metrics-history --no-alerts --no-export-results --no-generate-xml
 *   npm run shadow-national-tier -- --tier=B --dry-run
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import { verificarFlagsSombra } from '../src/utils/shadowGuard.js';
import { ventanaMovil } from '../src/utils/dateWindow.js';
import { mediosNacionalesActivos, type ShadowMedioNacional } from '../src/config/shadowMedia.js';
import { getSupabase } from '../src/supabase/client.js';
import { decidirPrefiltro } from '../src/shadow/nationalPrefilter.js';

const DEFAULT_XML_URL = 'https://tabla.ethosconsultoriadigital.workers.dev/read-xml';

interface TierArgs {
  tier: 'B';
  xmlUrl: string;
  windowHours: number;
  crawlLimit: number;
  enrichLimit: number;
  detectLimit: number;
  output: 'console' | 'sheet';
  appendMetricsHistory: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): TierArgs {
  const out: TierArgs = {
    tier: 'B',
    xmlUrl: DEFAULT_XML_URL,
    windowHours: 48,
    crawlLimit: 50,
    enrichLimit: 250,
    detectLimit: 250,
    output: 'sheet',
    appendMetricsHistory: false,
    dryRun: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'tier': out.tier = (val === 'B' ? 'B' : 'B'); break; // hoy solo B
      case 'xml-url': out.xmlUrl = val || out.xmlUrl; break;
      case 'window-hours': out.windowHours = Number(val) || out.windowHours; break;
      case 'crawl-limit': out.crawlLimit = Number(val) || out.crawlLimit; break;
      case 'enrich-limit': out.enrichLimit = Number(val) || out.enrichLimit; break;
      case 'detect-limit': out.detectLimit = Number(val) || out.detectLimit; break;
      case 'output': out.output = (val as 'console' | 'sheet') || out.output; break;
      case 'append-metrics-history': out.appendMetricsHistory = true; break;
      case 'dry-run': out.dryRun = true; break;
      // Confirmaciones de seguridad (no habilitan nada):
      case 'no-alerts': case 'no-export-results': case 'no-generate-xml':
      case 'no-classify-ia': case 'no-export-raw-news': case 'no-whatsapp': case 'no-correos':
        break;
    }
  }
  return out;
}

interface StepResult { code: number; jsonLines: Record<string, unknown>[]; }

/** Ejecuta un script tsx como subproceso, tee de salida y captura de logs JSON. */
function runStep(label: string, script: string, args: string[]): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    logger.info({ label, cmd: `npx tsx ${script} ${args.join(' ')}` }, `▶ ${label}`);
    const child = spawn(bin, ['tsx', script, ...args], {
      env: { ...process.env, LOG_FORMAT: process.env['LOG_FORMAT'] ?? 'json' },
      shell: process.platform === 'win32',
    });
    const jsonLines: Record<string, unknown>[] = [];
    let buf = '';
    const handle = (chunk: Buffer, isErr: boolean) => {
      const text = chunk.toString();
      if (isErr) process.stderr.write(text); else process.stdout.write(text);
      buf += text;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('{')) { try { jsonLines.push(JSON.parse(line)); } catch { /* no-op */ } }
      }
    };
    child.stdout.on('data', (c) => handle(c, false));
    child.stderr.on('data', (c) => handle(c, true));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, jsonLines }));
  });
}

function findNum(lines: Record<string, unknown>[], field: string): number | undefined {
  for (const l of lines) if (typeof l[field] === 'number') return l[field] as number;
  return undefined;
}

/**
 * Prefiltro de título para medios con prefiltro_titulo=true. NO borra: marca
 * menciones_procesado=true (reversible) en las notas frescas (sin cuerpo, pendientes)
 * cuyo título/sección es claramente irrelevante y NO contiene señal de alto valor.
 */
async function aplicarPrefiltro(
  medios: ShadowMedioNacional[],
  desde: string,
  dryRun: boolean,
): Promise<{ aplicado: boolean; saltadas: number; procesadas: number }> {
  const conPrefiltro = medios.filter((m) => m.prefiltro_titulo).map((m) => m.medio_id);
  if (conPrefiltro.length === 0) return { aplicado: false, saltadas: 0, procesadas: 0 };

  const sb = getSupabase();
  const { data, error } = await sb
    .from('noticias')
    .select('noticia_id, titulo, seccion')
    .in('medio_id', conPrefiltro)
    .eq('menciones_procesado', false)
    .is('texto_cuerpo_nota', null)
    .gte('fecha_captura', desde);
  if (error) throw new Error(`Prefiltro: no se pudieron leer noticias frescas: ${error.message}`);

  const frescas = data ?? [];
  const aSaltar: string[] = [];
  for (const n of frescas) {
    if (decidirPrefiltro(n.titulo as string, n.seccion as string).saltar) aSaltar.push(n.noticia_id as string);
  }
  const procesadas = frescas.length - aSaltar.length;

  if (aSaltar.length > 0 && !dryRun) {
    const { error: upErr } = await sb
      .from('noticias')
      .update({ menciones_procesado: true })
      .in('noticia_id', aSaltar);
    if (upErr) throw new Error(`Prefiltro: no se pudo marcar saltadas: ${upErr.message}`);
  }

  logger.info(
    { prefiltro_aplicado: true, prefiltro_medios: conPrefiltro, prefiltro_frescas: frescas.length,
      prefiltro_saltadas: aSaltar.length, prefiltro_procesadas: procesadas, dryRun },
    'Prefiltro nacional aplicado',
  );
  return { aplicado: true, saltadas: aSaltar.length, procesadas };
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  // Guarda dura: ningún flag puede habilitar producción.
  const guarda = verificarFlagsSombra(rawArgv);
  if (!guarda.ok) {
    logger.error({ violacion: guarda.violacion }, guarda.mensaje ?? 'Flag prohibido en modo sombra.');
    process.exit(2);
  }

  const args = parseArgs(rawArgv);
  const medios = mediosNacionalesActivos(args.tier);
  if (medios.length === 0) { logger.error({ tier: args.tier }, 'Tier sin medios activos.'); process.exit(2); }
  const medioIds = medios.map((m) => m.medio_id).join(',');
  const { desde, hasta } = ventanaMovil(args.windowHours);

  logger.info(
    { modo: 'shadow_national', tier: args.tier, medios: medios.map((m) => `${m.medio_id}:${m.nombre}`),
      medioIds, windowHours: args.windowHours, fechaDesde: desde, fechaHasta: hasta, dryRun: args.dryRun },
    '=== Iniciando SHADOW NATIONAL TIER (no producción) ===',
  );

  if (!args.dryRun) {
    // 1. Crawl dirigido SOLO por medio_id del tier.
    const crawl = await runStep('1. crawl dirigido (tier)', 'scripts/crawl.ts',
      [`--medio-ids=${medioIds}`, `--limit=${medios.length}`, '--exclude-status=duplicado']);
    if (crawl.code !== 0) logger.warn({ code: crawl.code }, 'Crawl tier terminó con código no-cero (continuamos).');

    // 2. Prefiltro de título (no borra; marca procesadas las irrelevantes frescas).
    await aplicarPrefiltro(medios, desde, false);

    // 3. Enrich AISLADO por medio (no toca backlog global).
    await runStep('3. enrich aislado', 'scripts/enrich-news.ts',
      [`--medio-ids=${medioIds}`, `--limit=${args.enrichLimit}`, '--only-pending-mentions', '--only-missing-clean-text']);

    // 4. Detect dry-run AISLADO (gate de seguridad).
    const dry = await runStep('4. detect dry-run aislado', 'scripts/detect-mentions.ts',
      [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text', '--dry-run']);
    const sinTexto = findNum(dry.jsonLines, 'sinTexto');
    const potenciales = findNum(dry.jsonLines, 'menciones_potenciales') ?? 0;
    const limpio = dry.code === 0 && (sinTexto === undefined || sinTexto === 0);
    logger.info({ sinTexto, potenciales, limpio }, 'Resultado del gate detect dry-run');

    // 5. Detect real AISLADO (solo si el dry-run está limpio).
    if (limpio) {
      const real = await runStep('5. detect real aislado', 'scripts/detect-mentions.ts',
        [`--medio-ids=${medioIds}`, `--limit=${args.detectLimit}`, '--only-with-text']);
      logger.info({ menciones: findNum(real.jsonLines, 'menciones') ?? 0 }, 'Detect real aislado completado');
    } else {
      logger.warn({ sinTexto }, 'Dry-run NO limpio: se OMITE detect real (no se insertan menciones).');
    }
  } else {
    // En dry-run reportamos el prefiltro sin escribir nada.
    await aplicarPrefiltro(medios, desde, true);
    logger.info({}, 'Modo --dry-run: se omiten crawl/enrich/detect real.');
  }

  // 6. Comparativo 48h vía run-live-comparison SIN crawl (solo import XML + compare + 07).
  //    El crawl/enrich/detect ya se hicieron AISLADOS arriba; aquí no se pasa
  //    --crawl-medio-ids para no reprocesar backlog global.
  const liveArgs = [
    '--shadow', '--no-export-results',
    `--xml-url=${args.xmlUrl}`,
    `--fecha-desde=${desde}`, `--fecha-hasta=${hasta}`,
    `--window-hours=${args.windowHours}`, `--medios-curados=${medios.length}`,
    `--output=${args.output}`, '--replace-window',
  ];
  if (args.appendMetricsHistory) liveArgs.push('--append-metrics-history');
  if (args.dryRun) liveArgs.push('--dry-run');

  const comp = await runStep('6. live-comparison (import + compare + 07)', 'scripts/run-live-comparison.ts', liveArgs);
  if (comp.code !== 0) { logger.error({ code: comp.code }, 'live-comparison terminó con error.'); process.exit(comp.code); }

  logger.info({ modo: 'shadow_national', tier: args.tier }, '=== Shadow national tier completado ===');
}

export { main, aplicarPrefiltro };

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en run-shadow-national-tier');
    process.exit(1);
  });
}
