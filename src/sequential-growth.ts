import {
  contrastFromLuminance, deltaE, normalizeHex, oklchToHex, oklchToOklab, parseColor,
  type ColorMetrics, type Lch,
} from './color';
import { createCandidateChecker, halton, hueSpan, isInDomain, randomSource, validatePalette } from './generator';
import { DEFAULT_RANDOM_LIGHTNESS, defaultRandomDomain, deriveDomainFromAnchors } from './presets';
import { interpolateStyleColor, makeStyleModel, shortHueDifference } from './style-model';
import type { GrowthNode, GrowthOperation, GrowthResult, GrowthState } from './growth-types';
import type { Project } from './project';
import type { ColorDomain, GenerationStats } from './types';

const EPSILON = 1e-10;
const wrap = (h: number) => ((h % 360) + 360) % 360;
const emptyStats = (): GenerationStats => ({ sampled: 0, gamutRejected: 0, hardRejected: 0, uniqueCandidates: 0, attempts: 0 });
const emptyGrowth = (): GrowthState => ({ version: 1, nextOrder: 0, nodes: [], styleDomain: null, directions: [], referenceColors: [] });

function initialStyle(values: readonly string[], seed: string) {
  const colors = values.map(parseColor).filter((value): value is ColorMetrics => !!value);
  if (!colors.length) return { styleDomain: null, directions: [], referenceColors: [] };
  const domain = deriveDomainFromAnchors(values, {
    lightness: colors.length === 1 ? 0.12 : 0.04,
    chroma: 0.025,
    hue: 12,
  });
  const actual = deriveDomainFromAnchors(values, { lightness: 0, chroma: 0, hue: 0 });
  const colorful = colors.filter(color => color.lch.C > 1e-6);
  // Repeated floating-point hues may leave an almost-zero negative arc; it is not a full circle.
  const span = colorful.length
    ? Math.abs(actual.hue[1] - actual.hue[0]) < 1e-8 ? 0 : hueSpan(actual)
    : 0;
  const center = colorful.length
    ? wrap(actual.hue[0] + span / 2)
    : randomSource(seed + ':neutral-direction')() * 360;
  let directions: number[];
  if (colors.length === 1 || span < 45) {
    domain.hue = [wrap(center - 47), wrap(center + 47)];
    directions = [wrap(center - 35), center, wrap(center + 35)];
  } else {
    // Inner quantiles of the existing short-arc paths preserve the populated families.
    // Equal weight at the two envelope endpoints would turn a single accent into a third of the palette.
    const hueOffsets = makeStyleModel(values).knots
      .filter(knot => knot.lch.C > 1e-6)
      .map(knot => wrap(knot.lch.h - actual.hue[0]))
      .sort((a, b) => a - b);
    directions = [0.2, 0.5, 0.8].map(fraction => {
      const position = fraction * (hueOffsets.length - 1);
      const lower = Math.floor(position);
      const offset = hueOffsets[lower] + (hueOffsets[Math.ceil(position)] - hueOffsets[lower]) * (position - lower);
      return wrap(actual.hue[0] + offset);
    });
  }
  return { styleDomain: domain, directions, referenceColors: colors.map(color => color.hex) };
}

/** Keep generated-only continuations inside their lightness envelope without rewriting existing colors. */
function retainGeneratedLightness(domain: ColorDomain, nodes: readonly GrowthNode[], previous?: ColorDomain | null): void {
  if (!nodes.length || nodes.some(node => node.strategy === 'fixed')) return;
  const lightness = nodes.map(node => parseColor(node.hex)!.lch.L);
  const contains = (bounds: readonly [number, number]) => lightness.every(value =>
    value >= bounds[0] - EPSILON && value <= bounds[1] + EPSILON);
  // A deleted root must not gradually enlarge the surviving descendants' range.
  // A previous automatic envelope may be irrelevant to explicitly manual-domain growth.
  if (previous && contains(previous.lightness)) {
    domain.lightness = [Math.max(domain.lightness[0], previous.lightness[0]), Math.min(domain.lightness[1], previous.lightness[1])];
  }
  // Keep existing colors outside the default band, including explicit custom-domain results.
  // Redrawing the whole automatic palette starts inside the default band.
  if (contains(DEFAULT_RANDOM_LIGHTNESS)) {
    domain.lightness = [Math.max(domain.lightness[0], DEFAULT_RANDOM_LIGHTNESS[0]), Math.min(domain.lightness[1], DEFAULT_RANDOM_LIGHTNESS[1])];
  }
}

/** Match HEX queues so sorting and duplicate hand-edited colors cannot scramble birth order. */
export function synchronizeGrowth(project: Project): GrowthState {
  const previous = project.growth ? structuredClone(project.growth) : emptyGrowth();
  const queues = new Map<string, GrowthNode[]>();
  previous.nodes.forEach(node => queues.set(node.hex, [...(queues.get(node.hex) ?? []), node]));
  let nextOrder = previous.nextOrder;
  let changedInput = false;
  const nodes: GrowthNode[] = [];
  project.colors.forEach(value => {
    const hex = normalizeHex(value);
    if (!hex) return;
    const existing = queues.get(hex)?.shift();
    if (existing) nodes.push(existing);
    else {
      changedInput = true;
      nodes.push({ id: `color-${nextOrder}`, hex, birthOrder: nextOrder++, parentId: null, strategy: 'fixed', distance: null, branch: null });
    }
  });
  nodes.sort((left, right) => left.birthOrder - right.birthOrder);
  const liveIds = new Set(nodes.map(node => node.id));
  nodes.forEach(node => {
    if (node.parentId && !liveIds.has(node.parentId)) {
      node.parentId = null;
      node.distance = null;
    }
  });
  if (!nodes.length) return emptyGrowth();
  const rebuildStyle = changedInput || nodes.length < previous.nodes.length || !previous.styleDomain;
  const style = rebuildStyle ? initialStyle(nodes.map(node => node.hex), project.seed)
    : { styleDomain: previous.styleDomain, directions: previous.directions, referenceColors: previous.referenceColors };
  if (rebuildStyle && style.styleDomain) retainGeneratedLightness(style.styleDomain, nodes, previous.styleDomain);
  return { version: 1, nextOrder, nodes, ...style };
}

/** A stable style envelope makes repeated one-step actions identical to a single completion. */
export function automaticGrowthDomain(project: Project): ColorDomain {
  const growth = synchronizeGrowth(project);
  return growth.styleDomain ? structuredClone(growth.styleDomain) : defaultRandomDomain(project.constraints);
}

function branchFor(color: Pick<ColorMetrics, 'lch'>, directions: readonly number[]): number {
  let best = 0;
  directions.forEach((hue, index) => {
    if (Math.abs(shortHueDifference(hue, color.lch.h)) < Math.abs(shortHueDifference(directions[best], color.lch.h))) best = index;
  });
  return best;
}

function sampleRoot(project: Project, domain: ColorDomain, excluded: ReadonlySet<string>, stats: GenerationStats): string | null {
  const random = randomSource(project.seed + ':root');
  const offsets = [random(), random(), random()];
  const minimumChroma = Math.max(domain.chroma[0], project.constraints.minChroma ?? 0);
  const maximumChroma = Math.min(domain.chroma[1], project.constraints.maxChroma);
  if (minimumChroma > maximumChroma + EPSILON) return null;
  const checker = createCandidateChecker([], project.constraints, domain);
  const span = hueSpan(domain);
  stats.attempts++;
  for (let index = 1; index <= 16000; index++) {
    stats.sampled++;
    const hex = oklchToHex({
      L: domain.lightness[0] + ((halton(index, 2) + offsets[0]) % 1) * (domain.lightness[1] - domain.lightness[0]),
      C: Math.sqrt(minimumChroma ** 2 + ((halton(index, 3) + offsets[1]) % 1) * (maximumChroma ** 2 - minimumChroma ** 2)),
      h: wrap(domain.hue[0] + ((halton(index, 5) + offsets[2]) % 1) * span),
    });
    if (!hex) { stats.gamutRejected++; continue; }
    if (excluded.has(hex)) continue;
    // The first actual HEX obeys the same text, chroma and domain checks as every later color.
    if (!checker(hex).hardAllowed) {
      stats.hardRejected++; continue;
    }
    stats.uniqueCandidates++;
    return hex;
  }
  return null;
}

function nextColor(
  project: Project, state: GrowthState, domain: ColorDomain,
  excluded: ReadonlySet<string>, stats: GenerationStats,
): GrowthNode | null {
  const colors = state.nodes.map(node => parseColor(node.hex)!);
  const model = makeStyleModel(colors.map(color => color.hex));
  const reference = makeStyleModel(state.referenceColors);
  let longest: [number, number] | null = null;
  let longestDistance = 0;
  model.edges.forEach(edge => {
    const distance = deltaE(model.anchors[edge[0]].lab, model.anchors[edge[1]].lab);
    if (distance > longestDistance) { longestDistance = distance; longest = edge; }
  });
  // Estimate a local spacing from the reference envelope, always for 25 colors.
  // This is a soft density preference, never an instruction to fill the entire volume.
  const chromaHigh = Math.min(domain.chroma[1], project.constraints.maxChroma);
  const chromaLow = Math.max(domain.chroma[0], project.constraints.minChroma ?? 0);
  const volume = Math.max(0, domain.lightness[1] - domain.lightness[0])
    * Math.max(0, chromaHigh ** 2 - chromaLow ** 2) * hueSpan(domain) * Math.PI / 360;
  const preferredStep = Math.max(2.8, Math.min(4.4, 70 * Math.cbrt(volume / 25)), project.constraints.minDeltaE * 1.6);
  // One input expresses a nearby chroma band, not an exact-radius shell. Within one
  // local step of radial variation, let the existing distance and hue scores explore.
  const singleRootBand = reference.anchors.length === 1 ? {
    low: Math.max(chromaLow, reference.anchors[0].lch.C - Math.min(0.018, preferredStep / 200)),
    high: Math.min(chromaHigh, reference.anchors[0].lch.C + Math.min(0.018, preferredStep / 200)),
  } : null;
  const bridge = longest !== null && longestDistance > Math.max(5.2, preferredStep * 1.6, project.constraints.minDeltaE * 3.2);
  const edge: [number, number] | null = longest;
  const target: Lch | null = bridge && edge
    ? interpolateStyleColor(model.anchors[edge[0]].lch, model.anchors[edge[1]].lch, 0.5)
    : null;
  const targetLab = target ? oklchToOklab(target) : null;
  const occupancy = state.directions.map(() => 0);
  colors.forEach(color => occupancy[branchFor(color, state.directions)]++);
  // Multiple fixed inputs express their own family proportions. A rare end color is not
  // a request for an equally large family; a lone root has no such proportions to preserve.
  const branchMass = state.directions.map(() => reference.anchors.length > 1 ? 0.5 : 1);
  if (reference.anchors.length > 1) reference.knots.forEach(knot => {
    branchMass[branchFor(knot, state.directions)]++;
  });
  const totalMass = branchMass.reduce((sum, value) => sum + value, 0);
  const checker = createCandidateChecker(colors.map(color => color.hex), project.constraints, domain);
  const foreground = parseColor(project.constraints.textColor)!;
  const span = hueSpan(domain);
  const seen = new Set([...excluded, ...colors.map(color => color.hex)]);
  let best: { color: ColorMetrics; score: number; parent: number; distance: number; branch: number } | null = null;
  // Three deterministic sampling rounds choose this step only. No future target count enters the seed.
  for (let attempt = 0; attempt < 3; attempt++) {
    stats.attempts++;
    const random = randomSource(`${project.seed}:step:${state.nextOrder}:attempt:${attempt}`);
    const offsets = [random(), random(), random()];
    for (let index = 1; index <= 2048; index++) {
      stats.sampled++;
      const coordinates = [2, 3, 5].map((base, axis) => (halton(index, base) + offsets[axis]) % 1);
      const proposed = {
        L: domain.lightness[0] + coordinates[0] * (domain.lightness[1] - domain.lightness[0]),
        C: Math.sqrt(domain.chroma[0] ** 2 + coordinates[1] * (domain.chroma[1] ** 2 - domain.chroma[0] ** 2)),
        h: wrap(domain.hue[0] + coordinates[2] * span),
      };
      const hex = oklchToHex(proposed);
      if (!hex) { stats.gamutRejected++; continue; }
      if (seen.has(hex)) continue;
      seen.add(hex);
      const candidate = parseColor(hex)!;
      if (!isInDomain(candidate, domain) || candidate.lch.C > project.constraints.maxChroma + EPSILON
        || candidate.lch.C < (project.constraints.minChroma ?? 0) - EPSILON
        || contrastFromLuminance(candidate.luminance, foreground.luminance) < project.constraints.minTextContrast - EPSILON) {
        stats.hardRejected++; continue;
      }
      let nearest = Infinity;
      let parent = 0;
      let compatible = true;
      colors.forEach((color, colorIndex) => {
        const distance = deltaE(color.lab, candidate.lab);
        if (distance < nearest) { nearest = distance; parent = colorIndex; }
        if (distance < project.constraints.minDeltaE - EPSILON
          || contrastFromLuminance(candidate.luminance, color.luminance) > project.constraints.maxBackgroundContrast + EPSILON) compatible = false;
      });
      if (!compatible) { stats.hardRejected++; continue; }
      stats.uniqueCandidates++;
      // Bridging can span half a genuine gap; exploration must stay attached to its local parent.
      if (nearest > (bridge ? Math.max(6, longestDistance * 0.6) : Math.max(5.8, preferredStep * 1.8))) continue;
      const branch = branchFor(candidate, state.directions);
      const nearbyReference = reference.knots.reduce((bestKnot, knot) =>
        deltaE(candidate.lab, knot.lab) < deltaE(candidate.lab, bestKnot.lab) ? knot : bestKnot,
      reference.knots[0] ?? model.knots[0]);
      const chromaDeviation = singleRootBand
        ? 100 * (Math.max(0, singleRootBand.low - candidate.lch.C, candidate.lch.C - singleRootBand.high)
          + Math.max(0, singleRootBand.low - candidate.lch.C) * 0.25)
        : 100 * (Math.abs(candidate.lch.C - nearbyReference.lch.C)
          + Math.max(0, nearbyReference.lch.C - candidate.lch.C) * 0.25);
      // Nearby directions describe overlapping bands, not narrow attracting columns.
      // Adjacent single-root centers are 35 degrees apart; these soft bands join between them.
      const hueGoal = Math.max(0, Math.abs(shortHueDifference(state.directions[branch], candidate.lch.h)) - 18);
      const score = targetLab
        ? deltaE(candidate.lab, targetLab) * 2 + chromaDeviation * 0.4 + Math.abs(nearest - longestDistance / 2) * 0.15
        : Math.abs(nearest - preferredStep) * 1.6
          + occupancy[branch] / (branchMass[branch] / totalMass * state.directions.length) * 0.25
          + chromaDeviation * 0.8 + hueGoal * 0.014;
      if ((!best || score < best.score) && checker(hex).hardAllowed) best = { color: candidate, score, parent, distance: nearest, branch };
    }
  }
  if (!best) return null;
  return {
    id: `color-${state.nextOrder}`, hex: best.color.hex, birthOrder: state.nextOrder,
    parentId: state.nodes[best.parent].id, strategy: bridge ? 'bridge' : 'explore',
    distance: best.distance, branch: best.branch,
  };
}

/** One transition, completion and replacement share exactly the same ordered growth path. */
export function growPalette(project: Project, operation: GrowthOperation): GrowthResult {
  const original = [...project.colors];
  const inputState = synchronizeGrowth(project);
  const stats = emptyStats();
  const seed = String(project.seed);
  const originalDomain = project.domainMode === 'manual' ? structuredClone(project.domain) : automaticGrowthDomain(project);
  const originalValidation = validatePalette(original, project.constraints, originalDomain);
  const failure = (messages: string[], partialColors?: string[]): GrowthResult => ({
    status: 'failure', colors: original, growth: inputState, changedIndices: [],
    validation: originalValidation, seed, stats, diagnostics: messages, partialColors,
  });
  const configuration = validatePalette([], project.constraints, project.domainMode === 'manual' ? project.domain : undefined);
  if (!configuration.valid) return failure(configuration.issues.map(issue => issue.message));
  if (original.length > 25) return failure(['当前色板超过 25 色，无法继续生成。']);
  const selected = [...new Set(operation.indices ?? [])].sort((a, b) => a - b);
  if (operation.kind === 'randomize' && (!selected.length || selected.some(index => !Number.isInteger(index) || index < 0 || index >= original.length))) {
    return failure(['请选择有效的颜色后重新随机抽取。']);
  }
  if (operation.kind === 'add' && original.length >= 25) return failure(['色板已满 25 色。']);
  const replace = operation.kind === 'randomize';
  const reset = replace && selected.length === original.length;
  const selectedSet = new Set(selected);
  const fixed = replace ? original.filter((_, index) => !selectedSet.has(index)) : original;
  let state = reset ? emptyGrowth() : synchronizeGrowth({ ...project, colors: fixed, growth: inputState });
  // Partial replacement keeps the prior envelope and reference, including the selected positions.
  if (replace && !reset) state = {
    ...state, styleDomain: structuredClone(inputState.styleDomain),
    directions: [...inputState.directions], referenceColors: [...inputState.referenceColors],
  };
  const targetCount = operation.kind === 'complete' ? 25 : operation.kind === 'add' ? original.length + 1 : original.length;
  const excluded = new Set(replace ? original.map(value => normalizeHex(value)!).filter(Boolean) : []);
  const appended: string[] = [];
  let domain = project.domainMode === 'manual' || (replace && !reset)
    ? structuredClone(originalDomain)
    : state.styleDomain ? structuredClone(state.styleDomain) : automaticGrowthDomain({ ...project, colors: [], growth: undefined });

  while (state.nodes.length < targetCount) {
    if (Math.max(domain.chroma[0], project.constraints.minChroma ?? 0)
      > Math.min(domain.chroma[1], project.constraints.maxChroma) + EPSILON) {
      return failure(['生成范围的彩度区间与硬性彩度范围没有交集，请调整彩度边界。'], appended);
    }
    if (!state.nodes.length) {
      const hex = sampleRoot(project, domain, excluded, stats);
      if (!hex) return failure(['当前生成范围与文字对比、彩度约束下，有限采样没有找到可用的 sRGB 首色；原色板保持不变。']);
      const style = initialStyle([hex], seed);
      state = { version: 1, nextOrder: 1, nodes: [{
        id: 'color-0', hex, birthOrder: 0, parentId: null, strategy: 'seed', distance: null, branch: 1,
      }], ...style };
      appended.push(hex);
      if (project.domainMode === 'auto') {
        retainGeneratedLightness(state.styleDomain!, state.nodes);
        domain = structuredClone(state.styleDomain!);
      }
      continue;
    }
    const baseline = validatePalette(state.nodes.map(node => node.hex), project.constraints, domain);
    if (!baseline.valid) return failure([
      ...baseline.issues.map(issue => issue.message),
      '已有颜色不满足后续生成规则；请调整颜色或规则后继续，原色板保持不变。',
    ], appended);
    const node = nextColor(project, state, domain, excluded, stats);
    if (!node) return failure([
      `本次有限搜索在 ${state.nodes.length}/${targetCount} 色处停止，未降低色差、对比或彩度约束。`,
      '未找到完整结果，原色板保持不变；可调整生成范围，或随机更换选中颜色后重试。',
    ], appended);
    state.nodes.push(node);
    state.nextOrder++;
    appended.push(node.hex);
  }
  let colors = [...original, ...appended];
  let changedIndices = appended.map((_, index) => original.length + index);
  if (replace) {
    colors = [...original];
    selected.forEach((index, replacementIndex) => { colors[index] = appended[replacementIndex]; });
    changedIndices = selected;
  }
  const validation = validatePalette(colors, project.constraints, domain);
  if (!validation.valid) return failure(validation.issues.map(issue => issue.message), appended);
  const diagnostics = colors.length === 1
    ? ['首色已通过生成范围、文字对比与彩度约束的实际 HEX 检查。']
    : [`按出生顺序完成 ${appended.length} 步：远处补衔接，近处沿相邻色系探索；实际 HEX 通过全部硬约束。`];
  return { status: 'success', colors, validation, diagnostics, seed, stats, growth: state, changedIndices,
    ...(reset ? { domainMode: project.domainMode } : {}) };
}
