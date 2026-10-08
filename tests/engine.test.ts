import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastRatio, deltaE, oklchToHex, parseColor } from '../src/color.js';
import {
  createCandidateChecker,
  generatePalette,
  isInDomain,
  regenerateSelected,
  sortPalette,
  validatePalette,
} from '../src/generator.js';
import { DEFAULT_CONSTRAINTS, WATERFOREST_COLORS, WATERFOREST_WITNESS } from '../src/presets.js';
import type { ColorDomain } from '../src/types.js';
import { deriveStyleDomain } from '../src/style-model.js';

const optionsFor = (anchors: string[], seed = 'single-primary-test') => ({
  anchors,
  constraints: { ...DEFAULT_CONSTRAINTS },
  domain: deriveStyleDomain(anchors),
  seed,
  targetCount: 25,
  sampleCount: 16000,
});

function assertComplete(result: ReturnType<typeof generatePalette>, options: ReturnType<typeof optionsFor>) {
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(result.colors.length, 25);
  assert.equal(new Set(result.colors).size, 25);
  assert.equal(validatePalette(result.colors, options.constraints, options.domain).valid, true);
  for (const anchor of options.anchors) assert.ok(result.colors.includes(anchor), `Missing primary ${anchor}`);
  // Check the actual emitted colors and all pairs, independently of result.validation.
  for (let index = 0; index < result.colors.length; index++) {
    const hex = result.colors[index];
    assert.ok(contrastRatio(hex, options.constraints.textColor) >= options.constraints.minTextContrast);
    assert.ok(parseColor(hex)!.lch.C <= options.constraints.maxChroma);
    for (let other = 0; other < index; other++) {
      assert.ok(deltaE(hex, result.colors[other]) >= options.constraints.minDeltaE);
      assert.ok(contrastRatio(hex, result.colors[other]) <= options.constraints.maxBackgroundContrast);
    }
  }
}

for (const primary of ['#66A08F', '#A2CAE7']) {
  test(`a single ${primary} primary can generate a complete palette in the exploration domain`, () => {
    const options = optionsFor([primary]);
    const result = generatePalette(options);
    assertComplete(result, options);
    assert.equal(result.colors[0], primary);
  });
}

for (const primary of ['#000000']) {
  test(`a narrow neutral ${primary} domain reports an incomplete search instead of silently widening the range`, () => {
    const options = optionsFor([primary]);
    options.constraints.minChroma = 0;
    const result = generatePalette(options);
    assert.notEqual(result.status, 'success');
    assert.ok(result.colors.length < 25);
    assert.equal(result.colors[0], primary);
    assert.equal(result.validation.valid, true);
    const center = parseColor(primary)!;
    assert.ok(result.colors.every(hex => Math.abs(parseColor(hex)!.lch.L - center.lch.L) <= 0.054));
    assert.ok(result.colors.every(hex => parseColor(hex)!.lch.C <= 0.021));
    assert.ok(result.diagnostics.some(message => message.includes('未降低任何约束')));
  });
}

test('generation is deterministic, preserves every primary, and does not mutate the inputs', () => {
  const options = optionsFor(['#66A08F', '#A2CAE7']);
  const before = structuredClone(options);
  const first = generatePalette(options);
  const second = generatePalette(options);
  assertComplete(first, options);
  assert.deepEqual(second, first);
  assert.deepEqual(options, before);
  assert.deepEqual(first.colors.slice(0, options.anchors.length), options.anchors);
});

test('the immutable example remains an independent feasibility witness', () => {
  const before = [...WATERFOREST_COLORS];
  const generated = generatePalette(WATERFOREST_WITNESS);
  assert.equal(generated.status, 'success');
  assert.equal(generated.validation.valid, true);
  assert.notDeepEqual(generated.colors, WATERFOREST_COLORS);
  assert.deepEqual(WATERFOREST_COLORS, before);
  assert.equal(validatePalette(WATERFOREST_COLORS, WATERFOREST_WITNESS.constraints, WATERFOREST_WITNESS.domain).valid, true);
});

test('partial regeneration changes only selected positions and excludes the previous colors', () => {
  const options = optionsFor(['#66A08F']);
  const original = generatePalette(options).colors;
  const snapshot = [...original];
  const selected = [0, 5, 24];
  const result = regenerateSelected(original, selected, { ...options, seed: 'replace-selected-test' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(result.validation.valid, true);
  original.forEach((hex, index) => {
    if (selected.includes(index)) assert.ok(!original.includes(result.colors[index]));
    else assert.equal(result.colors[index], hex);
  });
  assert.deepEqual(original, snapshot);
});

test('a failed partial regeneration retains all original colors and positions', () => {
  const options = optionsFor(['#66A08F']);
  const original = generatePalette(options).colors;
  const result = regenerateSelected(original, [0, 5], {
    ...options,
    constraints: { ...options.constraints, minDeltaE: 100 },
  });
  assert.equal(result.status, 'failure');
  assert.deepEqual(result.colors, original);
});

test('an exhausted search cannot partially overwrite selected colors', () => {
  const options = optionsFor(['#66A08F']);
  const original = generatePalette(options).colors;
  const result = regenerateSelected(original, original.map((_, index) => index), {
    ...options,
    domain: { lightness: [0, 0], chroma: [0, 0], hue: [0, 360] },
    sampleCount: 100,
  });
  assert.equal(result.status, 'failure');
  assert.deepEqual(result.colors, original);
  assert.ok(result.partialColors);
  assert.ok(result.partialColors.length < original.length);
});

test('neutral grays ignore hue restrictions while chromatic colors respect them', () => {
  const domain: ColorDomain = { lightness: [0, 1], chroma: [0, 0.4], hue: [0, 20] };
  for (const hex of ['#000000', '#FFFFFF', '#808080']) assert.equal(isInDomain(parseColor(hex)!, domain), true, hex);
  assert.equal(isInDomain(parseColor('#00FF00')!, domain), false);
});

test('candidate checks allow local repairs despite unrelated fixed-color conflicts', () => {
  const constraints = { ...DEFAULT_CONSTRAINTS, minTextContrast: 1, maxBackgroundContrast: 21, minChroma: 0, maxChroma: 0.4 };
  const domain: ColorDomain = { lightness: [0, 1], chroma: [0, 0.4], hue: [0, 360] };
  const checker = createCandidateChecker(['#777777', '#777777'], constraints, domain);
  const allowed = checker('#333333');
  assert.equal(allowed.hardAllowed, true);
  assert.equal(allowed.validation.valid, false);
  assert.equal(checker('#777777').hardAllowed, false);
  assert.equal(checker('invalid').hardAllowed, false);
});

test('sorting preserves every color, all aggregate constraints, and its input array', () => {
  const options = optionsFor(['#66A08F']);
  const original = generatePalette(options).colors;
  const snapshot = [...original];
  const sorted = sortPalette(original);
  assert.deepEqual([...sorted].sort(), [...original].sort());
  assert.deepEqual(original, snapshot);
  const before = validatePalette(original, options.constraints, options.domain);
  const after = validatePalette(sorted, options.constraints, options.domain);
  for (const key of ['valid', 'minDeltaE', 'maxBackgroundContrast', 'minTextContrast', 'maxChroma'] as const) {
    assert.equal(after[key], before[key]);
  }
});

test('out-of-sRGB points are rejected instead of clipped and ordinary HEX round-trips exactly', () => {
  assert.equal(oklchToHex({ L: 0.6, C: 0.4, h: 150 }), null);
  for (const hex of ['#000000', '#FFFFFF', '#808080', '#FF0000', '#00FF00', '#0000FF', '#66A08F']) {
    assert.equal(oklchToHex(parseColor(hex)!.lch), hex);
  }
});

test('invalid primary constraints fail without overwriting supplied colors', () => {
  for (const primary of ['#FF0000', '#FFFFFF']) {
    const options = optionsFor([primary]);
    const result = generatePalette(options);
    assert.equal(result.status, 'failure');
    assert.deepEqual(result.colors, [primary]);
    assert.equal(result.stats.sampled, 0);
    assert.ok(result.validation.issues.length > 0);
  }
  assert.equal(generatePalette(optionsFor([])).status, 'failure');
});
