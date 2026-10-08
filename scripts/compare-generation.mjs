import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'color-generator-regression-'));
try {
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const name of ['color', 'presets', 'style-model', 'generator', 'project', 'palette-analysis', 'sequential-growth', 'growth-types']) {
    const source = await readFile(new URL(`src/${name}.ts`, root), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await writeFile(join(temporary, `${name}.js`), result.outputText.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, '$1$2.js$3'));
  }
  const { generatePalette, validatePalette } = await import(pathToFileURL(join(temporary, 'generator.js')).href);
  const { WATERFOREST_WITNESS } = await import(pathToFileURL(join(temporary, 'presets.js')).href);
  const { makeExample, effectiveDomain } = await import(pathToFileURL(join(temporary, 'project.js')).href);
  const { analyzePalette, summarize } = await import(pathToFileURL(join(temporary, 'palette-analysis.js')).href);
  const { makeStyleModel } = await import(pathToFileURL(join(temporary, 'style-model.js')).href);
  const legacyColors = [
    '#307D81', '#66A08F', '#5BB3DD', '#A1C7A1', '#A2CAE7',
    '#488EC4', '#52884B', '#4BC0B0', '#67DBD3', '#7DB879',
    '#0F9681', '#2F78AD', '#7B9CB8', '#698397', '#92AE9C',
    '#1FA7BA', '#73886F', '#679E5E', '#96B1C8', '#60765E',
    '#62CBEA', '#218FA1', '#058161', '#8BC5C7', '#89DAA5',
  ];
  const originalPoolStats = { sampled: 16000, gamutRejected: 1385, hardRejected: 3269, uniqueCandidates: 11333, attempts: 3 };
  const legacy = {
    provenance: 'Exact historical maximin output and pool statistics recorded in docs/ALGORITHM.md section 7.2 before the local-style scoring update; metrics are recomputed from those HEX values.',
    colors: legacyColors,
    validation: validatePalette(legacyColors, WATERFOREST_WITNESS.constraints, WATERFOREST_WITNESS.domain),
    stats: originalPoolStats,
    analysis: analyzePalette(legacyColors),
  };
  const inputs = [{ id: 'historical-fixed-waterforest-input', options: structuredClone(WATERFOREST_WITNESS) }];
  for (const preset of ['forest', 'clay']) {
    const example = makeExample(preset);
    inputs.push({
      id: `ui-${preset}-palette-01`,
      options: { anchors: example.anchors, constraints: example.constraints, domain: effectiveDomain(example), seed: 'palette-01', targetCount: 25, sampleCount: 16000 },
    });
  }
  const cases = inputs.map(({ id, options }) => {
    const result = generatePalette(options);
    assert.equal(result.status, 'success', `${id}: ${result.diagnostics.join('; ')}`);
    assert.equal(result.validation.valid, true);
    assert.deepEqual(generatePalette(options), result, `${id} must reproduce exactly`);
    const example = makeExample(id.includes('clay') ? 'clay' : 'forest');
    const guide = makeStyleModel(options.anchors);
    const analysis = analyzePalette(result.colors);
    return {
      id, input: options, result, analysis,
      chromaComparison: {
        originalExample: analyzePalette(example.colors).distributions.chroma,
        primaryColors: summarize(guide.anchors.map(color => color.lch.C)),
        pathKnots: summarize(guide.knots.map(knot => knot.lch.C)),
        generated: analysis.distributions.chroma,
      },
    };
  });
  assert.deepEqual(cases[0].result.stats, originalPoolStats, 'The historical Halton candidate pool must remain unchanged');
  const report = {
    schemaVersion: 1,
    runtime: process.version,
    method: 'Same original Halton domain pool, quantized HEX checks and three attempts. Only greedy ranking and same-count attempt selection changed; style references are soft. Analyses use all 300 pairs, 25 nearest-neighbor distances and 24 full-OKLab MST edges.',
    baseline: legacy,
    cases,
  };
  await mkdir(new URL('docs/analysis/', root), { recursive: true });
  await writeFile(new URL('docs/analysis/generation-regression.json', root), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    baseline: { nearest: legacy.analysis.distributions.nearestNeighborDeltaE, mst: legacy.analysis.distributions.mstDeltaE },
    cases: cases.map(({ id, result, analysis, chromaComparison }) => ({ id, colors: result.colors, validation: result.validation, stats: result.stats, distributions: analysis.distributions, chromaComparison })),
  }, null, 2));
} finally {
  // This unique temporary directory was created by this invocation only.
  await rm(temporary, { recursive: true, force: true });
}
