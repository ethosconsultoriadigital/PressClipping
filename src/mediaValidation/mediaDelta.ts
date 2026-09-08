/**
 * Media Delta — Media Validation & Certification, FASE 1C.
 *
 * Función pura que compara dos `MediaSnapshot` (before/after) del mismo
 * medio_id y calcula el delta observado. NUNCA infiere, NUNCA fabrica un
 * número cuando el snapshot de origen no es confiable (§18 del prompt de
 * Fase 1C: "Si before o after: ERROR/PARTIAL/UNKNOWN → NO fabriques un
 * delta numérico"). Los deltas pueden ser NEGATIVOS y nunca se corrigen a
 * cero (§17 del prompt): un delta negativo puede ser evidencia importante
 * (p.ej. limpieza/borrado externo), no un bug de este módulo.
 */
import type { MediaSnapshot, SnapshotResult } from './newsLakeSnapshot.js';

export type DeltaStatus = 'COMPUTED' | 'UNAVAILABLE';

export interface MediaDelta {
  medio_id: string;
  status: DeltaStatus;
  /** `null` cuando `status === 'UNAVAILABLE'`. Puede ser negativo cuando `status === 'COMPUTED'`. */
  news_delta: number | null;
  clean_text_delta: number | null;
  body_delta: number | null;
  /** Motivo por el que no se pudo calcular, o `null` cuando `status === 'COMPUTED'`. */
  reason: string | null;
}

/**
 * Compara dos snapshots del MISMO medio_id. Lanza si `medio_id` no coincide
 * (error de programación del llamador — nunca debe alcanzar este punto sin
 * que ambos snapshots ya se hayan emparejado por medio_id; ver
 * `computeAllMediaDeltas`, que hace ese emparejamiento de forma segura).
 */
export function computeMediaDelta(before: MediaSnapshot, after: MediaSnapshot): MediaDelta {
  if (before.medio_id !== after.medio_id) {
    throw new Error(
      `computeMediaDelta: medio_id no coincide entre before (${before.medio_id}) y after (${after.medio_id})`,
    );
  }

  if (before.status !== 'COMPLETE' || after.status !== 'COMPLETE') {
    return {
      medio_id: before.medio_id,
      status: 'UNAVAILABLE',
      news_delta: null,
      clean_text_delta: null,
      body_delta: null,
      reason:
        `no se fabrica delta a partir de snapshot no-COMPLETE (before.status=${before.status}, ` +
        `after.status=${after.status}) — ZERO/PARTIAL/ERROR nunca se tratan como 0 (§18 del prompt de Fase 1C).`,
    };
  }

  // Invariante garantizada por `MediaSnapshot`: cuando `status === 'COMPLETE'`
  // los tres contadores son `number` (nunca `null`) — ver `newsLakeSnapshot.ts`.
  return {
    medio_id: before.medio_id,
    status: 'COMPUTED',
    news_delta: (after.total_news as number) - (before.total_news as number),
    clean_text_delta: (after.clean_text_count as number) - (before.clean_text_count as number),
    body_delta: (after.body_count as number) - (before.body_count as number),
    reason: null,
  };
}

/**
 * Empareja before/after por medio_id (a partir de `before.media`, en su
 * orden) y calcula el delta de cada uno. Si un medio_id de `before` no tiene
 * contraparte en `after` (defensivo — no debería ocurrir cuando ambos
 * snapshots se construyeron con el mismo `requested_media_ids`, ver
 * `runContext.ts`), se reporta `UNAVAILABLE` explícito en vez de omitirlo
 * silenciosamente o lanzar.
 */
export function computeAllMediaDeltas(before: SnapshotResult, after: SnapshotResult): MediaDelta[] {
  const afterByMedio = new Map(after.media.map((m) => [m.medio_id, m]));
  return before.media.map((b) => {
    const a = afterByMedio.get(b.medio_id);
    if (!a) {
      return {
        medio_id: b.medio_id,
        status: 'UNAVAILABLE',
        news_delta: null,
        clean_text_delta: null,
        body_delta: null,
        reason: `no se observó snapshot "after" para medio_id=${b.medio_id} (before/after con universos distintos).`,
      };
    }
    return computeMediaDelta(b, a);
  });
}
