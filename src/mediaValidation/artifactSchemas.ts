/**
 * Artifact Schemas — Media Validation & Certification, FASE 1C HARDENING
 * FINAL (blocker B3C — "SIN VALIDACIÓN RUNTIME DE ARTIFACTS JSON").
 *
 * Problema corregido: `scripts/media-validation-compose.ts` hacía
 * `JSON.parse(readFileSync(...)) as SnapshotResult` — un simple cast de
 * TypeScript que NO valida nada en runtime. Un artifact corrupto, truncado,
 * de otra versión de schema, o con roles intercambiados pasaría intacto
 * hasta `computeMediaDelta`/`derivePersistenceEvidence`, produciendo
 * DELTA/PERSISTENCE fabricados a partir de datos inválidos.
 *
 * Corrección: se valida CADA artifact JSON que cruza el filesystem
 * (`SnapshotResult`) con un schema `zod` explícito (dependencia ya presente
 * en el repo, usada en `src/types/schemas.ts` — no se agrega ninguna
 * dependencia nueva) ANTES de construirlo como tipo TypeScript. Un artifact
 * inválido nunca llega a `computeMediaDelta`/`derivePersistenceEvidence`
 * (§18 del prompt de hardening): `validateSnapshotArtifact` lanza con un
 * mensaje legible, listando cada violación.
 *
 * Alcance deliberadamente mínimo (§15 del prompt): solo se valida lo que
 * efectivamente cruza el filesystem como INPUT no confiable —
 * `SnapshotResult`. `RunValidationEvidence` es el artifact de SALIDA de
 * `media-validation-compose.ts`; nada en esta fase lo vuelve a leer como
 * input, así que no necesita un validador runtime propio (solo lleva
 * `schema_version` como metadata para una fase futura que sí lo consuma).
 */
import { z } from 'zod';
import { isValidIsoTimestamp } from './temporalWindow.js';
import { NEWS_LAKE_SNAPSHOT_SCHEMA_VERSION, type SnapshotResult } from './newsLakeSnapshot.js';

const isoTimestamp = z.string().refine(isValidIsoTimestamp, { message: 'timestamp ISO inválido' });

const nonEmptyTrimmed = z.string().refine((s) => s.trim().length > 0, { message: 'no puede estar vacío/blanco' });

const nonNegativeInt = z.number().int().nonnegative();

const mediaSnapshotSchema = z
  .object({
    medio_id: nonEmptyTrimmed,
    status: z.enum(['COMPLETE', 'PARTIAL', 'ERROR', 'UNKNOWN']),
    total_news: nonNegativeInt.nullable(),
    clean_text_count: nonNegativeInt.nullable(),
    body_count: nonNegativeInt.nullable(),
    pages_read: nonNegativeInt,
    duplicate_rows_skipped: nonNegativeInt,
    errors: z.array(z.string()),
    consistency: z.enum(['STABLE_OBSERVED', 'POSSIBLE_DRIFT', 'UNKNOWN']),
  })
  .superRefine((m, ctx) => {
    if (m.status === 'COMPLETE') {
      // Invariante REAL garantizada por `newsLakeSnapshot.ts`: COMPLETE implica
      // los tres contadores numéricos, NUNCA null (§16/§18 del prompt).
      if (m.total_news === null || m.clean_text_count === null || m.body_count === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `medio_id=${m.medio_id}: status='COMPLETE' exige total_news/clean_text_count/body_count no-null`,
        });
        return;
      }
      // Relaciones REALMENTE garantizadas por la implementación (§17): los
      // conteos de clean_text/body son subconjuntos de las noticias leídas.
      if (m.clean_text_count > m.total_news) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `medio_id=${m.medio_id}: clean_text_count (${m.clean_text_count}) > total_news (${m.total_news})`,
        });
      }
      if (m.body_count > m.total_news) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `medio_id=${m.medio_id}: body_count (${m.body_count}) > total_news (${m.total_news})`,
        });
      }
    } else {
      // Invariante REAL: status != COMPLETE => contadores en null (nunca se
      // presenta un conteo parcial/acumulado-hasta-el-fallo como total).
      if (m.total_news !== null || m.clean_text_count !== null || m.body_count !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `medio_id=${m.medio_id}: status='${m.status}' exige total_news/clean_text_count/body_count === null`,
        });
      }
    }
  });

export const snapshotResultSchema = z
  .object({
    schema_version: z.literal(NEWS_LAKE_SNAPSHOT_SCHEMA_VERSION),
    context_id: nonEmptyTrimmed,
    snapshot_role: z.enum(['BEFORE', 'AFTER']),
    window_anchor: isoTimestamp.nullable(),
    window_days: z.number().int().nullable(),
    capture_started_at: isoTimestamp,
    capture_completed_at: isoTimestamp,
    requested_media_ids: z.array(nonEmptyTrimmed),
    media: z.array(mediaSnapshotSchema),
  })
  .superRefine((snap, ctx) => {
    if (snap.window_days !== null && snap.window_anchor === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'window_days activo pero window_anchor es null — identidad temporal incompleta (B1C).',
      });
    }
    if (new Date(snap.capture_started_at).getTime() > new Date(snap.capture_completed_at).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `capture_started_at (${snap.capture_started_at}) es posterior a capture_completed_at (${snap.capture_completed_at})`,
      });
    }
  });

/**
 * Valida `json` (típicamente el resultado de `JSON.parse` de un archivo)
 * contra `snapshotResultSchema`. Lanza `Error` con TODAS las violaciones
 * concatenadas si algo no cumple el contrato — nunca deja pasar un artifact
 * corrupto/de otra versión hacia `computeMediaDelta`/`derivePersistenceEvidence`.
 */
export function validateSnapshotArtifact(json: unknown): SnapshotResult {
  const result = snapshotResultSchema.safeParse(json);
  if (!result.success) {
    const detalle = result.error.issues.map((i) => `- [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n');
    throw new Error(`Artifact SnapshotResult inválido (Fase 1C, B3C):\n${detalle}`);
  }
  return result.data as SnapshotResult;
}
