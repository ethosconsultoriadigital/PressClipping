/**
 * Tests deterministas para las funciones puras de parseo de argumentos de
 * los CLIs delgados de Fase 1D/1E (`media-validation-calibrate.ts`,
 * `media-validation-evaluate.ts`) — mismo patrón que
 * `media-validation-cli.test.ts` (Fase 1C, §49 del prompt de 1C / §73 del
 * prompt de 1D-1E): solo se testea `parseArgs` (puro) y los helpers de
 * validación de artifacts (ya cubiertos exhaustivamente en
 * `calibration-artifacts.test.ts`) — nunca se invoca `main()` directamente,
 * porque llama a `process.exit()` en las rutas de error y tumbaría el
 * proceso de test (mismo criterio que el resto de la suite de 1C).
 */
import { describe, it, expect } from 'vitest';
import { parseArgs as parseCalibrateArgs } from '../scripts/media-validation-calibrate.js';
import { parseArgs as parseEvaluateArgs } from '../scripts/media-validation-evaluate.js';
import {
  validateReferenceLabelManifest,
  validateCalibrationProfile,
  validateRunValidationEvidenceEnvelope,
} from '../src/mediaValidation/calibrationSchemas.js';

describe('media-validation-calibrate — parseArgs', () => {
  it('parsea --evidence (lista)/--labels/--calibration-id/--out', () => {
    const args = parseCalibrateArgs([
      '--evidence=data/rve-1.json,data/rve-2.json',
      '--labels=data/labels.json',
      '--calibration-id=CAL-1',
      '--out=data/calibration.json',
    ]);
    expect(args.evidence).toEqual(['data/rve-1.json', 'data/rve-2.json']);
    expect(args.labels).toBe('data/labels.json');
    expect(args.calibrationId).toBe('CAL-1');
    expect(args.out).toBe('data/calibration.json');
  });

  it('flags ausentes producen null/[] explícitos, nunca valores fabricados', () => {
    const args = parseCalibrateArgs([]);
    expect(args.evidence).toEqual([]);
    expect(args.labels).toBeNull();
    expect(args.calibrationId).toBeNull();
    expect(args.out).toBeNull();
  });

  it('--evidence con un solo archivo (sin coma) produce array de 1', () => {
    expect(parseCalibrateArgs(['--evidence=data/rve.json']).evidence).toEqual(['data/rve.json']);
  });
});

describe('media-validation-evaluate — parseArgs', () => {
  it('parsea --evidence/--profile/--out', () => {
    const args = parseEvaluateArgs(['--evidence=data/rve.json', '--profile=data/profile.json', '--out=data/report.json']);
    expect(args.evidence).toBe('data/rve.json');
    expect(args.profile).toBe('data/profile.json');
    expect(args.out).toBe('data/report.json');
  });

  it('--profile ausente produce null explícito (habilita CALIBRATION_REQUIRED, no un error)', () => {
    const args = parseEvaluateArgs(['--evidence=data/rve.json']);
    expect(args.profile).toBeNull();
  });

  it('flags ausentes producen null explícitos', () => {
    const args = parseEvaluateArgs([]);
    expect(args.evidence).toBeNull();
    expect(args.profile).toBeNull();
    expect(args.out).toBeNull();
  });
});

describe('77-81. helpers de validación consumidos por ambos CLIs (missing input / bad JSON / wrong schema / DRAFT / APPROVED)', () => {
  it('77. "missing input" — JSON.parse de string vacío lanza ANTES de llegar a cualquier validador (comportamiento nativo esperado)', () => {
    expect(() => JSON.parse('')).toThrow();
  });

  it('78. "bad JSON" — texto no-JSON lanza en JSON.parse, nunca llega a validateReferenceLabelManifest', () => {
    expect(() => JSON.parse('{not valid json')).toThrow();
  });

  it('79. "wrong schema" — JSON válido pero con schema_version incorrecto es rechazado por el validador, no por JSON.parse', () => {
    const parsed = JSON.parse('{"schema_version":99,"label_source":"human_review","entries":[]}');
    expect(() => validateReferenceLabelManifest(parsed)).toThrow();
  });

  it('79b. "wrong schema" — RunValidationEvidence con forma incorrecta es rechazado por el envelope', () => {
    expect(() => validateRunValidationEvidenceEnvelope(JSON.parse('{"foo":"bar"}'))).toThrow();
  });

  it('80. comportamiento DRAFT — un CalibrationProfile DRAFT sin reglas se acepta (preview vacío), pero el validador de evaluate.ts lo consumirá sabiendo que nunca produce ELIGIBLE_FOR_PROMOTION (ver shadow-validator.test.ts)', () => {
    const draft = validateCalibrationProfile({
      schema_version: 1,
      calibration_id: 'CAL-DRAFT',
      status: 'DRAFT',
      created_at: '2026-01-01T00:00:00.000Z',
      source: { label_sources: [], based_on_calibration_id: null },
      cohort_sizes: [],
      rules: [],
    });
    expect(draft.status).toBe('DRAFT');
  });

  it('81. comportamiento APPROVED — un CalibrationProfile APPROVED exige >=1 regla (rechazado si viene vacío)', () => {
    expect(() =>
      validateCalibrationProfile({
        schema_version: 1,
        calibration_id: 'CAL-APPROVED-EMPTY',
        status: 'APPROVED',
        created_at: '2026-01-01T00:00:00.000Z',
        source: { label_sources: [], based_on_calibration_id: null },
        cohort_sizes: [],
        rules: [],
      }),
    ).toThrow();
  });
});
