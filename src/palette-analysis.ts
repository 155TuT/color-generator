import { contrastFromLuminance, deltaE, parseColor } from './color';

export interface DistributionSummary {
  count: number;
  min: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
}

export interface HueFamily {
  name: string;
  /** Clockwise interval in degrees; a start larger than end crosses 0 degrees. */
  hue: [number, number];
}

/** R-7 linear interpolation: position = (n - 1) * probability. */
export function quantile(values: readonly number[], probability: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

export function summarize(values: readonly number[]): DistributionSummary {
  return {
    count: values.length,
    min: quantile(values, 0), p10: quantile(values, 0.1), p25: quantile(values, 0.25),
    median: quantile(values, 0.5), p75: quantile(values, 0.75), p90: quantile(values, 0.9),
    max: quantile(values, 1), mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

export function pearson(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index++) {
    const x = left[index] - leftMean;
    const y = right[index] - rightMean;
    covariance += x * y;
    leftVariance += x * x;
    rightVariance += y * y;
  }
  return leftVariance && rightVariance ? covariance / Math.sqrt(leftVariance * rightVariance) : null;
}

const normalizeHue = (hue: number) => {
  const normalized = ((hue % 360) + 360) % 360;
  // Subtracting the normalized arc start can leave -5e-14 degrees at its first point.
  // That is the start of the arc, not a spurious point one full turn away.
  return normalized < 1e-10 || normalized > 360 - 1e-10 ? 0 : normalized;
};

export function minimalHueArc(hues: readonly number[]): { start: number; end: number; span: number } {
  if (!hues.length) return { start: 0, end: 0, span: 0 };
  const sorted = hues.map(normalizeHue).sort((left, right) => left - right);
  let largestGap = -1;
  let start = sorted[0];
  for (let index = 0; index < sorted.length; index++) {
    const next = (index + 1) % sorted.length;
    const gap = next ? sorted[next] - sorted[index] : sorted[0] + 360 - sorted[index];
    if (gap > largestGap) { largestGap = gap; start = sorted[next]; }
  }
  const span = 360 - largestGap;
  return { start, end: normalizeHue(start + span), span };
}

function inHueFamily(hue: number, family: HueFamily): boolean {
  const [start, end] = family.hue;
  return end - start >= 360 || normalizeHue(hue - start) < normalizeHue(end - start);
}

/** Pure, deterministic descriptive analysis; it imposes no generator thresholds. */
export function analyzePalette(hexes: readonly string[], families: readonly HueFamily[] = []) {
  if (hexes.length < 2) throw new Error('Palette analysis requires at least two colors.');
  const colors = hexes.map((hex, index) => {
    const color = parseColor(hex);
    if (!color) throw new Error(`Invalid color at index ${index}: ${hex}`);
    return { index, ...color };
  });
  const distances = colors.map(() => colors.map(() => 0));
  const pairs: { left: number; right: number; deltaE: number; contrast: number }[] = [];
  for (let left = 0; left < colors.length; left++) {
    for (let right = left + 1; right < colors.length; right++) {
      const distance = deltaE(colors[left].lab, colors[right].lab);
      distances[left][right] = distances[right][left] = distance;
      pairs.push({ left, right, deltaE: distance, contrast: contrastFromLuminance(colors[left].luminance, colors[right].luminance) });
    }
  }
  const nearestNeighbors = colors.map(color => {
    const candidates = colors.filter(other => other.index !== color.index);
    const nearest = candidates.reduce((best, other) => distances[color.index][other.index] < distances[color.index][best.index] ? other : best);
    return { index: color.index, neighborIndex: nearest.index, deltaE: distances[color.index][nearest.index] };
  });
  // Prim's MST on full 3D OKLab distances; array order makes equal-distance ties deterministic.
  const connected = new Set([0]);
  const mstEdges: { left: number; right: number; deltaE: number }[] = [];
  while (connected.size < colors.length) {
    let next = { left: 0, right: 0, deltaE: Infinity };
    for (const left of connected) {
      for (const right of colors.map(color => color.index)) {
        if (!connected.has(right) && distances[left][right] < next.deltaE) next = { left, right, deltaE: distances[left][right] };
      }
    }
    mstEdges.push(next);
    connected.add(next.right);
  }
  const L = colors.map(color => color.lch.L);
  const C = colors.map(color => color.lch.C);
  const luminance = colors.map(color => color.luminance);
  const hueArc = minimalHueArc(colors.filter(color => color.lch.C > 1e-6).map(color => color.lch.h));
  const whiteContrasts = colors.map(color => ({ index: color.index, contrast: contrastFromLuminance(color.luminance, 1) }));
  const familyGroups = families.map(family => ({ ...family, indices: colors.filter(color => inHueFamily(color.lch.h, family)).map(color => color.index) }));
  return {
    colors, pairs, nearestNeighbors, mstEdges, whiteContrasts, families: familyGroups,
    distributions: {
      pairDeltaE: summarize(pairs.map(pair => pair.deltaE)),
      pairContrast: summarize(pairs.map(pair => pair.contrast)),
      nearestNeighborDeltaE: summarize(nearestNeighbors.map(neighbor => neighbor.deltaE)),
      mstDeltaE: summarize(mstEdges.map(edge => edge.deltaE)),
      lightness: summarize(L), chroma: summarize(C), luminance: summarize(luminance),
      unwrappedHue: summarize(colors.map(color => hueArc.start + normalizeHue(color.lch.h - hueArc.start))),
      whiteContrast: summarize(whiteContrasts.map(item => item.contrast)),
    },
    hueArc,
    correlations: {
      lightnessChromaPearson: pearson(L, C),
      luminanceChromaPearson: pearson(luminance, C),
      pairDeltaEContrastPearson: pearson(pairs.map(pair => pair.deltaE), pairs.map(pair => pair.contrast)),
    },
    whiteContrastCounts: {
      atLeast165: whiteContrasts.filter(item => item.contrast >= 1.65).length,
      atLeast3: whiteContrasts.filter(item => item.contrast >= 3).length,
      atLeast45: whiteContrasts.filter(item => item.contrast >= 4.5).length,
    },
  };
}
