/**
 * Helper para scripts de fases aún no implementadas.
 * Mantiene los comandos de npm disponibles sin romper, indicando la fase.
 */
import { logger } from '../src/utils/logger.js';

export function notImplemented(script: string, fase: string): never {
  logger.warn(
    `"${script}" todavía no está implementado. Corresponde a la ${fase}. ` +
      'Consulta docs/architecture.md para el plan por fases.',
  );
  process.exit(0);
}
