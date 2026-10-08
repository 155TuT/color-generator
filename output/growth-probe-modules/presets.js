import { parseColor } from './color.js';
export const DEFAULT_CONSTRAINTS = {
    minDeltaE: 1.4,
    maxBackgroundContrast: 3,
    textColor: '#FFFFFF',
    minTextContrast: 1.65,
    minChroma: 0.03,
    maxChroma: 0.11,
};
/** A cylindrical envelope defined only by the supplied primary colors and explicit padding. */
export function deriveDomainFromAnchors(anchors, padding = {}) {
    const colors = anchors.map(parseColor).filter(color => color !== null);
    if (!colors.length)
        return { lightness: [0.45, 0.82], chroma: [0.035, 0.11], hue: [0, 360] };
    const lightnessPadding = padding.lightness ?? 0.015;
    const chromaPadding = padding.chroma ?? 0.02;
    const huePadding = padding.hue ?? 5;
    const lightness = colors.map(color => color.lch.L);
    const chroma = colors.map(color => color.lch.C);
    const hues = colors
        .filter(color => color.lch.C > 1e-6)
        .map(color => color.lch.h)
        .sort((a, b) => a - b);
    let hue = [0, 360];
    if (hues.length) {
        let largestGap = -1;
        let cut = 0;
        for (let index = 0; index < hues.length; index++) {
            const next = (index + 1) % hues.length;
            const gap = next === 0 ? hues[0] + 360 - hues[index] : hues[next] - hues[index];
            if (gap > largestGap) {
                largestGap = gap;
                cut = next;
            }
        }
        const coveredArc = 360 - largestGap;
        if (coveredArc + 2 * huePadding < 360) {
            const start = hues[cut] - huePadding;
            const end = hues[cut] + coveredArc + huePadding;
            hue = [((start % 360) + 360) % 360, ((end % 360) + 360) % 360];
        }
    }
    return {
        lightness: [
            Math.max(0, Math.min(...lightness) - lightnessPadding),
            Math.min(1, Math.max(...lightness) + lightnessPadding),
        ],
        chroma: [Math.max(0, Math.min(...chroma) - chromaPadding), Math.min(0.4, Math.max(...chroma) + chromaPadding)],
        hue,
    };
}
// Five primaries define the generator domain. The 25-color reference below is never a candidate source.
export const WATERFOREST_ANCHORS = ['#307D81', '#66A08F', '#5BB3DD', '#A1C7A1', '#A2CAE7'];
export const DEFAULT_DOMAIN = deriveDomainFromAnchors(WATERFOREST_ANCHORS);
export const WATERFOREST_COLORS = [
    '#307D81',
    '#38848D',
    '#4E7790',
    '#41888C',
    '#3E8D9B',
    '#5689A5',
    '#519196',
    '#4A96AD',
    '#5A9DBD',
    '#619AA0',
    '#5CA5B3',
    '#5CA8CD',
    '#66A08F',
    '#75AAB1',
    '#5BB3DD',
    '#7CAF94',
    '#87B9C1',
    '#79BDDE',
    '#8CB7A5',
    '#92BAC5',
    '#9AC3D7',
    '#91C5C6',
    '#9AD1CD',
    '#A2CAE7',
    '#A1C7A1',
];
export const WATERFOREST_REFERENCE = WATERFOREST_COLORS;
/** User-supplied immutable example; preserve its original order and exact sRGB values. */
export const CLAY_COLORS = [
    '#8F5E5F', '#8D5270', '#7A6068', '#947374', '#916582',
    '#7F7689', '#A98582', '#AD6D71', '#A0799B', '#B99799',
    '#D07A88', '#7D89AB', '#D39BA0', '#DB8994', '#B289A8',
    '#D0A48E', '#C6A5B6', '#AA9CC6', '#F39E9D', '#DFA5B9',
    '#D4B8CE', '#E3A8A1', '#D8B4BB', '#E5B9D3', '#E6B99E',
];
// Six engineering representatives of clay, rose, mauve and muted blue.
// They are editable starting inputs when explicitly loaded, never a hidden candidate source.
export const CLAY_ANCHORS = ['#8F5E5F', '#916582', '#7D89AB', '#D07A88', '#D4B8CE', '#E6B99E'];
// The example envelope covers all original colors; explicitly taking its primaries also loads this envelope.
export const CLAY_DOMAIN = deriveDomainFromAnchors(CLAY_COLORS);
export const CLAY_CONSTRAINTS = { ...DEFAULT_CONSTRAINTS, maxBackgroundContrast: 3.5 };
export const CLAY_REFERENCE = CLAY_COLORS;
export const WATERFOREST_WITNESS = {
    anchors: [...WATERFOREST_ANCHORS],
    constraints: { ...DEFAULT_CONSTRAINTS },
    domain: deriveDomainFromAnchors(WATERFOREST_ANCHORS),
    seed: 'waterforest-01',
    targetCount: 25,
    sampleCount: 16000,
};
