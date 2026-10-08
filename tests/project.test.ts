import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, effectiveDomain, makeExample, snapshotProject } from '../src/project';
import { completePalette } from '../src/palette-workflow';
import { DEFAULT_CONSTRAINTS, DEFAULT_DOMAIN, WATERFOREST_COLORS, CLAY_COLORS } from '../src/presets';
import { isInDomain } from '../src/generator';
import { parseColor } from '../src/color';

test('new sessions start with a single unnamed empty palette', () => {
  const project = createProject();
  assert.equal('anchors' in project, false);
  assert.equal(project.name, '');
  assert.deepEqual(project.colors, []);
  assert.equal(project.domainMode, 'auto');
  assert.deepEqual(effectiveDomain(project), { lightness: [0, 1], chroma: [project.constraints.minChroma ?? 0, project.constraints.maxChroma], hue: [0, 360] });
});

test('sessions and both immutable examples own their nested state', () => {
  const first = createProject(), second = createProject();
  first.colors.push('#FFFFFF'); first.constraints.maxChroma = 0.3;
  assert.deepEqual(second.colors, []);
  assert.deepEqual(second.constraints, DEFAULT_CONSTRAINTS);
  for (const preset of ['forest', 'clay'] as const) {
    const example = makeExample(preset);
    const originalAnchors = [...example.anchors];
    example.anchors[0] = '#FFFFFF';
    example.colors[0] = '#FFFFFF'; example.domain.hue[0] = 0;
    assert.deepEqual(makeExample(preset).colors, preset === 'forest' ? WATERFOREST_COLORS : CLAY_COLORS);
    assert.deepEqual(makeExample(preset).anchors, originalAnchors);
  }
  assert.deepEqual(makeExample().domain, DEFAULT_DOMAIN);
});

test('automatic domain covers supplied colors while manual domain stays fixed and detached', () => {
  const project = createProject(); project.colors = ['#307D81'];
  project.domain = { lightness: [0, 1], chroma: [0, 0.4], hue: [0, 360] };
  assert.equal(isInDomain(parseColor(project.colors[0])!, effectiveDomain(project)), true);
  const previous = effectiveDomain(project); project.colors = ['#A2CAE7', '#66A08F'];
  assert.notDeepEqual(effectiveDomain(project), previous);
  assert.ok(project.colors.every(hex => isInDomain(parseColor(hex)!, effectiveDomain(project))));
  project.colors.pop();
  assert.equal(isInDomain(parseColor(project.colors[0])!, effectiveDomain(project)), true);
  project.domainMode = 'manual';
  const manual = effectiveDomain(project);
  assert.deepEqual(manual, project.domain);
  manual.lightness[0] = 0.5;
  assert.equal(project.domain.lightness[0], 0);
});

test('worker and export snapshots preserve effective domain and remain independent', () => {
  const project = createProject(); project.colors = [...WATERFOREST_COLORS];
  const snapshot = snapshotProject(project);
  assert.deepEqual(snapshot.domain, effectiveDomain(project));
  project.colors[0] = '#FFFFFF'; project.constraints.maxChroma = 0.2;
  assert.equal(snapshot.colors[0], WATERFOREST_COLORS[0]);
  assert.equal(snapshot.constraints.maxChroma, DEFAULT_CONSTRAINTS.maxChroma);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

for (const preset of ['forest', 'clay'] as const) {
  test(`completing ${preset} after deletion preserves every retained HEX and does not mutate the project`, () => {
    const example = makeExample(preset);
    const project = createProject();
    project.colors = example.colors.filter((_, index) => ![0, 5, 12, 24].includes(index));
    project.constraints = example.constraints;
    project.domainMode = 'auto';
    project.seed = 'retain-colors-' + preset;
    const before = structuredClone(project);
    const result = completePalette(project);
    assert.equal(result.status, 'success', result.diagnostics.join('\n'));
    assert.equal(result.colors.length, 25);
    assert.equal(new Set(result.colors).size, 25);
    assert.equal(result.validation.valid, true);
    assert.deepEqual(result.colors.slice(0, before.colors.length), before.colors);
    assert.deepEqual(project, before);
  });
}

test('invalid fixed colors and exhausted manual ranges do not silently replace colors', () => {
  for (const hex of ['#FF0000', '#66A08F']) {
    const project = createProject(); project.colors = [hex];
    if (hex === '#66A08F') {
      const { L, C, h } = parseColor(hex)!.lch;
      project.domainMode = 'manual';
      project.domain = { lightness: [L - 0.00001, L + 0.00001], chroma: [C - 0.00001, C + 0.00001], hue: [h - 0.00001, h + 0.00001] };
    }
    const before = structuredClone(project);
    const result = completePalette(project);
    assert.notEqual(result.status, 'success');
    assert.deepEqual(project, before);
    assert.equal(result.colors[0], hex);
    assert.ok(result.diagnostics.length > 0);
  }
});
