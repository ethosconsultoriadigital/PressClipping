import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCanaryHashesForWrite,
  recoveryWritesAllowed,
} from '../src/captureReliability/writesGuard.js';

const ROOT = join(import.meta.dirname, '..');

const DORMANT = [
  'capture-reliability.yml',
  'google-news-gap-radar.yml',
  'mentions-master-reconciliation-24h.yml',
  'mentions-master-deep-reconciliation.yml',
  'source-health-light.yml',
] as const;

function wf(name: string): string {
  return readFileSync(join(ROOT, '.github/workflows', name), 'utf8');
}

function triggerBlock(src: string): string {
  const on = src.indexOf('\non:');
  const start = on >= 0 ? on + 1 : src.indexOf('on:');
  const jobs = src.indexOf('\njobs:');
  const conc = src.indexOf('\nconcurrency:');
  const end = [jobs, conc].filter((i) => i > start).sort((a, b) => a - b)[0] ?? src.length;
  return src.slice(start, end);
}

function activeTriggerLines(src: string): string[] {
  return triggerBlock(src)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+#.*$/, ''))
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'));
}

describe('RC1 production release dormant gate', () => {
  it('five RC1 workflows stay dispatch-only and keep commented schedules', () => {
    for (const name of DORMANT) {
      const src = wf(name);
      const active = activeTriggerLines(src).join('\n');
      expect(src, name).toContain('TEMPORARY RC1 RELEASE GATE:');
      expect(src, name).toContain('workflow_dispatch only until controlled default-branch canary');
      expect(active, name).toMatch(/workflow_dispatch:/);
      expect(active, name).not.toMatch(/^\s*schedule:/m);
      expect(active, name).not.toMatch(/^\s*-\s*cron:/m);
    }
    const cap = wf('capture-reliability.yml');
    expect(cap).toContain("cron: '25 * * * *'");
    expect(cap).toContain("cron: '50 11 * * *'");
    expect(wf('google-news-gap-radar.yml')).toContain("cron: '37 * * * *'");
    expect(wf('mentions-master-reconciliation-24h.yml')).toContain("cron: '07 * * * *'");
    expect(wf('mentions-master-deep-reconciliation.yml')).toContain("cron: '12 11 * * *'");
    expect(wf('source-health-light.yml')).toContain("cron: '0 12 * * *'");
  });

  it('Fast Lane keeps its current schedule and writer concurrency', () => {
    const src = wf('mentions-master-fast-lane.yml');
    const active = activeTriggerLines(src).join('\n');
    expect(active).toMatch(/schedule:/);
    expect(src).toContain("cron: '17,47 * * * *'");
    expect(src).toContain('group: ethos-mentions-master-writer');
    expect(src).toContain('cancel-in-progress: false');
    expect(src).toContain('workflow_dispatch:');
  });

  it('exact-hash canary gate stays fail-closed and dispatch-only', () => {
    const cap = wf('capture-reliability.yml');
    expect(cap).toContain('workflow_dispatch:');
    expect(cap).toContain('recovery_hashes');
    expect(cap).toContain('recovery_urls');
    expect(cap).toContain('ALLOW_CAPTURE_RECOVERY_CANARY_WRITES');
    expect(cap).toContain('medio_ids solo NO autoriza writes');
    expect(cap).toContain('Schedule ignora el secreto canario');
    expect(cap).toContain('Dispatch limitado NUNCA adelanta caprel-cursor-24h/72h');
    expect(cap).toContain("NO_SEND: 'true'");
    expect(cap).toContain("NO_EMAIL: 'true'");
    expect(cap).toContain("NO_WHATSAPP: 'true'");
    expect(cap).toContain("NO_TWILIO: 'true'");

    expect(
      recoveryWritesAllowed({
        dryRun: false,
        allowEnv: null,
        canaryAllowEnv: 'true',
        eventName: 'dispatch',
        limitedScope: true,
        recoveryHashes: [],
      }),
    ).toBe(false);
    expect(
      recoveryWritesAllowed({
        dryRun: false,
        allowEnv: null,
        canaryAllowEnv: 'true',
        eventName: 'schedule',
        limitedScope: true,
        recoveryHashes: ['abc'],
      }),
    ).toBe(false);
    expect(
      recoveryWritesAllowed({
        dryRun: false,
        allowEnv: null,
        canaryAllowEnv: 'true',
        eventName: 'dispatch',
        limitedScope: true,
        recoveryHashes: ['abc'],
      }),
    ).toBe(true);
    expect(() =>
      assertCanaryHashesForWrite({
        wantsWrites: true,
        allowEnv: null,
        canaryAllowEnv: 'true',
        recoveryHashes: [],
      }),
    ).toThrow(/CANARY_HASHES_REQUIRED/);
  });
});
