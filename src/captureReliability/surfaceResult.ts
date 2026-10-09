export const SURFACE_ATTEMPT_RESULTS = [
  'SUCCESS',
  'FAILED',
  'UNAVAILABLE',
  'PARTIAL',
  'EXHAUSTED',
] as const;
export type SurfaceAttemptResult = (typeof SURFACE_ATTEMPT_RESULTS)[number];

export function canResolveFromSurface(result: SurfaceAttemptResult | null | undefined): boolean {
  return result === 'SUCCESS' || result === 'EXHAUSTED';
}

export function followUpForProbedSurface(surface: string | null): 'PAGINATE_FROM_CURSOR' | 'SECOND_SURFACE' | 'SURFACE_PROBE' {
  if (surface === 'sitemap') return 'PAGINATE_FROM_CURSOR';
  if (surface === 'listing' || surface === 'home' || surface === 'section') return 'SECOND_SURFACE';
  return 'SURFACE_PROBE';
}
