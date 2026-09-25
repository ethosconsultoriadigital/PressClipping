/**
 * Arma los dos pasos de enrich-news ya existentes.
 * No reimplementa el extractor. dryRun añade --dry-run a ambos.
 */

export const DEFAULT_PRIORITY_MENTION_MEDIA_IDS = ['MED-0017'];

export function parsePriorityMediaIds(raw: string | null | undefined): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : [...DEFAULT_PRIORITY_MENTION_MEDIA_IDS];
}

export interface RecoveryPassInput {
  mediaIds: string[];
  dryRun: boolean;
  limit?: number;
  windowDays?: number;
}

export function argsRecoveryClean(input: RecoveryPassInput): string[] {
  return argsRecovery(input, 'only-missing-clean-text');
}

export function argsRecoveryBody(input: RecoveryPassInput): string[] {
  return argsRecovery(input, 'only-missing-body-text');
}

function argsRecovery(input: RecoveryPassInput, filtro: 'only-missing-clean-text' | 'only-missing-body-text'): string[] {
  const args = [
    `--medio-ids=${input.mediaIds.join(',')}`,
    `--window-days=${input.windowDays ?? 2}`,
    '--recent-first',
    '--only-pending-mentions',
    `--${filtro}`,
    `--limit=${input.limit ?? 50}`,
  ];
  if (input.dryRun) args.push('--dry-run');
  return args;
}
