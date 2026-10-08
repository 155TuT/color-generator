import { growPalette } from './sequential-growth.js';
/** Complete the current palette without replacing or mutating any existing color. */
export function completePalette(project) {
    return runPaletteOperation(project, { kind: 'complete' });
}
export function runPaletteOperation(project, operation) {
    return growPalette(structuredClone(project), operation);
}
