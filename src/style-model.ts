import { deltaE, oklchToHex, oklchToOklab, parseColor, type ColorMetrics, type Lab, type Lch } from './color';
import { deriveDomainFromAnchors } from './presets';
import type { ColorDomain } from './types';

const wrap = (h: number) => ((h % 360) + 360) % 360;
export const shortHueDifference = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/** Soft style references for ranking the original candidate pool; these are not generation constraints. */
export interface StyleModel {
  anchors: ColorMetrics[];
  edges: [number, number][];
  knots: { lch: Lch; lab: Lab }[];
  radius: { lightness: number; chroma: number; hue: number };
}

/** Keep chroma on a short hue arc; a straight a/b chord would wash out the middle of a color bridge. */
export function interpolateStyleColor(from: Lch, to: Lch, t: number): Lch {
  const fromHue = from.C < 1e-6 ? to.h : from.h;
  const toHue = to.C < 1e-6 ? fromHue : to.h;
  return {
    L: from.L + (to.L - from.L) * t,
    C: from.C + (to.C - from.C) * t,
    h: wrap(fromHue + shortHueDifference(fromHue, toHue) * t),
  };
}

export function makeStyleModel(values: readonly string[]): StyleModel {
  const anchors = [...new Set(values)].map(parseColor).filter((color): color is ColorMetrics => !!color);
  const edges: [number, number][] = [];
  // Prim's MST connects nearby families without constructing every pairwise bridge.
  const visited = new Set<number>(anchors.length ? [0] : []);
  while (visited.size < anchors.length) {
    let next: [number, number] | null = null;
    let distance = Infinity;
    for (const from of visited) {
      anchors.forEach((color, to) => {
        if (visited.has(to)) return;
        const candidate = deltaE(anchors[from].lab, color.lab);
        if (candidate < distance) {
          distance = candidate;
          next = [from, to];
        }
      });
    }
    if (!next) break;
    edges.push(next);
    visited.add(next[1]);
  }
  const knots = anchors.map(color => ({ lch: { ...color.lch }, lab: { ...color.lab } }));
  for (const [from, to] of edges) {
    const segments = Math.max(1, Math.ceil(deltaE(anchors[from].lab, anchors[to].lab) / 4.5));
    for (let step = 1; step < segments; step++) {
      const lch = interpolateStyleColor(anchors[from].lch, anchors[to].lch, step / segments);
      knots.push({ lch, lab: oklchToOklab(lch) });
    }
  }
  // Adding a random primary to an already detailed palette uses a smaller local edit.
  const scale = anchors.length >= 10 ? 0.55 : 1;
  return { anchors, edges, knots, radius: { lightness: 0.05 * scale, chroma: 0.014 * scale, hue: 14 * scale } };
}

/** The add-primary helper uses small offsets; the generator itself retains its original domain sampling. */
export function sampleStylePoint(model: StyleModel, knot: number, coordinates: readonly number[]): Lch {
  const center = model.knots[knot].lch;
  const offset = coordinates.map(value => 2 * value - 1);
  // Non-neutral seeds keep a chroma floor. This does not "repair" a deliberately neutral primary.
  const chromaFloor = center.C > 0.025 ? center.C * 0.7 : 0;
  return {
    L: Math.max(0, Math.min(1, center.L + offset[0] * model.radius.lightness)),
    C: Math.max(chromaFloor, center.C + offset[1] * model.radius.chroma),
    h: wrap(center.h + offset[2] * model.radius.hue),
  };
}

export function closestStyleKnot(model: StyleModel, lab: Lab): number {
  let closest = 0;
  let minimum = Infinity;
  model.knots.forEach((knot, index) => {
    const distance = deltaE(knot.lab, lab);
    if (distance < minimum) {
      minimum = distance;
      closest = index;
    }
  });
  return closest;
}

/** Reuse the existing domain derivation, with a little more room when only one primary is supplied. */
export function deriveStyleDomain(values: readonly string[]): ColorDomain {
  return deriveDomainFromAnchors(values, values.length === 1 ? { lightness: 0.05, chroma: 0.02, hue: 15 } : {});
}

/** New random primaries stay near the existing style. Callers still audit their own hard constraints. */
export function sampleStyleColor(values: readonly string[], random: () => number = Math.random): string | null {
  const model = makeStyleModel(values);
  for (let attempt = 0; attempt < 100; attempt++) {
    const lch = model.knots.length
      ? sampleStylePoint(model, Math.min(model.knots.length - 1, Math.floor(random() * model.knots.length)), [random(), random(), random()])
      : { L: 0.52 + random() * 0.24, C: 0.045 + random() * 0.045, h: random() * 360 };
    const hex = oklchToHex(lch);
    if (hex && !values.includes(hex)) return hex;
  }
  return null;
}
