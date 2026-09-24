import { describe, it, expect } from 'vitest';
import {
  cutoffFromAnchor,
  laneForCreatedAt,
  planMentionQueue,
  validateMentionQueueParams,
  MentionQueueError,
  type MentionQueueRow,
} from '../src/matching/mentionQueue.js';

function rows(prefix: string, n: number, createdAt = '2026-09-24T00:00:00.000Z'): MentionQueueRow[] {
  return Array.from({ length: n }, (_, i) => ({
    noticia_id: `${prefix}-${String(i + 1).padStart(4, '0')}`,
    created_at: createdAt,
  }));
}

describe('validateMentionQueueParams', () => {
  it('acepta defaults 500 / 48 / 0.70', () => {
    expect(() =>
      validateMentionQueueParams({ limit: 500, freshHours: 48, freshShare: 0.7 }),
    ).not.toThrow();
  });

  it('rechaza limit <= 0 sin clamp', () => {
    expect(() =>
      validateMentionQueueParams({ limit: 0, freshHours: 48, freshShare: 0.7 }),
    ).toThrow(MentionQueueError);
    expect(() =>
      validateMentionQueueParams({ limit: -1, freshHours: 48, freshShare: 0.7 }),
    ).toThrow(MentionQueueError);
  });

  it('rechaza freshHours <= 0 sin clamp', () => {
    expect(() =>
      validateMentionQueueParams({ limit: 500, freshHours: 0, freshShare: 0.7 }),
    ).toThrow(MentionQueueError);
  });

  it('rechaza freshShare 0, 1 o fuera de (0,1)', () => {
    expect(() =>
      validateMentionQueueParams({ limit: 500, freshHours: 48, freshShare: 0 }),
    ).toThrow(MentionQueueError);
    expect(() =>
      validateMentionQueueParams({ limit: 500, freshHours: 48, freshShare: 1 }),
    ).toThrow(MentionQueueError);
    expect(() =>
      validateMentionQueueParams({ limit: 500, freshHours: 48, freshShare: 1.5 }),
    ).toThrow(MentionQueueError);
  });
});

describe('laneForCreatedAt — frontera cutoff', () => {
  const cutoff = '2026-09-22T12:00:00.000Z';

  it('created_at == cutoff pertenece a fresh', () => {
    expect(laneForCreatedAt(cutoff, cutoff)).toBe('fresh');
  });

  it('created_at > cutoff es fresh y < cutoff es backlog — sin overlap', () => {
    expect(laneForCreatedAt('2026-09-22T12:00:00.001Z', cutoff)).toBe('fresh');
    expect(laneForCreatedAt('2026-09-22T11:59:59.999Z', cutoff)).toBe('backlog');
  });
});

describe('cutoffFromAnchor', () => {
  it('congela cutoff a partir del anchor, no de Date.now()', () => {
    const anchor = new Date('2026-09-24T13:00:00.000Z');
    expect(cutoffFromAnchor(anchor, 48).toISOString()).toBe('2026-09-22T13:00:00.000Z');
  });
});

describe('planMentionQueue — fairness', () => {
  it('limit=500 share=.70 con pools suficientes → 350 fresh + 150 backlog', () => {
    const plan = planMentionQueue({
      fresh: rows('F', 400),
      backlog: rows('B', 400),
      limit: 500,
      freshShare: 0.7,
    });
    expect(plan.fresh_target).toBe(350);
    expect(plan.backlog_target).toBe(150);
    expect(plan.fresh_selected).toBe(350);
    expect(plan.backlog_selected).toBe(150);
    expect(plan.selected).toHaveLength(500);
    expect(plan.unused_slots).toBe(0);
    expect(plan.duplicate_filtered).toBe(0);
  });

  it('shortage fresh=100 backlog=1000 → 100 fresh + 400 backlog', () => {
    const plan = planMentionQueue({
      fresh: rows('F', 100),
      backlog: rows('B', 1000),
      limit: 500,
      freshShare: 0.7,
    });
    expect(plan.fresh_selected).toBe(100);
    expect(plan.backlog_selected).toBe(400);
    expect(plan.selected).toHaveLength(500);
  });

  it('shortage inversa fresh=1000 backlog=50 → 450 fresh + 50 backlog', () => {
    const plan = planMentionQueue({
      fresh: rows('F', 1000),
      backlog: rows('B', 50),
      limit: 500,
      freshShare: 0.7,
    });
    expect(plan.fresh_selected).toBe(450);
    expect(plan.backlog_selected).toBe(50);
    expect(plan.selected).toHaveLength(500);
  });

  it('fresh=0 backlog=500 → 500 backlog', () => {
    const plan = planMentionQueue({
      fresh: [],
      backlog: rows('B', 500),
      limit: 500,
      freshShare: 0.7,
    });
    expect(plan.fresh_selected).toBe(0);
    expect(plan.backlog_selected).toBe(500);
    expect(plan.selected).toHaveLength(500);
  });

  it('backlog=0 fresh=500 → 500 fresh', () => {
    const plan = planMentionQueue({
      fresh: rows('F', 500),
      backlog: [],
      limit: 500,
      freshShare: 0.7,
    });
    expect(plan.fresh_selected).toBe(500);
    expect(plan.backlog_selected).toBe(0);
    expect(plan.selected).toHaveLength(500);
  });
});

describe('planMentionQueue — no duplicates', () => {
  it('un id presente en ambos pools aparece una sola vez; duplicate_filtered cuenta', () => {
    const shared: MentionQueueRow = { noticia_id: 'N-DUP', created_at: '2026-09-22T12:00:00.000Z' };
    const plan = planMentionQueue({
      fresh: [shared, ...rows('F', 3)],
      backlog: [shared, ...rows('B', 3)],
      limit: 10,
      freshShare: 0.7,
    });
    const ids = plan.selected.map((r) => r.noticia_id);
    expect(ids.filter((id) => id === 'N-DUP')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.duplicate_filtered).toBe(1);
  });

  it('duplicado accidental dentro del pool fresh se filtra', () => {
    const a: MentionQueueRow = { noticia_id: 'F-0001', created_at: '2026-09-24T00:00:00.000Z' };
    const plan = planMentionQueue({
      fresh: [a, a, { noticia_id: 'F-0002', created_at: '2026-09-24T00:00:00.000Z' }],
      backlog: rows('B', 5),
      limit: 10,
      freshShare: 0.7,
    });
    expect(plan.selected.filter((r) => r.noticia_id === 'F-0001')).toHaveLength(1);
    expect(plan.duplicate_filtered).toBe(1);
  });
});

describe('planMentionQueue — selected <= limit', () => {
  it('nunca excede el limit aunque los pools sean enormes', () => {
    const plan = planMentionQueue({
      fresh: rows('F', 2000),
      backlog: rows('B', 2000),
      limit: 500,
      freshShare: 0.7,
    });
    expect(plan.selected.length).toBeLessThanOrEqual(500);
  });
});
