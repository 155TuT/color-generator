import type { Project } from './project';
import type { GrowthOperation, GrowthResult } from './growth-types';
import { growPalette } from './sequential-growth';

/** Complete the current palette without replacing or mutating any existing color. */
export function completePalette(project: Project): GrowthResult {
  return runPaletteOperation(project, { kind: 'complete' });
}

export function runPaletteOperation(project: Project, operation: GrowthOperation): GrowthResult {
  return growPalette(structuredClone(project), operation);
}
