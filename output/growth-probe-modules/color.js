export const normalizeHex = (value) => {
    if (typeof value !== 'string')
        return null;
    const bare = value.trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(bare)) {
        return `#${bare
            .split('')
            .map(channel => channel + channel)
            .join('')
            .toUpperCase()}`;
    }
    return /^[\da-f]{6}$/i.test(bare) ? `#${bare.toUpperCase()}` : null;
};
const srgbToLinear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (value) => 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
export const rgbToOklab = ({ r, g, b }) => {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    // Björn Ottosson's 2021 matrices: https://bottosson.github.io/posts/oklab/
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return {
        L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
};
export const oklabToOklch = ({ L, a, b }) => ({
    L,
    C: Math.hypot(a, b),
    h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
});
export const oklchToOklab = ({ L, C, h }) => ({
    L,
    a: C * Math.cos((h * Math.PI) / 180),
    b: C * Math.sin((h * Math.PI) / 180),
});
export const oklabToHex = ({ L, a, b }) => {
    if (![L, a, b].every(Number.isFinite))
        return null;
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    // Reject out-of-gamut colors. The epsilon only covers conversion round-off.
    if (linear.some(value => !Number.isFinite(value) || value < -2e-7 || value > 1 + 2e-7))
        return null;
    return `#${linear
        .map(value => Math.round(linearToSrgb(Math.max(0, Math.min(1, value))))
        .toString(16)
        .padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
};
export const oklchToHex = (color) => {
    if (color.C < 0 || !Number.isFinite(color.h))
        return null;
    return oklabToHex(oklchToOklab(color));
};
export const relativeLuminance = (color) => {
    const rgb = typeof color === 'string' ? hexToRgb(color) : color;
    if (!rgb)
        return NaN;
    return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
};
export const hexToRgb = (value) => {
    const hex = normalizeHex(value);
    if (!hex)
        return null;
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
};
export const parseColor = (value) => {
    const hex = normalizeHex(value);
    if (!hex)
        return null;
    const rgb = hexToRgb(hex);
    const lab = rgbToOklab(rgb);
    return { hex, rgb, lab, lch: oklabToOklch(lab), luminance: relativeLuminance(rgb) };
};
export const hexToOklab = (hex) => parseColor(hex)?.lab ?? null;
export const hexToOklch = (hex) => parseColor(hex)?.lch ?? null;
export const contrastFromLuminance = (left, right) => (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
export const contrastRatio = (left, right) => contrastFromLuminance(relativeLuminance(left), relativeLuminance(right));
export const deltaE = (left, right) => {
    const a = typeof left === 'string' ? hexToOklab(left) : left;
    const b = typeof right === 'string' ? hexToOklab(right) : right;
    return a && b ? 100 * Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b) : NaN;
};
export const wcagContrast = contrastRatio;
export const deltaEOK = deltaE;
export const colorAdvice = (hex, recommendedMaxChroma = 0.1) => {
    const color = parseColor(hex);
    if (!color)
        return [];
    return color.lch.C > recommendedMaxChroma
        ? ['色度 C=' + color.lch.C.toFixed(3) + ' 较高；希望更柔和时可降低色度。这是建议，不是硬性限制。']
        : [];
};
/** Suggestions are real HEX candidates. Call checkCandidate before applying one. */
export const recommendColor = (hex, recommendedMaxChroma = 0.1) => {
    const color = parseColor(hex);
    if (!color)
        return [];
    const candidates = new Set();
    for (const C of [recommendedMaxChroma, 0.085, 0.07, 0.055]) {
        if (C >= color.lch.C - 1e-10 || C < 0)
            continue;
        const candidate = oklchToHex({ ...color.lch, C });
        if (candidate && candidate !== color.hex)
            candidates.add(candidate);
    }
    if (color.lch.L > 0.7) {
        for (const reduction of [0.04, 0.08, 0.12]) {
            const candidate = oklchToHex({ ...color.lch, L: color.lch.L - reduction });
            if (candidate && candidate !== color.hex)
                candidates.add(candidate);
        }
    }
    return [...candidates];
};
