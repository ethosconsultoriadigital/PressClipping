import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoutesCsv, type MentionRoute } from './mentionPresentation.js';

export function loadMentionRoutesV1(): MentionRoute[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return parseRoutesCsv(readFileSync(join(here, 'mention-routes-v1.csv'), 'utf8'));
}
