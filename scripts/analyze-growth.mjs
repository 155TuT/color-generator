import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'color-generator-growth-analysis-'));
try {
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const file of (await readdir(new URL('src/', root))).filter(file => file.endsWith('.ts'))) {
    const source = await readFile(new URL(`src/${file}`, root), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    const javascript = result.outputText.replace(
      /((?:from\s+|import\s*)['"])(\.\.?\/[^'"]+)(['"])/g,
      (_, before, specifier, after) => `${before}${extname(specifier) ? specifier : `${specifier}.js`}${after}`,
    );
    await writeFile(join(temporary, file.replace(/\.ts$/, '.js')), javascript);
  }
  const load = name => import(pathToFileURL(join(temporary, `${name}.js`)).href);
  const { runPaletteOperation } = await load('palette-workflow');
  const { createProject, makeExample } = await load('project');
  const { generatePalette } = await load('generator');
  const { analyzePalette } = await load('palette-analysis');
  const examples = ['forest', 'clay'].map(id => {
    const example = makeExample(id);
    return { id, colors: example.colors, analysis: analyzePalette(example.colors) };
  });
  const cases = [];
  for (const id of ['forest', 'clay']) {
    for (const seed of ['growth-study-01', 'growth-study-02', 'growth-study-03']) {
      const example = makeExample(id);
      const input = {
        ...createProject(), colors: [...example.anchors], constraints: structuredClone(example.constraints),
        domain: structuredClone(example.domain), domainMode: 'manual', seed,
      };
      const result = runPaletteOperation(input, { kind: 'complete' });
      const baseline = generatePalette({ anchors: input.colors, constraints: input.constraints, domain: input.domain, seed });
      assert.deepEqual(runPaletteOperation(input, { kind: 'complete' }), result, `${id}/${seed}: reproduction`);
      cases.push({ id: `${id}/${seed}`, input, inputAnalysis: analyzePalette(input.colors), result,
        analysis: result.colors.length >= 2 ? analyzePalette(result.colors) : null,
        previousEngine: { result: baseline, analysis: baseline.colors.length >= 2 ? analyzePalette(baseline.colors) : null },
      });
    }
  }
  for (const [id, colors] of [
    ['far-endpoints', ['#307D81', '#A2CAE7']],
    ['near-neighbors', ['#38848D', '#41888C']],
    ['one-root', ['#66A08F']],
  ]) {
    const input = { ...createProject(), colors, seed: 'growth-structure-study' };
    const operation = { kind: id === 'one-root' ? 'complete' : 'add' };
    const result = runPaletteOperation(input, operation);
    cases.push({ id, input, operation, result,
      before: colors.length >= 2 ? analyzePalette(colors) : null,
      analysis: result.colors.length >= 2 ? analyzePalette(result.colors) : null,
    });
  }
  const report = {
    schemaVersion: 1,
    studyDate: '2026-10-09',
    studyTimeZone: 'Asia/Shanghai',
    runtime: process.version,
    method: 'Independent output analysis of sequential growth. Original 25-color examples are descriptive baselines, never candidate pools. Original generation engine is retained as a comparison. All metrics are recomputed from emitted 8-bit HEX using 100x OKLab Euclidean distance, all pairs, each color nearest neighbor, and full-3D minimum spanning tree.',
    limits: 'A small deterministic regression sample does not establish universal aesthetic quality or guarantee feasible completion for every random root or user constraint. Failure outputs remain recorded, not excluded.',
    examples, cases,
  };
  await writeFile(new URL('docs/analysis/sequential-growth.json', root), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(cases.map(({ id, result, analysis }) => ({
    id, status: result.status, count: result.colors.length, valid: result.validation.valid,
    diagnostics: result.diagnostics,
    nearest: analysis?.distributions.nearestNeighborDeltaE,
    mst: analysis?.distributions.mstDeltaE,
    pairMedian: analysis?.distributions.pairDeltaE.median,
    chromaMedian: analysis?.distributions.chroma.median,
    hueArc: analysis?.hueArc,
  })), null, 2));
} finally {
  // Remove only the unique temporary directory created by this script.
  await rm(temporary, { recursive: true, force: true });
}
