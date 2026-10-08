import { runPaletteOperation } from './palette-workflow';
import type { Project } from './project';
import type { GrowthOperation } from './growth-types';

self.onmessage = (event: MessageEvent<{ project: Project; operation?: GrowthOperation }>) => {
  const { project, operation = { kind: 'complete' } } = event.data;
  try {
    const result = runPaletteOperation(project, operation);
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '生成失败。' }); }
};
