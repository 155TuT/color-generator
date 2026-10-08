import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const mode = process.argv[2];
if (!['baseline', 'after'].includes(mode)) throw new Error('Usage: node scripts/analyze-radial-growth.mjs baseline|after');
const root = new URL('../', import.meta.url);
const destination = new URL('docs/analysis/radial-growth.json', root);
let previous;
try { previous = JSON.parse(await readFile(destination, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (mode === 'baseline' && previous?.baseline) throw new Error('A baseline already exists. It is immutable and will not be overwritten.');
if (mode === 'after' && !previous?.baseline) throw new Error('Record a baseline before running after.');

const covariance = values => {
  const mean = [0, 1, 2].map(axis => values.reduce((sum, point) => sum + point[axis], 0) / values.length);
  return mean.map((_, left) => mean.map((__, right) => values.reduce((sum, point) => sum + (point[left] - mean[left]) * (point[right] - mean[right]), 0) / values.length));
};
function eigenvalues(input) {
  const matrix = input.map(row => [...row]);
  for (let iteration = 0; iteration < 50; iteration++) {
    let p = 0, q = 1;
    for (const [left, right] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(matrix[left][right]) > Math.abs(matrix[p][q])) { p = left; q = right; }
    if (Math.abs(matrix[p][q]) < 1e-16) break;
    const angle = Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]) / 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const pp = matrix[p][p], qq = matrix[q][q], pq = matrix[p][q];
    matrix[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    matrix[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    matrix[p][q] = matrix[q][p] = 0;
    for (let axis = 0; axis < 3; axis++) if (axis !== p && axis !== q) {
      const ap = matrix[axis][p], aq = matrix[axis][q];
      matrix[axis][p] = matrix[p][axis] = c * ap - s * aq;
      matrix[axis][q] = matrix[q][axis] = s * ap + c * aq;
    }
  }
  return [0, 1, 2].map(axis => Math.max(0, matrix[axis][axis])).sort((left, right) => right - left);
}
assert.deepEqual(eigenvalues([[4, 0, 0], [0, 2, 0], [0, 0, 1]]), [4, 2, 1]);
assert.ok(eigenvalues([[1, 1, 0], [1, 1, 0], [0, 0, 0]])[1] < 1e-12);

const temporary = await mkdtemp(join(tmpdir(), 'color-generator-radial-analysis-'));
try {
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
  const sourceHashes = {};
  for (const file of (await readdir(new URL('src/', root))).filter(file => file.endsWith('.ts'))) {
    const source = await readFile(new URL(`src/${file}`, root), 'utf8');
    sourceHashes[file] = createHash('sha256').update(source).digest('hex');
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    const javascript = result.outputText.replace(
      /((?:from\s+|import\s*)['"])(\.\.?\/[^'"]+)(['"])/g,
      (_, before, specifier, after) => `${before}${extname(specifier) ? specifier : `${specifier}.js`}${after}`,
    );
    await writeFile(join(temporary, file.replace(/\.ts$/, '.js')), javascript);
  }
  const load = name => import(pathToFileURL(join(temporary, `${name}.js`)).href);
  const { runPaletteOperation } = await load('palette-workflow');
  const { createProject, makeExample, effectiveDomain } = await load('project');
  const { analyzePalette } = await load('palette-analysis');
  const { parseColor } = await load('color');
  const cases = [];
  const measure = (input, result) => {
    if (result.colors.length < 2) return null;
    const analysis = analyzePalette(result.colors);
    const chroma = analysis.distributions.chroma;
    const rootChroma = input.colors.length === 1 ? parseColor(input.colors[0]).lch.C : null;
    const domain = effectiveDomain(input);
    const hardBand = [input.constraints.minChroma ?? 0, input.constraints.maxChroma];
    const radialBand = [Math.max(domain.chroma[0], hardBand[0]), Math.min(domain.chroma[1], hardBand[1])];
    const radialStd = Math.sqrt(analysis.colors.reduce((sum, color) => sum + (color.lch.C - chroma.mean) ** 2, 0) / analysis.colors.length);
    const cartesianEigenvalues = eigenvalues(covariance(analysis.colors.map(color => [color.lab.L, color.lab.a, color.lab.b])));
    const perceptualCylindricalEigenvalues = eigenvalues(covariance(analysis.colors.map(color => [
      color.lch.L, color.lch.C,
      (((color.lch.h - analysis.hueArc.start) % 360 + 360) % 360) * Math.PI / 180 * chroma.median,
    ])));
    const rank = values => values.filter(value => value > Math.max(1e-12, values[0] * 1e-8)).length;
    return {
      hardBand, radialBand, rootChroma, radialStd, radialP10P90: chroma.p90 - chroma.p10,
      radialCoverage: (chroma.p90 - chroma.p10) / (radialBand[1] - radialBand[0]),
      medianChromaShift: rootChroma === null ? null : chroma.median - rootChroma,
      atHardFloor: analysis.colors.filter(color => color.lch.C <= hardBand[0] + 0.002).length,
      atHardCeiling: analysis.colors.filter(color => color.lch.C >= hardBand[1] - 0.002).length,
      cartesianEigenvalues, cartesianRank: rank(cartesianEigenvalues),
      perceptualCylindricalEigenvalues, cylindricalRank: rank(perceptualCylindricalEigenvalues),
      cylindricalSmallestToLargest: perceptualCylindricalEigenvalues[2] / perceptualCylindricalEigenvalues[0],
      distributions: analysis.distributions, hueArc: analysis.hueArc,
      points: analysis.colors.map(({ hex, lab, lch }) => ({ hex, lab, lch })),
    };
  };
  const inputs = mode === 'after' ? previous.baseline.cases.map(({ id, input }) => ({ id, input })) : [];
  if (mode === 'baseline') {
    for (const hex of ['#7A5607', '#7A6068', '#66A08F', '#9090AB', '#F39E9D']) {
      for (const seed of ['radial-01', 'radial-02', 'radial-03']) {
        inputs.push({ id: `${hex}/${seed}`, input: { ...createProject(), colors: [hex], seed } });
      }
    }
    for (const preset of ['forest', 'clay']) {
      const example = makeExample(preset);
      for (const seed of ['radial-01', 'radial-02', 'radial-03']) inputs.push({
        id: `${preset}/${seed}`, input: { ...createProject(), colors: [...example.anchors], seed,
          constraints: example.constraints, domain: example.domain, domainMode: 'manual' },
      });
    }
  }
  for (const { id, input } of inputs) {
    const result = runPaletteOperation(input, { kind: 'complete' });
    cases.push({ id, input, result, measurement: measure(input, result) });
  }
  const run = { studyDate: '2026-10-09', studyTimeZone: 'Asia/Shanghai', runtime: process.version, sourceHashes, cases };
  const report = mode === 'baseline' ? {
    schemaVersion: 1,
    method: 'Fixed inputs and seeds, recomputed from actual 8-bit HEX. Radial spread is OKLCh C, exactly the a/b radius. P10-P90 is R-7; standard deviation and covariances are population measures. Cylindrical covariance uses L, C and unwrapped hue arc length at median C so the three axes have comparable local scale.',
    limits: 'Cartesian OKLab covariance may have rank 3 even for a constant-C cylindrical surface; rank alone cannot prove radial variation. These small regression samples do not establish universal aesthetic quality. The baseline is immutable; after always reuses its exact inputs.',
    baseline: run,
  } : { ...previous, after: run };
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: mode === 'baseline' ? 'wx' : 'w' });
  console.log(JSON.stringify(cases.map(({ id, result, measurement: m }) => ({ id, status: result.status,
    std: m?.radialStd, p10p90: m?.radialP10P90, coverage: m?.radialCoverage,
    medianShift: m?.medianChromaShift, floor: m?.atHardFloor, ceiling: m?.atHardCeiling,
    nn: m?.distributions.nearestNeighborDeltaE.median, mst: m?.distributions.mstDeltaE.max,
    rank: m?.cartesianRank, cylinderRank: m?.cylindricalRank, cylinderRatio: m?.cylindricalSmallestToLargest,
  })), null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
