import assert from 'node:assert/strict';
import test from 'node:test';
import { parseColor } from '../src/color';
import { validatePalette } from '../src/generator';
import { analyzePalette } from '../src/palette-analysis';
import { runPaletteOperation } from '../src/palette-workflow';
import { createProject, effectiveDomain, type Project } from '../src/project';

test('single-root neighborhoods have radial depth instead of a constant-chroma ring or a shifted ring', context => {
  const measurements = [];
  for (const root of ['#7A5607', '#7A6068', '#66A08F', '#9090AB', '#F39E9D']) {
    for (const seed of ['radial-01', 'radial-02', 'radial-03']) {
      const input = createProject(); input.colors = [root]; input.seed = seed;
      const domain = effectiveDomain(input);
      const lower = input.constraints.minChroma ?? 0, upper = input.constraints.maxChroma;
      const radialWidth = Math.min(domain.chroma[1], upper) - Math.max(domain.chroma[0], lower);
      const result = runPaletteOperation(input, { kind: 'complete' });
      assert.equal(result.status, 'success', result.diagnostics.join('\n'));
      assert.equal(result.colors.length, 25);
      assert.equal(result.colors[0], root);
      assert.equal(validatePalette(result.colors, input.constraints, domain).valid, true);
      const output = analyzePalette(result.colors);
      const c = output.distributions.chroma;
      const std = Math.sqrt(output.colors.reduce((sum, color) => sum + (color.lch.C - c.mean) ** 2, 0) / output.colors.length);
      const spread = c.p90 - c.p10;
      const medianShift = c.median - parseColor(root)!.lch.C;
      const diagnostic = JSON.stringify({ root, seed, std, spread, radialWidth, medianShift });
      measurements.push(JSON.parse(diagnostic));
      assert.ok(spread >= radialWidth * 0.3, `insufficient radial spread: ${diagnostic}`);
      assert.ok(std >= radialWidth * 0.12, `too much mass remains on one radius: ${diagnostic}`);
      assert.ok(Math.abs(medianShift) <= radialWidth * 0.35, `the distribution moved away from its root instead of gaining depth: ${diagnostic}`);
      assert.ok(output.colors.filter(color => color.lch.C <= lower + 0.002).length <= 8, `colors accumulated at the hard floor: ${diagnostic}`);
      assert.ok(output.colors.filter(color => color.lch.C >= upper - 0.002).length <= 8, `colors accumulated at the hard ceiling: ${diagnostic}`);
      assert.ok(output.colors.every(color => color.lch.C >= lower && color.lch.C <= upper));
      assert.ok(output.distributions.mstDeltaE.max <= 6, `radial exploration disconnected the palette: ${diagnostic}`);
    }
  }
  context.diagnostic(JSON.stringify(measurements));
});

test('single-root radial exploration has the same prefix when added one step at a time', () => {
  const input = createProject(); input.colors = ['#7A5607']; input.seed = 'radial-prefix';
  const complete = runPaletteOperation(input, { kind: 'complete' });
  assert.equal(complete.status, 'success', complete.diagnostics.join('\n'));
  let current = structuredClone(input);
  while (current.colors.length < 25) {
    const step = runPaletteOperation(current, { kind: 'add' });
    assert.equal(step.status, 'success', step.diagnostics.join('\n'));
    current = { ...current, colors: step.colors, growth: step.growth };
    assert.deepEqual(current.colors, complete.colors.slice(0, current.colors.length));
  }
  assert.deepEqual(current.growth, complete.growth);
});

test('radial exploration remains a soft preference inside an explicitly narrow chroma range', () => {
  const input: Project = { ...createProject(), colors: ['#66A08F'], seed: 'radial-narrow-domain' };
  const center = parseColor(input.colors[0])!.lch.C;
  input.domain = effectiveDomain(input);
  input.domain.chroma = [center - 0.0005, center + 0.0005];
  input.domainMode = 'manual';
  const before = structuredClone(input);
  const result = runPaletteOperation(input, { kind: 'complete' });
  assert.equal(result.status, 'success', result.diagnostics.join('\n'));
  assert.equal(result.colors.length, 25);
  assert.equal(result.colors[0], input.colors[0]);
  assert.ok(result.colors.every(hex => Math.abs(parseColor(hex)!.lch.C - center) <= 0.0005));
  assert.equal(validatePalette(result.colors, input.constraints, input.domain).valid, true);
  assert.deepEqual(input, before);
});
