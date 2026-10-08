import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastRatio, deltaE, parseColor } from '../src/color';
import { isInDomain, sortPalette, validatePalette } from '../src/generator';
import { analyzePalette } from '../src/palette-analysis';
import { runPaletteOperation } from '../src/palette-workflow';
import { createProject, effectiveDomain, makeExample, type Project } from '../src/project';
import { synchronizeGrowth } from '../src/sequential-growth';

function exampleInput(preset: 'forest' | 'clay', seed = 'growth-contract-01'): Project {
  const example = makeExample(preset);
  return { ...createProject(), colors: [...example.anchors], constraints: example.constraints,
    domain: example.domain, domainMode: 'manual', seed };
}

function apply(project: Project, result: ReturnType<typeof runPaletteOperation>): Project {
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  return { ...project, colors: [...result.colors], growth: structuredClone(result.growth), domainMode: result.domainMode ?? project.domainMode };
}

function assertQuantizedConstraints(project: Project, colors: string[]) {
  assert.equal(new Set(colors).size, colors.length);
  assert.equal(validatePalette(colors, project.constraints, effectiveDomain(project)).valid, true);
  for (let index = 0; index < colors.length; index++) {
    assert.ok(parseColor(colors[index])!.lch.C >= (project.constraints.minChroma ?? 0) - 1e-10);
    assert.ok(parseColor(colors[index])!.lch.C <= project.constraints.maxChroma + 1e-10);
    assert.ok(contrastRatio(colors[index], project.constraints.textColor) + 1e-10 >= project.constraints.minTextContrast);
    for (let other = 0; other < index; other++) {
      assert.ok(deltaE(colors[index], colors[other]) + 1e-10 >= project.constraints.minDeltaE);
      assert.ok(contrastRatio(colors[index], colors[other]) <= project.constraints.maxBackgroundContrast + 1e-10);
    }
  }
}

test('a first root is deterministic under only sRGB and the hard chroma band', () => {
  const project = createProject(); project.seed = 'unconstrained-first-root';
  const baseline = runPaletteOperation(project, { kind: 'add' });
  const strict = structuredClone(project);
  strict.domainMode = 'manual';
  strict.domain = { lightness: [0.1, 0.11], chroma: [0, 0.001], hue: [270, 271] };
  strict.constraints.textColor = '#000000';
  strict.constraints.minTextContrast = 21;
  const result = runPaletteOperation(strict, { kind: 'add' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.deepEqual(result.colors, baseline.colors, 'text settings and a manual search range must not choose the root');
  assert.equal(result.colors.length, 1);
  assert.match(result.colors[0], /^#[0-9A-F]{6}$/);
  assert.ok(parseColor(result.colors[0])!.lch.C >= (strict.constraints.minChroma ?? 0));
  assert.ok(parseColor(result.colors[0])!.lch.C <= strict.constraints.maxChroma);
  assert.equal(result.validation.valid, false, 'the honest full audit must still expose incompatible settings');
  const nextInput = apply(strict, result);
  const before = structuredClone(nextInput);
  const failed = runPaletteOperation(nextInput, { kind: 'add' });
  assert.notEqual(failed.status, 'success', 'later colors must not ignore the root conflict');
  assert.deepEqual(failed.colors, result.colors);
  assert.deepEqual(nextInput, before);
});

test('one add and a complete run share every prefix, and repeat exactly without input mutation', () => {
  const input = exampleInput('forest', 'prefix-contract');
  const before = structuredClone(input);
  const complete = runPaletteOperation(input, { kind: 'complete' });
  assert.equal(complete.status, 'success', complete.diagnostics.join('\n'));
  assert.deepEqual(runPaletteOperation(input, { kind: 'complete' }), complete);
  let incremental = structuredClone(input);
  while (incremental.colors.length < 25) {
    const result = runPaletteOperation(incremental, { kind: 'add' });
    assert.equal(result.colors.length, incremental.colors.length + 1);
    incremental = apply(incremental, result);
    assert.deepEqual(incremental.colors, complete.colors.slice(0, incremental.colors.length));
  }
  assert.deepEqual(input, before);
  assertQuantizedConstraints(input, complete.colors);
});

test('display sorting cannot change the next growth color or the saved birth history', () => {
  const original = exampleInput('clay', 'sort-stability');
  const grown = apply(original, runPaletteOperation(original, { kind: 'add' }));
  const displayed = { ...structuredClone(grown), colors: sortPalette(grown.colors) };
  assert.deepEqual(synchronizeGrowth(displayed), synchronizeGrowth(grown));
  const left = runPaletteOperation(grown, { kind: 'add' });
  const right = runPaletteOperation(displayed, { kind: 'add' });
  assert.equal(left.status, 'success', left.diagnostics.join('\n'));
  assert.equal(right.status, 'success', right.diagnostics.join('\n'));
  assert.equal(right.colors.at(-1), left.colors.at(-1));
  assert.deepEqual(right.growth, left.growth);
});

test('partial randomization changes selected slots only inside the frozen current range', () => {
  const example = makeExample('forest');
  const input = { ...createProject(), colors: [...example.colors], seed: 'partial-random-contract' };
  const range = effectiveDomain(input);
  const before = structuredClone(input);
  const indices = [1, 8, 19];
  const result = runPaletteOperation(input, { kind: 'randomize', indices });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(result.colors.length, input.colors.length);
  assert.deepEqual([...result.changedIndices].sort((a, b) => a - b), indices);
  result.colors.forEach((hex, index) => {
    if (indices.includes(index)) {
      assert.notEqual(hex, input.colors[index]);
      assert.equal(isInDomain(parseColor(hex)!, range), true, `${hex} left the pre-operation range`);
    } else assert.equal(hex, input.colors[index], `unselected slot ${index} changed`);
  });
  assertQuantizedConstraints(input, result.colors);
  assert.deepEqual(input, before);
  assert.deepEqual(runPaletteOperation(input, { kind: 'randomize', indices }), result);
});

test('randomizing the only selected color starts a new root rather than its old neighborhood', () => {
  const input = createProject(); input.colors = ['#66A08F']; input.seed = 'new-root-contract';
  input.domainMode = 'manual';
  input.domain = { lightness: [0.6, 0.7], chroma: [0.04, 0.08], hue: [150, 170] };
  input.growth = synchronizeGrowth(input);
  const result = runPaletteOperation(input, { kind: 'randomize', indices: [0] });
  const fresh = { ...structuredClone(input), colors: [], growth: undefined };
  const root = runPaletteOperation(fresh, { kind: 'add' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.deepEqual(result.colors, root.colors);
  assert.notEqual(result.colors[0], input.colors[0]);
  assert.deepEqual(result.changedIndices, [0]);
  assert.equal(result.domainMode, 'auto');
});

test('full randomization discards the old manual envelope and regrows sequentially with global rules', () => {
  const input = exampleInput('forest', 'full-reset-contract');
  input.colors = input.colors.slice(0, 3);
  input.constraints.minTextContrast = 1;
  input.constraints.maxBackgroundContrast = 21;
  input.growth = synchronizeGrowth(input);
  const before = structuredClone(input);
  const result = runPaletteOperation(input, { kind: 'randomize', indices: [0, 1, 2] });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(result.domainMode, 'auto');
  assert.equal(result.colors.length, 3);
  assert.ok(result.colors.every(hex => !input.colors.includes(hex)));
  let fresh: Project = { ...createProject(), seed: input.seed, constraints: structuredClone(input.constraints) };
  for (let step = 0; step < input.colors.length; step++) fresh = apply(fresh, runPaletteOperation(fresh, { kind: 'add' }));
  assert.deepEqual(result.colors, fresh.colors, 'full reset must execute the same new-root growth steps');
  assert.deepEqual(result.growth, fresh.growth);
  assert.ok(result.colors.some(hex => !isInDomain(parseColor(hex)!, input.domain)), 'the old narrow style still confined the result');
  assertQuantizedConstraints(apply(input, result), result.colors);
  assert.deepEqual(input, before);
});

test('deletion and manual edits reconcile birth history without orphan parents or ghost references', () => {
  let input: Project = { ...createProject(), colors: ['#66A08F'], seed: 'history-reconciliation' };
  for (let step = 0; step < 3; step++) input = apply(input, runPaletteOperation(input, { kind: 'add' }));
  const oldState = structuredClone(input.growth!);
  const child = oldState.nodes.find(node => node.parentId)!;
  assert.ok(child);
  const removed = oldState.nodes.find(node => node.id === child.parentId)!;
  const deleted = { ...structuredClone(input), colors: input.colors.filter(hex => hex !== removed.hex) };
  const afterDelete = synchronizeGrowth(deleted);
  assert.ok(!afterDelete.nodes.some(node => node.id === removed.id));
  assert.ok(!afterDelete.referenceColors.includes(removed.hex));
  for (const node of afterDelete.nodes) {
    assert.equal(node.birthOrder, oldState.nodes.find(old => old.id === node.id)!.birthOrder);
    assert.ok(node.parentId === null || afterDelete.nodes.some(parent => parent.id === node.parentId));
  }
  const edited = { ...deleted, growth: afterDelete, colors: [...deleted.colors] };
  const previousHex = edited.colors[0]; edited.colors[0] = '#A2CAE7';
  const afterEdit = synchronizeGrowth(edited);
  assert.equal(afterEdit.nodes.length, edited.colors.length);
  assert.ok(!afterEdit.nodes.some(node => node.hex === previousHex));
  assert.ok(!afterEdit.referenceColors.includes(previousHex));
  const newNode = afterEdit.nodes.find(node => node.hex === '#A2CAE7')!;
  assert.equal(newNode.strategy, 'fixed');
  assert.ok(newNode.birthOrder >= oldState.nextOrder);
  assert.equal(new Set(afterEdit.nodes.map(node => node.id)).size, edited.colors.length);
});

test('a failed completion never applies a partial tree or changes fixed colors', () => {
  const input = createProject(); input.colors = ['#66A08F']; input.seed = 'exhausted-growth';
  const { L, C, h } = parseColor(input.colors[0])!.lch;
  input.domainMode = 'manual';
  input.domain = { lightness: [L - 0.00001, L + 0.00001], chroma: [C - 0.00001, C + 0.00001], hue: [h - 0.00001, h + 0.00001] };
  input.growth = synchronizeGrowth(input);
  const before = structuredClone(input);
  const result = runPaletteOperation(input, { kind: 'complete' });
  assert.notEqual(result.status, 'success');
  assert.deepEqual(result.colors, input.colors);
  assert.deepEqual(result.growth, input.growth);
  assert.deepEqual(result.changedIndices, []);
  assert.deepEqual(input, before);
  assert.ok(result.diagnostics.length > 0);
});

test('a long gap asks for a transition color instead of extending the gap', () => {
  const input = createProject(); input.colors = ['#307D81', '#A2CAE7']; input.seed = 'bridge-contract';
  const before = analyzePalette(input.colors);
  const result = runPaletteOperation(input, { kind: 'add' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(result.colors.length, 3);
  assert.deepEqual(result.colors.slice(0, 2), input.colors);
  const after = analyzePalette(result.colors);
  assert.ok(after.distributions.mstDeltaE.max < before.distributions.mstDeltaE.max * 0.75,
    `bridge did not substantially reduce the longest connecting step: ${before.distributions.mstDeltaE.max} -> ${after.distributions.mstDeltaE.max}`);
  assert.ok(parseColor(result.colors[2])!.lch.C >= Math.min(...input.colors.map(hex => parseColor(hex)!.lch.C)) * 0.75,
    'the bridge must not cut through the gray center');
  assertQuantizedConstraints(input, result.colors);
});

test('close colors explore beyond their tiny hue interval while keeping a nearby attachment', () => {
  const input = createProject(); input.colors = ['#38848D', '#41888C']; input.seed = 'near-expansion-contract';
  const before = analyzePalette(input.colors);
  const result = runPaletteOperation(input, { kind: 'add' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  const after = analyzePalette(result.colors);
  assert.ok(after.hueArc.span > before.hueArc.span + 10, 'a dense pair should gain a neighboring hue direction');
  const nearest = Math.min(...input.colors.map(hex => deltaE(hex, result.colors[2])));
  assert.ok(nearest > before.distributions.mstDeltaE.max, 'adding inside the already tight gap cannot provide a new direction');
  assert.ok(nearest < 6, 'exploration detached the new color from the existing neighborhood');
  assertQuantizedConstraints(input, result.colors);
});

test('one supplied root grows multiple nearby hue directions without becoming a neutral ramp', () => {
  const input = createProject(); input.colors = ['#66A08F']; input.seed = 'single-root-families';
  const result = runPaletteOperation(input, { kind: 'complete' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(result.colors.length, 25);
  const output = analyzePalette(result.colors);
  assert.ok(output.hueArc.span >= 55 && output.hueArc.span <= 100, JSON.stringify(output.hueArc));
  assert.ok(output.distributions.chroma.median >= parseColor(input.colors[0])!.lch.C * 0.7);
  assert.ok(output.distributions.mstDeltaE.max <= 6);
  const hues = result.colors.map(hex => parseColor(hex)!.lch.h);
  assert.ok(hues.filter(h => h < 160).length >= 3, 'neighboring green direction missing');
  assert.ok(hues.filter(h => h >= 160 && h < 190).length >= 3, 'central direction missing');
  assert.ok(hues.filter(h => h >= 190).length >= 3, 'neighboring blue-green direction missing');
  assertQuantizedConstraints({ ...input, growth: result.growth }, result.colors);
});

test('a single hue with floating-point wraparound stays inside its own nearby search arc', () => {
  const input = createProject(); input.colors = ['#9090AB']; input.seed = 'hue-wrap-root-regression';
  const domain = effectiveDomain(input);
  const span = ((domain.hue[1] - domain.hue[0]) % 360 + 360) % 360;
  assert.ok(span > 0 && span <= 100, `single-root neighborhood became a full or misplaced hue circle: ${domain.hue}`);
  assert.equal(isInDomain(parseColor(input.colors[0])!, domain), true);
  const result = runPaletteOperation(input, { kind: 'add' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assertQuantizedConstraints(input, result.colors);
});

for (const preset of ['forest', 'clay'] as const) {
  test(`${preset} representatives retain nearby color families and example-scale connectivity`, context => {
    const original = analyzePalette(makeExample(preset).colors);
    const measurements = [];
    for (const seed of ['growth-study-01', 'growth-study-02', 'growth-study-03']) {
      const input = exampleInput(preset, seed);
      const result = runPaletteOperation(input, { kind: 'complete' });
      assert.equal(result.status, 'success', result.diagnostics.join('\n'));
      assert.equal(result.colors.length, 25);
      assert.deepEqual(result.colors.slice(0, input.colors.length), input.colors);
      assertQuantizedConstraints(input, result.colors);
      const output = analyzePalette(result.colors);
      const nn = output.distributions.nearestNeighborDeltaE.median;
      const c = output.distributions.chroma.median;
      const diagnostic = JSON.stringify({ preset, seed, nearest: nn, mstMax: output.distributions.mstDeltaE.max,
        pairMedian: output.distributions.pairDeltaE.median, chromaMedian: c, hueArc: output.hueArc });
      measurements.push(JSON.parse(diagnostic));
      assert.ok(nn >= original.distributions.nearestNeighborDeltaE.median * 0.65 && nn <= original.distributions.nearestNeighborDeltaE.median * 1.5, diagnostic);
      assert.ok(output.distributions.mstDeltaE.max <= original.distributions.mstDeltaE.max * 1.4, diagnostic);
      assert.ok(output.distributions.pairDeltaE.median >= original.distributions.pairDeltaE.median * 0.55, diagnostic);
      assert.ok(c >= original.distributions.chroma.median * 0.65 && c <= original.distributions.chroma.median * 1.5, diagnostic);
      const hues = result.colors.map(hex => parseColor(hex)!.lch.h);
      if (preset === 'forest') {
        assert.ok(hues.filter(h => h < 175).length >= 2, `green family collapsed: ${diagnostic}`);
        assert.ok(hues.filter(h => h >= 175 && h < 215).length >= 4, `cyan transitions collapsed: ${diagnostic}`);
        assert.ok(hues.filter(h => h >= 215).length >= 4, `blue family collapsed: ${diagnostic}`);
      } else {
        assert.ok(hues.filter(h => h < 65).length >= 3, `clay family collapsed: ${diagnostic}`);
        assert.ok(hues.filter(h => h >= 330).length >= 3, `rose family collapsed: ${diagnostic}`);
        assert.ok(hues.filter(h => h >= 280 && h < 330).length >= 3, `mauve transitions collapsed: ${diagnostic}`);
        assert.ok(hues.filter(h => h >= 250 && h < 280).length <= 4, `the sparse cool accent became a dominant family: ${diagnostic}`);
      }
    }
    context.diagnostic(JSON.stringify(measurements));
  });
}
