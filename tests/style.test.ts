import assert from 'node:assert/strict';
import test from 'node:test';
import { deltaE, parseColor } from '../src/color.js';
import { generatePalette, isInDomain, regenerateSelected, validatePalette } from '../src/generator.js';
import { CLAY_ANCHORS, CLAY_CONSTRAINTS, DEFAULT_CONSTRAINTS, WATERFOREST_ANCHORS, WATERFOREST_WITNESS } from '../src/presets.js';
import { deriveStyleDomain, interpolateStyleColor, makeStyleModel, sampleStyleColor, shortHueDifference } from '../src/style-model.js';
import type { ColorDomain } from '../src/types.js';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function distribution(colors: string[]) {
  const parsed = colors.map(value => parseColor(value)!);
  const nearest = parsed.map((color, index) => Math.min(...parsed.filter((_, other) => other !== index).map(other => deltaE(color.lab, other.lab))));
  const model = makeStyleModel(colors);
  const tree = model.edges.map(([from, to]) => deltaE(parsed[from].lab, parsed[to].lab));
  return { nearestMedian: median(nearest), nearestMax: Math.max(...nearest), treeMedian: median(tree), treeMax: Math.max(...tree), minChroma: Math.min(...parsed.map(color => color.lch.C)) };
}

test('the original Halton candidate pool and three attempts are retained for the historical forest input', () => {
  const result = generatePalette(WATERFOREST_WITNESS);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.stats, { sampled: 16000, gamutRejected: 1385, hardRejected: 3269, uniqueCandidates: 11333, attempts: 3 });
});

test('short-hue bridges preserve interpolated chroma and cross zero without taking the long arc', () => {
  const midpoint = interpolateStyleColor({ L: 0.5, C: 0.08, h: 350 }, { L: 0.8, C: 0.06, h: 30 }, 0.5);
  assert.equal(midpoint.h, 10);
  assert.ok(Math.abs(midpoint.C - 0.07) < 1e-12);
  assert.equal(midpoint.L, 0.65);
});

for (const [name, anchors, constraints] of [
  ['forest', WATERFOREST_ANCHORS, DEFAULT_CONSTRAINTS],
  ['clay', CLAY_ANCHORS, CLAY_CONSTRAINTS],
] as const) {
  test(`${name} generation keeps neighboring families and modest connecting steps across seeds`, context => {
    const measurements = [];
    for (const seed of ['style-01', 'style-02', 'style-03']) {
      const options = { anchors: [...anchors], constraints: { ...constraints }, domain: deriveStyleDomain(anchors), seed };
      const result = generatePalette(options);
      assert.equal(result.status, 'success', result.diagnostics.join('\n'));
      assert.deepEqual(result.colors.slice(0, anchors.length), anchors);
      assert.equal(validatePalette(result.colors, constraints, options.domain).valid, true);
      const summary = distribution(result.colors);
      measurements.push({ seed, ...summary });
      assert.ok(summary.nearestMedian >= 2 && summary.nearestMedian <= 5.5, JSON.stringify(summary));
      assert.ok(summary.nearestMax < 7.5, JSON.stringify(summary));
      assert.ok(summary.treeMax < 8.5, JSON.stringify(summary));
      assert.ok(summary.minChroma >= 0.032, JSON.stringify(summary));
      const hues = result.colors.map(hex => parseColor(hex)!.lch.h);
      if (name === 'forest') {
        assert.ok(hues.filter(h => h < 175).length >= 2, 'green family disappeared');
        assert.ok(hues.filter(h => h >= 175 && h < 215).length >= 4, 'cyan bridge disappeared');
        assert.ok(hues.filter(h => h >= 215).length >= 4, 'blue family disappeared');
      } else {
        assert.ok(hues.filter(h => h < 65).length >= 3, 'clay family disappeared');
        assert.ok(hues.filter(h => h >= 330).length >= 3, 'rose family disappeared');
        assert.ok(hues.filter(h => h >= 280 && h < 330).length >= 3, 'mauve bridge disappeared');
      }
    }
    context.diagnostic(JSON.stringify({ style: name, measurements }));
  });
}

test('a single primary explores all perceptual coordinates within its explicit nearby domain', () => {
  const primary = '#66A08F';
  const center = parseColor(primary)!;
  const result = generatePalette({ anchors: [primary], domain: deriveStyleDomain([primary]), constraints: { ...DEFAULT_CONSTRAINTS }, seed: 'single-style-directions' });
  assert.equal(result.status, 'success');
  const points = result.colors.map(hex => parseColor(hex)!.lch);
  assert.ok(points.every(point => Math.abs(shortHueDifference(center.lch.h, point.h)) <= 15));
  assert.ok(Math.max(...points.map(point => point.h)) - Math.min(...points.map(point => point.h)) >= 15);
  assert.ok(Math.max(...points.map(point => point.C)) - Math.min(...points.map(point => point.C)) >= 0.02);
  assert.ok(Math.max(...points.map(point => point.L)) - Math.min(...points.map(point => point.L)) >= 0.06);
});

test('style references remain soft: an explicit replacement domain is not vetoed by a hidden tube', () => {
  const domain: ColorDomain = { lightness: [0.5, 0.65], chroma: [0.04, 0.08], hue: [250, 280] };
  const result = regenerateSelected(['#66A08F'], [0], { domain, constraints: { ...DEFAULT_CONSTRAINTS }, seed: 'explicit-blue-domain' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(isInDomain(parseColor(result.colors[0])!, domain), true);
  assert.ok(deltaE(result.colors[0], '#66A08F') > 8);
});

test('replacement guides default to the complete original palette, including when every position is selected', () => {
  const original = generatePalette(WATERFOREST_WITNESS).colors;
  const options = { constraints: { ...DEFAULT_CONSTRAINTS }, domain: WATERFOREST_WITNESS.domain, seed: 'all-nearby' };
  const selected = original.map((_, index) => index);
  const implicit = regenerateSelected(original, selected, options);
  const explicit = regenerateSelected(original, selected, { ...options, styleAnchors: [...original] });
  assert.equal(implicit.status, 'success', implicit.diagnostics.join('\n'));
  assert.deepEqual(implicit, explicit);
  assert.ok(implicit.colors.every(hex => !original.includes(hex)));
  assert.ok(distribution(implicit.colors).treeMax < 8.5);
});

test('random additions use the current nearby style instead of choosing an unrelated hue', () => {
  let state = 7;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const primary = '#66A08F';
  const center = parseColor(primary)!;
  for (let index = 0; index < 20; index++) {
    const hex = sampleStyleColor([primary], random);
    assert.ok(hex);
    const color = parseColor(hex)!;
    assert.ok(Math.abs(shortHueDifference(center.lch.h, color.lch.h)) < 16);
    assert.ok(Math.abs(color.lch.L - center.lch.L) < 0.053);
    assert.ok(Math.abs(color.lch.C - center.lch.C) < 0.016);
  }
});
