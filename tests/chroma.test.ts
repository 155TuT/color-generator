import assert from 'node:assert/strict';
import test from 'node:test';
import { parseColor } from '../src/color';
import { createCandidateChecker, validatePalette } from '../src/generator';
import { runPaletteOperation } from '../src/palette-workflow';
import { createProject, effectiveDomain, makeExample, type Project } from '../src/project';
import { DEFAULT_CONSTRAINTS } from '../src/presets';

const unconstrainedText = () => ({ ...DEFAULT_CONSTRAINTS, minTextContrast: 1 });
const checkBand = (colors: readonly string[], lower: number, upper: number) => colors.forEach(hex => {
  const actual = parseColor(hex)!.lch.C;
  assert.ok(actual >= lower && actual <= upper, `${hex}: actual quantized C ${actual} outside [${lower}, ${upper}]`);
});

test('the default hard band rejects gray, black and white independently of text or the search domain', () => {
  assert.equal(DEFAULT_CONSTRAINTS.minChroma, 0.03);
  assert.equal(DEFAULT_CONSTRAINTS.maxChroma, 0.11);
  const constraints = unconstrainedText();
  const checker = createCandidateChecker([], constraints);
  for (const hex of ['#000000', '#808080', '#FFFFFF']) {
    const validation = validatePalette([hex], constraints);
    assert.equal(validation.valid, false, hex);
    assert.ok(validation.issues.some(issue => issue.code === 'min-chroma' && issue.indices.includes(0)), hex);
    assert.equal(checker(hex).hardAllowed, false, hex);
  }
  for (const preset of ['forest', 'clay'] as const) {
    const example = makeExample(preset);
    const validation = validatePalette(example.colors, example.constraints, example.domain);
    assert.equal(validation.valid, true, `${preset}: ${validation.issues.map(issue => issue.message).join('; ')}`);
    checkBand(example.colors, 0.03, 0.11);
  }
});

test('omitting the lower bound preserves the historical API meaning of zero', () => {
  const { minChroma: omitted, ...legacy } = unconstrainedText();
  assert.equal(omitted, 0.03);
  for (const hex of ['#000000', '#808080', '#FFFFFF']) {
    assert.equal(validatePalette([hex], legacy).valid, true, hex);
    assert.equal(createCandidateChecker([], legacy)(hex).hardAllowed, true, hex);
  }
});

test('the hard lower and upper limits compare actual HEX chroma inclusively and without display rounding', () => {
  const hex = '#66A08F';
  const chroma = parseColor(hex)!.lch.C;
  const exact = { ...unconstrainedText(), minChroma: chroma, maxChroma: chroma };
  assert.equal(validatePalette([hex], exact).valid, true);
  assert.equal(createCandidateChecker([], exact)(hex).hardAllowed, true);
  const tooLow = { ...exact, minChroma: chroma + 0.000001, maxChroma: 0.11 };
  const tooHigh = { ...exact, minChroma: 0, maxChroma: chroma - 0.000001 };
  for (const constraints of [tooLow, tooHigh]) {
    assert.equal(validatePalette([hex], constraints).valid, false);
    assert.equal(createCandidateChecker([], constraints)(hex).hardAllowed, false);
  }
});

test('invalid and inverted hard chroma bands fail before root sampling without changing the project', () => {
  for (const bounds of [
    { minChroma: -0.01, maxChroma: 0.11 },
    { minChroma: Number.NaN, maxChroma: 0.11 },
    { minChroma: Number.POSITIVE_INFINITY, maxChroma: 0.11 },
    { minChroma: 0.12, maxChroma: 0.11 },
    { minChroma: 0.03, maxChroma: Number.NaN },
  ]) {
    const input = createProject(); Object.assign(input.constraints, bounds);
    const before = structuredClone(input);
    assert.equal(validatePalette([], input.constraints).valid, false);
    const result = runPaletteOperation(input, { kind: 'add' });
    assert.equal(result.status, 'failure');
    assert.deepEqual(result.colors, []);
    assert.equal(result.stats.sampled, 0);
    assert.ok(result.diagnostics.length > 0);
    assert.deepEqual(input, before);
  }
});

test('random roots obey narrow chroma bands after eight-bit quantization across seeds', () => {
  for (const [lower, upper] of [[0.03, 0.031], [0.07, 0.071], [0.105, 0.11]]) {
    for (let index = 0; index < 8; index++) {
      const input = createProject(); input.seed = `root-band-${lower}-${index}`;
      input.constraints.minChroma = lower; input.constraints.maxChroma = upper;
      const result = runPaletteOperation(input, { kind: 'add' });
      assert.equal(result.status, 'success', result.diagnostics.join('\n'));
      assert.equal(result.colors.length, 1);
      checkBand(result.colors, lower, upper);
    }
  }
});

test('add, completion, partial redraw and full reset all honor the hard band', () => {
  const example = makeExample('forest');
  const input: Project = { ...createProject(), colors: [...example.anchors], domain: example.domain,
    domainMode: 'manual', seed: 'band-workflow', constraints: { ...example.constraints, minChroma: 0.055 } };
  const added = runPaletteOperation(input, { kind: 'add' });
  assert.equal(added.status, 'success', added.diagnostics.join('\n'));
  assert.equal(added.colors.length, input.colors.length + 1);
  checkBand(added.colors, 0.055, 0.11);
  const complete = runPaletteOperation(input, { kind: 'complete' });
  assert.equal(complete.status, 'success', complete.diagnostics.join('\n'));
  assert.equal(complete.colors.length, 25);
  checkBand(complete.colors, 0.055, 0.11);
  const fullInput = { ...input, colors: complete.colors, growth: complete.growth, seed: 'band-partial-redraw' };
  const indices = [2, 10, 21];
  const partial = runPaletteOperation(fullInput, { kind: 'randomize', indices });
  assert.equal(partial.status, 'success', partial.diagnostics.join('\n'));
  checkBand(partial.colors, 0.055, 0.11);
  partial.colors.forEach((hex, index) => {
    if (!indices.includes(index)) assert.equal(hex, fullInput.colors[index]);
  });
  const resetInput: Project = { ...input, colors: input.colors.slice(0, 3), seed: 'band-full-reset',
    constraints: { ...input.constraints, minTextContrast: 1, maxBackgroundContrast: 21 } };
  const reset = runPaletteOperation(resetInput, { kind: 'randomize', indices: [0, 1, 2] });
  assert.equal(reset.status, 'success', reset.diagnostics.join('\n'));
  assert.equal(reset.colors.length, 3);
  assert.equal(reset.domainMode, 'auto');
  checkBand(reset.colors, 0.055, 0.11);
});

test('a gray manually supplied root and a disjoint manual domain stop subsequent growth atomically', () => {
  const gray = createProject(); gray.colors = ['#808080'];
  const before = structuredClone(gray);
  const invalidRoot = runPaletteOperation(gray, { kind: 'add' });
  assert.equal(invalidRoot.status, 'failure');
  assert.deepEqual(invalidRoot.colors, gray.colors);
  assert.equal(invalidRoot.stats.sampled, 0);
  assert.deepEqual(gray, before);
  const input = createProject(); input.colors = ['#66A08F']; input.domainMode = 'manual';
  input.domain = { lightness: [0, 1], chroma: [0, 0.02], hue: [0, 360] };
  const result = runPaletteOperation(input, { kind: 'complete' });
  assert.equal(result.status, 'failure');
  assert.equal(result.stats.sampled, 0);
  assert.deepEqual(result.colors, input.colors);
});

test('the empty automatic search display reflects both hard chroma bounds', () => {
  const input = createProject();
  input.constraints.minChroma = 0.047; input.constraints.maxChroma = 0.084;
  assert.deepEqual(effectiveDomain(input), { lightness: [0, 1], chroma: [0.047, 0.084], hue: [0, 360] });
});
