import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const target = new URL('./growth-probe-modules/', import.meta.url);
await mkdir(target, { recursive: true });
await writeFile(new URL('package.json', target), '{"type":"module"}');
for (const file of await readdir(new URL('../src/', import.meta.url))) {
  if (!file.endsWith('.ts')) continue;
  const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(new URL(file.replace(/\.ts$/, '.js'), target), js.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, '$1$2.js$3'));
}
const { createProject, makeExample } = await import(new URL('project.js', target));
const { runPaletteOperation } = await import(new URL('palette-workflow.js', target));
const { analyzePalette } = await import(new URL('palette-analysis.js', target));
const rows = [];
for (let index = 0; index < 12; index++) {
  const project = { ...createProject(), seed: `root-probe-${index}` };
  const root = runPaletteOperation(project, { kind: 'add' });
  const start = performance.now();
  const result = runPaletteOperation({ ...project, colors: root.colors, growth: root.growth }, { kind: 'complete' });
  const analysis = result.status === 'success' ? analyzePalette(result.colors) : null;
  rows.push({ seed: project.seed, root: root.colors[0], rootValid: root.validation.valid,
    status: result.status, milliseconds: Math.round(performance.now()-start),
    nearest: analysis?.distributions.nearestNeighborDeltaE.median,
    mst: analysis?.distributions.mstDeltaE.max, diagnostics: result.status === 'failure' ? result.diagnostics : undefined });
}
for (const preset of ['forest', 'clay']) {
  const example = makeExample(preset);
  const result = runPaletteOperation({ ...example, colors: example.anchors, seed: 'palette-01' }, { kind: 'complete' });
  const analysis = result.status === 'success' ? analyzePalette(result.colors) : null;
  rows.push({ preset, status: result.status, nearest: analysis?.distributions.nearestNeighborDeltaE.median,
    mst: analysis?.distributions.mstDeltaE.max, C: analysis?.distributions.chroma.median });
}
console.log(JSON.stringify(rows, null, 2));
