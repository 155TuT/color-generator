import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const output = new URL('docs/analysis/', root);
const temporary = await mkdtemp(join(tmpdir(), 'color-generator-analysis-'));
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const f = (value, digits = 2) => Number(value.toFixed(digits));

try {
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const name of ['color', 'presets', 'palette-analysis']) {
    const source = await readFile(new URL(`src/${name}.ts`, root), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await writeFile(join(temporary, `${name}.js`), result.outputText.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, '$1$2.js$3'));
  }
  const { analyzePalette, minimalHueArc, quantile } = await import(pathToFileURL(join(temporary, 'palette-analysis.js')).href);
  assert.equal(quantile([0, 10, 20, 30], .5), 15);
  assert.equal(quantile([0, 10, 20, 30], .9), 27);
  assert.deepEqual(minimalHueArc([350, 5, 20]), { start: 350, end: 20, span: 30 });
  const monochrome = analyzePalette(['#000000', '#FFFFFF']);
  assert.equal(monochrome.pairs[0].contrast, 21);
  assert.equal(monochrome.mstEdges.length, 1);
  assert.equal(monochrome.nearestNeighbors[0].neighborIndex, 1);
  assert.equal(monochrome.nearestNeighbors[1].neighborIndex, 0);
  const { WATERFOREST_COLORS, WATERFOREST_ANCHORS, CLAY_COLORS, CLAY_ANCHORS } = await import(pathToFileURL(join(temporary, 'presets.js')).href);
  const palettes = [
    {
      key: 'waterforest', name: '水雾森林', colors: WATERFOREST_COLORS, anchors: WATERFOREST_ANCHORS,
      families: [{ name: '雾绿', hue: [125, 175] }, { name: '蓝绿', hue: [175, 215] }, { name: '雾蓝', hue: [215, 270] }],
    },
    {
      key: 'clay', name: '暮山陶土', colors: CLAY_COLORS, anchors: CLAY_ANCHORS,
      families: [{ name: '陶土', hue: [15, 65] }, { name: '玫瑰', hue: [350, 15] }, { name: '藕紫', hue: [285, 350] }, { name: '灰蓝', hue: [245, 285] }],
    },
  ].map(palette => ({ ...palette, analysis: analyzePalette(palette.colors, palette.families) }));
  for (const palette of palettes) {
    assert.equal(palette.colors.length, 25);
    assert.equal(new Set(palette.colors).size, 25);
    assert.equal(palette.analysis.pairs.length, 300);
    assert.equal(palette.analysis.nearestNeighbors.length, 25);
    assert.equal(palette.analysis.mstEdges.length, 24);
    assert.equal(palette.analysis.families.flatMap(family => family.indices).length, 25);
    assert.equal(new Set(palette.analysis.families.flatMap(family => family.indices)).size, 25);
    const reversed = analyzePalette([...palette.colors].reverse());
    for (const name of ['pairDeltaE', 'pairContrast', 'nearestNeighborDeltaE', 'mstDeltaE']) {
      assert.ok(Math.abs(reversed.distributions[name].median - palette.analysis.distributions[name].median) < 1e-10);
      assert.ok(Math.abs(reversed.distributions[name].max - palette.analysis.distributions[name].max) < 1e-10);
    }
  }
  await mkdir(output, { recursive: true });
  const data = {
    schemaVersion: 1,
    source: 'Exact sRGB hex arrays in src/presets.ts; no sampling, fitting or color changes.',
    method: {
      distance: '100 * Euclidean distance in OKLab (not CIEDE2000)',
      contrast: '(max(relativeLuminance) + 0.05) / (min(relativeLuminance) + 0.05), sRGB linearized',
      quantiles: 'R-7 linear interpolation, position = (n - 1) * probability',
      nearestNeighbors: 'Each point contributes one distance; a mutual pair appears twice.',
      mst: 'Prim MST over complete graph, full 3D OKLab distance; SVG is a 2D projection.',
      hue: 'Smallest clockwise arc after removing largest empty hue gap; 0 degrees is a continuous seam.',
      families: 'Named human interpretation using declared hue intervals, not data-derived discrete clusters.',
    },
    palettes,
  };
  await writeFile(new URL('palettes.json', output), `${JSON.stringify(data, null, 2)}\n`);

  const W = 1320;
  const H = 1180;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="水雾森林与暮山陶土在OKLab和OKLCh中的分布及最小生成树">`,
    '<style>text{font-family:Segoe UI,Microsoft YaHei,sans-serif;fill:#293437} .label{font-size:12px}.point-index{font-size:10px}.sub{font-size:14px;fill:#59676a}.grid{stroke:#dce3e4;stroke-width:1}.edge{stroke:#71858c;stroke-width:1.3;opacity:.6}.dot{stroke:#fff;stroke-width:2}</style>',
    `<rect width="${W}" height="${H}" fill="#fafbfa"/>`,
    '<text x="42" y="42" font-size="25" font-weight="600">紧邻而可融合：两套 25 色的空间分布</text>',
    '<text x="42" y="69" class="sub">圆点保留原始 HEX；序号对应输入顺序。连线为完整三维 OKLab 最小生成树的投影，投影长度不等于真实色差。</text>',
  ];
  const line = (x1, y1, x2, y2, cls = 'grid') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="${cls}"/>`;
  const text = (x, y, content, cls = 'label', extra = '') => `<text x="${f(x)}" y="${f(y)}" class="${cls}" ${extra}>${escapeXml(content)}</text>`;
  palettes.forEach((palette, row) => {
    const top = 120 + row * 500;
    const analysis = palette.analysis;
    svg.push(text(42, top - 8, palette.name, '', 'font-size="21" font-weight="600"'));
    svg.push(text(42, top + 16, `最近邻中位 ${f(analysis.distributions.nearestNeighborDeltaE.median)} · P90 ${f(analysis.distributions.nearestNeighborDeltaE.p90)} · MST 最大边 ${f(analysis.distributions.mstDeltaE.max)} (ΔEOK×100)`, 'sub'));
    const plots = [
      { x: 115, y: top + 58, w: 320, h: 320, title: 'a–b 平面：色系关系（等比例）', xName: 'a：绿 ← → 红', yName: 'b：蓝 ← → 黄', xMin: -.12, xMax: .12, yMin: -.12, yMax: .12, getX: color => color.lab.a, getY: color => color.lab.b, xTicks: [-.12, -.06, 0, .06, .12], yTicks: [-.12, -.06, 0, .06, .12], numbered: false },
      { x: 690, y: top + 58, w: 555, h: 320, title: 'h–L 平面：连续色相与明度', xName: '展开色相 h（°；360° = 0°）', yName: 'OKLab L', xMin: row ? 245 : 125, xMax: row ? 425 : 265, yMin: .45, yMax: .90, getX: color => row && color.lch.h < 245 ? color.lch.h + 360 : color.lch.h, getY: color => color.lch.L, xTicks: row ? [250, 285, 320, 360, 400] : [130, 160, 190, 220, 250], yTicks: [.45, .55, .65, .75, .85, .90], numbered: true },
    ];
    plots.forEach(plot => {
      const X = value => plot.x + (value - plot.xMin) / (plot.xMax - plot.xMin) * plot.w;
      const Y = value => plot.y + plot.h - (value - plot.yMin) / (plot.yMax - plot.yMin) * plot.h;
      svg.push(text(plot.x, plot.y - 13, plot.title, 'sub'));
      plot.xTicks.forEach(tick => { svg.push(line(X(tick), plot.y, X(tick), plot.y + plot.h)); svg.push(text(X(tick), plot.y + plot.h + 20, tick, 'label', 'text-anchor="middle"')); });
      plot.yTicks.forEach(tick => { svg.push(line(plot.x, Y(tick), plot.x + plot.w, Y(tick))); svg.push(text(plot.x - 9, Y(tick) + 4, tick, 'label', 'text-anchor="end"')); });
      svg.push(text(plot.x + plot.w / 2, plot.y + plot.h + 43, plot.xName, 'label', 'text-anchor="middle"'));
      svg.push(text(plot.x - 59, plot.y + plot.h / 2, plot.yName, 'label', `text-anchor="middle" transform="rotate(-90 ${plot.x - 59} ${plot.y + plot.h / 2})"`));
      analysis.mstEdges.forEach(edge => {
        const a = analysis.colors[edge.left]; const b = analysis.colors[edge.right];
        svg.push(line(X(plot.getX(a)), Y(plot.getY(a)), X(plot.getX(b)), Y(plot.getY(b)), 'edge'));
      });
      analysis.colors.forEach(color => {
        const x = X(plot.getX(color)); const y = Y(plot.getY(color));
        svg.push(`<g><title>${color.index + 1} ${color.hex} L=${f(color.lch.L, 4)} C=${f(color.lch.C, 4)} h=${f(color.lch.h)}°</title><circle cx="${f(x)}" cy="${f(y)}" r="${plot.numbered ? 8 : 6}" fill="${color.hex}" class="dot"/>${plot.numbered ? text(x + 10, y - 4, color.index + 1, 'point-index') : ''}</g>`);
      });
    });
    svg.push(text(42, top + 445, `全 300 对色差中位 ${f(analysis.distributions.pairDeltaE.median)}，P90 ${f(analysis.distributions.pairDeltaE.p90)}；底色间对比度中位 ${f(analysis.distributions.pairContrast.median)}，P90 ${f(analysis.distributions.pairContrast.p90)}。`, 'sub'));
    svg.push(text(42, top + 468, `C 中位 ${f(analysis.distributions.chroma.median, 3)}；L–C Pearson r = ${f(analysis.correlations.lightnessChromaPearson, 3)}；色相沿最短覆盖弧展开，避免把跨 0° 的陶土与玫瑰割裂。`, 'sub'));
  });
  svg.push('<text x="42" y="1162" class="label">复现：node scripts/analyze-palettes.mjs · 数据：docs/analysis/palettes.json · 量化分析不等同于审美评价或视觉可访问性认证。</text></svg>');
  await writeFile(new URL('palette-distributions.svg', output), `${svg.join('\n')}\n`);
  for (const palette of palettes) {
    console.log(palette.name, JSON.stringify({ distributions: palette.analysis.distributions, hueArc: palette.analysis.hueArc, correlations: palette.analysis.correlations, whiteContrastCounts: palette.analysis.whiteContrastCounts, families: palette.analysis.families, colors: palette.analysis.colors.map(color => ({ hex: color.hex, L: f(color.lch.L, 3), C: f(color.lch.C, 3), h: f(color.lch.h, 1) })) }, null, 2));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
