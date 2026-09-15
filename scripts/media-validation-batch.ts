/**
 * Media Validation & Certification — BVR-01 — Batch Validation Runner CLI.
 *
 * Orquesta capture/enrich/snapshot/evidence/metrics/validator ya existentes.
 * REPORT-ONLY: nunca promueve, nunca muta catálogo, nunca escribe Sheets.
 *
 * Uso:
 *   npm run media-validation:batch -- --media-ids=MED-0001,MED-0002
 *   npm run media-validation:batch -- --media-ids=MED-0001 --no-dry-run --run-id=wave-1
 *   npm run media-validation:batch -- --resume --run-id=wave-1 --media-ids=MED-0001
 *
 * Default: --dry-run (plan, 0 capture/enrich/snapshot live).
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import {
  BatchRunnerError,
  createLiveBatchAdapters,
  optionsFromCliArgs,
  parseBatchArgs,
  runBatch,
  thisRepoRoot,
} from '../src/mediaValidation/batchRunner.js';

export { parseBatchArgs };

async function main(): Promise<void> {
  const args = parseBatchArgs(process.argv.slice(2));
  const repoRoot = thisRepoRoot();
  const extras = args.dryRun
    ? { repoRoot }
    : { repoRoot, adapters: createLiveBatchAdapters(repoRoot) };

  const ac = new AbortController();
  const onStop = (): void => ac.abort();
  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);

  try {
    const outcome = await runBatch(optionsFromCliArgs(args, { ...extras, signal: ac.signal }));
    logger.info(
      {
        run_id: outcome.manifest.run_id,
        overall_status: outcome.manifest.overall_status,
        dry_run: outcome.manifest.dry_run,
        git_sha: outcome.manifest.git_sha,
        requested: outcome.summary.requested_media_count,
        pass: outcome.summary.pass_count,
        review: outcome.summary.review_count,
        fail: outcome.summary.fail_count,
        execution_failed: outcome.summary.execution_failed_count,
        promotions_applied: outcome.summary.promotions_applied,
        run_dir: outcome.runDir,
      },
      'Batch Validation Runner V1 terminado (REPORT-ONLY — ninguna promoción).',
    );
    if (outcome.manifest.overall_status === 'FAILED' || outcome.manifest.overall_status === 'ABORTED') {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof BatchRunnerError) {
      logger.error({ code: err.code, reason: err.reason, message: err.message }, 'Batch Runner abortado');
      if (err.code === 'INPUT_ERROR') process.exitCode = 2;
      else if (err.code === 'LOCK_ERROR') process.exitCode = 3;
      else process.exitCode = 1;
      return;
    }
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en media-validation-batch');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
  }
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  void main();
}

export { main };
