import { runPaletteOperation } from './palette-workflow.js';
self.onmessage = (event) => {
    const { project, operation = { kind: 'complete' } } = event.data;
    try {
        const result = runPaletteOperation(project, operation);
        self.postMessage({ result });
    }
    catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : '生成失败。' });
    }
};
