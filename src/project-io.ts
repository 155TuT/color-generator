import { normalizeHex } from './color';
import { validatePalette } from './generator';
import type { GrowthNode, GrowthState } from './growth-types';
import { snapshotProject, type Project } from './project';
import { synchronizeGrowth } from './sequential-growth';
import type { ColorDomain, ConstraintConfig } from './types';

export const PROJECT_JSON_MAX_BYTES = 1_048_576;
const MAX_ORDER = Number.MAX_SAFE_INTEGER - 25;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

function invalid(message: string): never {
  throw new Error(`无法导入：${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}必须是对象。`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(`${label}需要 ${min}–${max} 范围内的有限数值。`);
  }
  return value;
}

function integer(value: unknown, label: string, max = MAX_ORDER): number {
  const result = finite(value, label, 0, max);
  if (!Number.isSafeInteger(result)) invalid(`${label}必须是非负整数。`);
  return result;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 4096) invalid(`${label}必须是长度不超过 4096 的文字。`);
  return value;
}

function hex(value: unknown, label: string): string {
  const result = typeof value === 'string' ? normalizeHex(value) : null;
  if (!result) invalid(`${label}需要有效的三位或六位 HEX。`);
  return result;
}

function colors(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 25) invalid(`${label}必须是包含 0–25 个颜色的数组。`);
  return value.map((entry, index) => hex(entry, `${label}第 ${index + 1} 色`));
}

function domain(value: unknown, label: string): ColorDomain {
  const source = record(value, label);
  const range = (key: keyof ColorDomain, maximum: number): [number, number] => {
    const pair = source[key];
    if (!Array.isArray(pair) || pair.length !== 2) invalid(`${label}.${key}必须包含两个边界数值。`);
    const result: [number, number] = [finite(pair[0], `${label}.${key}下界`, 0, maximum),
      finite(pair[1], `${label}.${key}上界`, 0, maximum)];
    if (key !== 'hue' && result[0] > result[1]) invalid(`${label}.${key}下界不能大于上界。`);
    return result;
  };
  return { lightness: range('lightness', 1), chroma: range('chroma', 0.4), hue: range('hue', 360) };
}

function constraints(value: unknown): ConstraintConfig {
  const source = record(value, '规则');
  return {
    minDeltaE: finite(source.minDeltaE, '色差下限', 0, Number.MAX_VALUE),
    maxBackgroundContrast: finite(source.maxBackgroundContrast, '底色对比上限', 1, 21),
    textColor: hex(source.textColor, '文字颜色'),
    minTextContrast: finite(source.minTextContrast, '最低文字对比', 1, 21),
    ...(source.minChroma === undefined ? {} : { minChroma: finite(source.minChroma, '彩度下限', 0, 0.4) }),
    maxChroma: finite(source.maxChroma, '彩度上限', 0, 0.4),
  };
}

function growth(value: unknown, palette: string[]): GrowthState {
  const source = record(value, '生成记录');
  if (source.version !== 1) invalid('不支持此生成记录版本。');
  const nextOrder = integer(source.nextOrder, '下一出生序号');
  if (!Array.isArray(source.nodes) || source.nodes.length !== palette.length) {
    invalid('生成记录的节点数量必须与色板一致。');
  }
  if (!Array.isArray(source.directions) || source.directions.length > 25) invalid('颜色方向必须是至多 25 项的数组。');
  const directions = source.directions.map((direction, index) => finite(direction, `第 ${index + 1} 个颜色方向`, 0, 360));
  const referenceColors = colors(source.referenceColors, '生成参考颜色');
  const styleDomain = source.styleDomain === null ? null : domain(source.styleDomain, '生成范围');
  if (palette.length && styleDomain && (!directions.length || !referenceColors.length)) {
    invalid('非空生成范围必须保留颜色方向和参考颜色。');
  }
  if (!palette.length && (nextOrder !== 0 || styleDomain || directions.length || referenceColors.length)) {
    invalid('空色板的生成记录必须为空。');
  }

  const nodes: GrowthNode[] = source.nodes.map((entry, index) => {
    const node = record(entry, `第 ${index + 1} 个生成节点`);
    const birthOrder = integer(node.birthOrder, '出生序号');
    const id = string(node.id, '节点 ID');
    // The engine derives future IDs from nextOrder; matching this convention prevents collisions.
    if (id !== `color-${birthOrder}`) invalid('节点 ID 与出生序号不一致。');
    if (birthOrder >= nextOrder) invalid('下一出生序号必须大于全部现有节点。');
    const strategy = node.strategy;
    if (strategy !== 'fixed' && strategy !== 'seed' && strategy !== 'bridge' && strategy !== 'explore') {
      invalid('生成节点的策略无效。');
    }
    const parentId = node.parentId === null ? null : string(node.parentId, '父节点 ID');
    const distance = node.distance === null ? null : finite(node.distance, '父子色差', 0, Number.MAX_VALUE);
    const branch = node.branch === null ? null : integer(node.branch, '颜色方向下标', Math.max(0, directions.length - 1));
    if ((parentId === null) !== (distance === null)) invalid('父节点和父子色差必须同时存在或同时为空。');
    if ((strategy === 'fixed' || strategy === 'seed') && parentId !== null) invalid('起点不能具有父节点。');
    if (strategy === 'fixed' && branch !== null) invalid('手动起点不应具有生成方向下标。');
    if (branch !== null && !directions.length) invalid('生成方向下标没有对应方向。');
    return { id, hex: hex(node.hex, '生成节点颜色'), birthOrder, parentId, strategy, distance, branch };
  });

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  if (nodeById.size !== nodes.length) invalid('生成节点 ID 或出生序号重复。');
  const paletteCounts = new Map<string, number>();
  palette.forEach(color => paletteCounts.set(color, (paletteCounts.get(color) ?? 0) + 1));
  for (const node of nodes) {
    const count = paletteCounts.get(node.hex) ?? 0;
    if (!count) invalid('生成记录的颜色与色板不一致。');
    paletteCounts.set(node.hex, count - 1);
    if (node.parentId !== null) {
      const parent = nodeById.get(node.parentId);
      // Strictly earlier parents rule out missing parents, self references and cycles.
      if (!parent || parent.birthOrder >= node.birthOrder) invalid('父节点必须存在且早于子节点出生。');
    }
  }
  // Preserve exported order, history, frozen directions and reference colors verbatim after HEX normalization.
  return { version: 1, nextOrder, nodes, styleDomain, directions, referenceColors };
}

/** Accept saved projects, not executable metadata or precomputed audits. */
export function parseProjectJson(text: string): Project {
  if (new TextEncoder().encode(text).byteLength > PROJECT_JSON_MAX_BYTES) invalid('JSON 文件不能超过 1 MB。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''), (key, value: unknown) => {
      if (unsafeKeys.has(key)) invalid('文件包含不允许的对象键。');
      return value;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('无法导入：')) throw error;
    invalid('文件不是有效的 JSON。');
  }
  const source = record(parsed, '色板文件');
  if (source.version !== 1) invalid('仅支持 version 为 1 的色板文件。');
  if (source.domainMode !== 'auto' && source.domainMode !== 'manual') invalid('生成范围模式必须是 auto 或 manual。');
  const project: Project = {
    version: 1,
    name: string(source.name, '色板名称'),
    colors: colors(source.colors, '色板'),
    constraints: constraints(source.constraints),
    domain: domain(source.domain, '色板范围'),
    seed: string(source.seed, '生成种子'),
    domainMode: source.domainMode,
  };
  if (source.growth !== undefined) project.growth = growth(source.growth, project.colors);
  else {
    // Projects without ancestry keep every supplied color fixed and retain their saved effective range.
    project.growth = synchronizeGrowth(project);
    if (project.colors.length && project.domainMode === 'auto') project.growth.styleDomain = structuredClone(project.domain);
  }
  return project;
}

/** JSON and its import share the same project fields; audits are always recalculated from actual HEX. */
export function buildProjectExport(project: Project, name = project.name, exportedAt = new Date().toISOString()) {
  const output = { ...snapshotProject(project), name };
  return { ...output, exportedAt, algorithm: 'oklch-adaptive-growth-v3',
    metrics: validatePalette(output.colors, output.constraints, output.domain) };
}
