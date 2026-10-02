/**
 * Writers serialized against the same MASTER sheet: reload keys between jobs.
 * Fast Lane / 24h / 72h must not append in parallel.
 */
export function applySerializedMasterAppend(
  existing: Set<string>,
  detectedKeys: string[],
): { appended: string[]; skipped: string[] } {
  const appended: string[] = [];
  const skipped: string[] = [];
  for (const key of detectedKeys) {
    const k = key.trim().toLowerCase();
    if (!k || existing.has(k)) {
      if (k) skipped.push(k);
      continue;
    }
    existing.add(k);
    appended.push(k);
  }
  return { appended, skipped };
}
