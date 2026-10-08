import { colorAdvice, contrastFromLuminance, deltaE, normalizeHex, oklchToHex, parseColor, } from './color.js';
import { closestStyleKnot, makeStyleModel, shortHueDifference } from './style-model.js';
const EPSILON = 1e-10;
// The conversion matrices leave a tiny chroma residual on neutral sRGB grays.
// Match domain derivation: hue has no useful meaning below this threshold.
const ACHROMATIC_EPSILON = 1e-6;
const issue = (code, message, indices = []) => ({ code, message, indices });
const wrapHue = (value) => ((value % 360) + 360) % 360;
export function hueSpan(domain) {
    const difference = domain.hue[1] - domain.hue[0];
    return Math.abs(difference) >= 360 ? 360 : wrapHue(difference);
}
function configurationIssues(constraints, domain) {
    const issues = [];
    for (const [key, minimum, maximum] of [
        ['minDeltaE', 0, Infinity],
        ['maxBackgroundContrast', 1, 21],
        ['minTextContrast', 1, 21],
        ['minChroma', 0, 0.4],
        ['maxChroma', 0, 0.4],
    ]) {
        const value = key === 'minChroma' && constraints.minChroma === undefined ? 0 : constraints[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
            issues.push(issue('configuration', key + ' 超出有效数值范围。'));
        }
    }
    if ((constraints.minChroma ?? 0) > constraints.maxChroma) {
        issues.push(issue('configuration', '彩度下限不能大于彩度上限。'));
    }
    if (!parseColor(constraints.textColor))
        issues.push(issue('text-color', '文字颜色不是有效 HEX。'));
    if (domain) {
        for (const [key, minimum, maximum] of [
            ['lightness', 0, 1],
            ['chroma', 0, 0.4],
            ['hue', 0, 360],
        ]) {
            const range = domain[key];
            if (!Array.isArray(range) ||
                range.length !== 2 ||
                range.some(value => !Number.isFinite(value) || value < minimum || value > maximum)) {
                issues.push(issue('domain-configuration', key + ' 色域区间无效。'));
            }
            else if (key !== 'hue' && range[0] > range[1]) {
                issues.push(issue('domain-configuration', key + ' 色域下限不能大于上限。'));
            }
        }
    }
    return issues;
}
export function isInDomain(color, domain) {
    const { L, C, h } = color.lch;
    const hueAllowed = C < ACHROMATIC_EPSILON || hueSpan(domain) >= 360 || wrapHue(h - domain.hue[0]) <= hueSpan(domain) + EPSILON;
    return (L >= domain.lightness[0] - EPSILON &&
        L <= domain.lightness[1] + EPSILON &&
        C >= domain.chroma[0] - EPSILON &&
        C <= domain.chroma[1] + EPSILON &&
        hueAllowed);
}
function individualIssues(color, constraints, domain, index, foreground = parseColor(constraints.textColor)) {
    const issues = [];
    if (domain && !isInDomain(color, domain)) {
        issues.push(issue('domain', color.hex + ' 的实码颜色落在指定 OKLCh 色域之外。', [index]));
    }
    if (color.lch.C > constraints.maxChroma + EPSILON) {
        issues.push(issue('chroma', color.hex + ' 超过硬性最大色度。', [index]));
    }
    if (color.lch.C < (constraints.minChroma ?? 0) - EPSILON) {
        issues.push(issue('min-chroma', color.hex + ' 低于硬性彩度下限，过于接近灰轴。', [index]));
    }
    if (foreground &&
        contrastFromLuminance(foreground.luminance, color.luminance) < constraints.minTextContrast - EPSILON) {
        issues.push(issue('text-contrast', color.hex + ' 与文字的 WCAG 对比低于设定值。', [index]));
    }
    return issues;
}
function pairIssues(left, right, constraints, indices) {
    const issues = [];
    if (left.hex === right.hex) {
        issues.push(issue('duplicate', '颜色 ' + left.hex + ' 重复。', indices));
    }
    if (deltaE(left.lab, right.lab) < constraints.minDeltaE - EPSILON) {
        issues.push(issue('delta-e', left.hex + ' 与 ' + right.hex + ' 的色差低于设定值。', indices));
    }
    if (contrastFromLuminance(left.luminance, right.luminance) > constraints.maxBackgroundContrast + EPSILON) {
        issues.push(issue('background-contrast', left.hex + ' 与 ' + right.hex + ' 的背景对比超过设定值。', indices));
    }
    return issues;
}
/** All metrics are computed from the actual 8-bit sRGB values, not proposed floating-point LCh. */
export function validatePalette(colors, constraints, domain) {
    const issues = configurationIssues(constraints, domain);
    const configurationValid = issues.length === 0;
    const parsed = colors.map(parseColor);
    const text = parseColor(constraints.textColor);
    const textContrasts = parsed.map(color => color && text ? contrastFromLuminance(text.luminance, color.luminance) : NaN);
    let closestPair = null;
    let backgroundExtremes = null;
    let minDeltaE = Infinity;
    let maxBackgroundContrast = 1;
    let maxChroma = 0;
    const recommendations = [];
    for (let index = 0; index < parsed.length; index++) {
        const color = parsed[index];
        if (!color) {
            issues.push(issue('invalid-color', '第 ' + (index + 1) + ' 个颜色不是有效 HEX。', [index]));
            continue;
        }
        maxChroma = Math.max(maxChroma, color.lch.C);
        recommendations.push(...colorAdvice(color.hex).map(message => color.hex + '：' + message));
        if (configurationValid)
            issues.push(...individualIssues(color, constraints, domain, index));
        for (let otherIndex = 0; otherIndex < index; otherIndex++) {
            const other = parsed[otherIndex];
            if (!other)
                continue;
            const distance = deltaE(color.lab, other.lab);
            const contrast = contrastFromLuminance(color.luminance, other.luminance);
            if (distance < minDeltaE) {
                minDeltaE = distance;
                closestPair = [otherIndex, index];
            }
            if (contrast > maxBackgroundContrast) {
                maxBackgroundContrast = contrast;
                backgroundExtremes = [otherIndex, index];
            }
            if (configurationValid)
                issues.push(...pairIssues(other, color, constraints, [otherIndex, index]));
        }
    }
    const finiteTextContrasts = textContrasts.filter(Number.isFinite);
    return {
        valid: issues.length === 0,
        issues,
        recommendations,
        minDeltaE: Number.isFinite(minDeltaE) ? minDeltaE : null,
        maxBackgroundContrast,
        minTextContrast: finiteTextContrasts.length ? Math.min(...finiteTextContrasts) : null,
        maxChroma,
        closestPair,
        backgroundExtremes,
        textContrasts,
    };
}
/**
 * Compile an editing checker once for a fixed set. Existing metrics and their full audit are cached.
 * Only the candidate and its pairs block hardAllowed; unrelated errors still appear in validation.
 * Parameters are snapshotted, so build a new checker after changing the palette or constraints.
 */
export function createCandidateChecker(existing, constraints, domain) {
    const fixed = [...existing];
    const config = { ...constraints };
    const bounds = domain
        ? {
            lightness: [...domain.lightness],
            chroma: [...domain.chroma],
            hue: [...domain.hue],
        }
        : undefined;
    const parsed = fixed.map(parseColor);
    const foreground = parseColor(config.textColor);
    const configuration = configurationIssues(config, bounds);
    const baseline = validatePalette(fixed, config, bounds);
    const candidateIndex = fixed.length;
    return (hex) => {
        const color = parseColor(hex);
        const candidateIssues = [];
        const recommendations = color ? colorAdvice(color.hex) : [];
        let minimumDistance = baseline.minDeltaE ?? Infinity;
        let maximumContrast = baseline.maxBackgroundContrast;
        let closestPair = baseline.closestPair;
        let backgroundExtremes = baseline.backgroundExtremes;
        if (!color) {
            candidateIssues.push(issue('invalid-color', '候选色不是有效 HEX。', [candidateIndex]));
        }
        else {
            if (!configuration.length)
                candidateIssues.push(...individualIssues(color, config, bounds, candidateIndex, foreground));
            parsed.forEach((other, index) => {
                if (!other)
                    return;
                const distance = deltaE(other.lab, color.lab);
                const contrast = contrastFromLuminance(other.luminance, color.luminance);
                if (distance < minimumDistance) {
                    minimumDistance = distance;
                    closestPair = [index, candidateIndex];
                }
                if (contrast > maximumContrast) {
                    maximumContrast = contrast;
                    backgroundExtremes = [index, candidateIndex];
                }
                if (!configuration.length)
                    candidateIssues.push(...pairIssues(other, color, config, [index, candidateIndex]));
            });
        }
        const textContrast = color && foreground ? contrastFromLuminance(foreground.luminance, color.luminance) : NaN;
        const minimumText = Number.isFinite(textContrast)
            ? Math.min(baseline.minTextContrast ?? Infinity, textContrast)
            : baseline.minTextContrast;
        const issues = [...configuration, ...candidateIssues];
        const validationIssues = [...baseline.issues, ...candidateIssues];
        return {
            hardAllowed: issues.length === 0,
            issues,
            recommendations,
            color,
            validation: {
                valid: validationIssues.length === 0,
                issues: validationIssues,
                recommendations: [...baseline.recommendations, ...recommendations.map(message => color.hex + '：' + message)],
                minDeltaE: Number.isFinite(minimumDistance) ? minimumDistance : null,
                maxBackgroundContrast: maximumContrast,
                minTextContrast: minimumText,
                maxChroma: Math.max(baseline.maxChroma, color?.lch.C ?? 0),
                closestPair,
                backgroundExtremes,
                textContrasts: [...baseline.textContrasts, textContrast],
            },
        };
    };
}
/** Editing checker for occasional calls; use createCandidateChecker for canvas-sized batches. */
export function checkCandidate(hex, existing, constraints, domain) {
    return createCandidateChecker(existing, constraints, domain)(hex);
}
export function hashSeed(seed) {
    let value = 2166136261;
    for (let index = 0; index < seed.length; index++) {
        value = Math.imul(value ^ seed.charCodeAt(index), 16777619);
    }
    return value >>> 0;
}
export function randomSource(seed) {
    let state = hashSeed(seed);
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
export function halton(index, base) {
    let value = 0;
    let fraction = 1;
    while (index > 0) {
        fraction /= base;
        value += fraction * (index % base);
        index = Math.floor(index / base);
    }
    return value;
}
const emptyStats = () => ({
    sampled: 0,
    gamutRejected: 0,
    hardRejected: 0,
    uniqueCandidates: 0,
    attempts: 0,
});
function compatible(color, existing, constraints) {
    return existing.every((other, index) => pairIssues(other, color, constraints, [index, existing.length]).length === 0);
}
function styleLocation(color, model) {
    const group = closestStyleKnot(model, color.lab);
    const center = model.knots[group].lch;
    const offsets = [
        (color.lch.L - center.L) / model.radius.lightness,
        (color.lch.C - center.C) / model.radius.chroma,
        shortHueDifference(center.h, color.lch.h) / model.radius.hue,
    ];
    return {
        group,
        direction: (offsets[0] >= 0 ? 1 : 0) + (offsets[1] >= 0 ? 2 : 0) + (offsets[2] >= 0 ? 4 : 0),
        residual: deltaE(color.lab, model.knots[group].lab),
        // Keep the nearby path's chroma instead of rewarding ever more colorful points.
        // Moving toward gray costs slightly more; both sides remain soft preferences.
        chromaDeviation: (Math.abs(center.C - color.lch.C) + Math.max(0, center.C - color.lch.C) * 0.25) * 100,
    };
}
function makePool(fixed, options, excluded, stats) {
    const random = randomSource(String(options.seed) + ':sampling');
    const offsets = [random(), random(), random()];
    const seen = new Set([...fixed.map(color => color.hex), ...excluded]);
    const pool = [];
    const sampleCount = options.sampleCount ?? 16000;
    const domain = options.domain;
    const span = hueSpan(domain);
    for (let index = 1; index <= sampleCount; index++) {
        stats.sampled++;
        const lightness = (halton(index, 2) + offsets[0]) % 1;
        const chroma = (halton(index, 3) + offsets[1]) % 1;
        const hue = (halton(index, 5) + offsets[2]) % 1;
        // Preserve the original domain-wide Halton pool and its uniform annular-area chroma mapping.
        const proposed = {
            L: domain.lightness[0] + lightness * (domain.lightness[1] - domain.lightness[0]),
            C: Math.sqrt(domain.chroma[0] ** 2 + chroma * (domain.chroma[1] ** 2 - domain.chroma[0] ** 2)),
            h: wrapHue(domain.hue[0] + hue * span),
        };
        const hex = oklchToHex(proposed);
        if (!hex) {
            stats.gamutRejected++;
            continue;
        }
        if (seen.has(hex))
            continue;
        seen.add(hex);
        const color = parseColor(hex);
        if (individualIssues(color, options.constraints, domain, fixed.length).length ||
            !compatible(color, fixed, options.constraints)) {
            stats.hardRejected++;
            continue;
        }
        pool.push(color);
    }
    stats.uniqueCandidates = pool.length;
    return pool;
}
function fillAttempt(fixed, pool, model, count, constraints, seed, attempt) {
    const random = randomSource(seed + ':attempt:' + attempt);
    const chosen = [...fixed];
    const active = pool.map(() => true);
    const locations = pool.map(color => styleLocation(color, model));
    const occupancy = model.knots.map(() => 0);
    const directions = model.knots.map(() => Array(8).fill(0));
    fixed.forEach(color => {
        const location = styleLocation(color, model);
        occupancy[location.group]++;
        directions[location.group][location.direction]++;
    });
    const priorities = pool.map(() => attempt === 0 ? 0 : random() * 0.35);
    const nearest = pool.map(candidate => fixed.length ? Math.min(...fixed.map(color => deltaE(candidate.lab, color.lab))) : 0);
    // A small preferred step is a soft target, not a license to relax minDeltaE or to seek the farthest point.
    const step = Math.max(constraints.minDeltaE * 1.25, model.anchors.length > 1 ? 4 : 2);
    while (chosen.length < count) {
        let bestIndex = -1;
        let bestScore = -Infinity;
        for (let index = 0; index < pool.length; index++) {
            if (!active[index])
                continue;
            if ((chosen.length && nearest[index] < constraints.minDeltaE - EPSILON) || !compatible(pool[index], chosen, constraints)) {
                active[index] = false;
                continue;
            }
            const candidate = locations[index];
            // Balance neighboring skeleton segments and L/C/h directions, then prefer a modest step.
            // Both overly large jumps and nearly-duplicate clustering carry a cost. No maximin objective remains.
            const score = -(occupancy[candidate.group] * 3
                + directions[candidate.group][candidate.direction] * 0.16
                + (chosen.length ? (nearest[index] - step) ** 2 * 0.15 : 0)
                + candidate.residual * 0.12 + candidate.chromaDeviation * 0.5 + priorities[index]);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }
        if (bestIndex < 0)
            break;
        const next = pool[bestIndex];
        chosen.push(next);
        occupancy[locations[bestIndex].group]++;
        directions[locations[bestIndex].group][locations[bestIndex].direction]++;
        active[bestIndex] = false;
        for (let index = 0; index < pool.length; index++) {
            if (active[index])
                nearest[index] = chosen.length === 1
                    ? deltaE(pool[index].lab, next.lab)
                    : Math.min(nearest[index], deltaE(pool[index].lab, next.lab));
        }
    }
    return chosen;
}
function generateInternal(options, allowEmptyAnchors, excluded = new Set()) {
    const seed = String(options.seed);
    const targetCount = options.targetCount ?? 25;
    const colors = [...options.anchors];
    const stats = emptyStats();
    const validation = validatePalette(colors, options.constraints, options.domain);
    const inputErrors = [];
    if (Array.isArray(options.domain?.chroma)
        && Math.max(options.domain.chroma[0], options.constraints.minChroma ?? 0)
            > Math.min(options.domain.chroma[1], options.constraints.maxChroma) + EPSILON) {
        inputErrors.push('生成范围的彩度区间与硬性彩度范围没有交集，请调整彩度边界。');
    }
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 25)
        inputErrors.push('目标颜色数量必须为 1–25。');
    if ((!allowEmptyAnchors && colors.length < 1) || colors.length > targetCount)
        inputErrors.push('主色需要 1–目标数量个；不会删除或覆盖主色。');
    if (options.sampleCount !== undefined &&
        (!Number.isInteger(options.sampleCount) || options.sampleCount < 1 || options.sampleCount > 100000)) {
        inputErrors.push('采样预算必须是 1–100000 的整数。');
    }
    if (!validation.valid || inputErrors.length) {
        return {
            status: 'failure',
            colors,
            validation,
            seed,
            stats,
            diagnostics: [
                ...inputErrors,
                ...validation.issues.map(item => item.message),
                '固定颜色或参数已经冲突，保留原色并停止生成。',
            ],
        };
    }
    if (colors.length === targetCount) {
        return {
            status: 'success',
            colors,
            validation,
            seed,
            stats,
            diagnostics: ['主色数量已达到目标，已审计全部实码颜色。'],
        };
    }
    const fixed = colors.map(value => parseColor(value));
    const guide = options.styleAnchors ?? options.anchors;
    const model = makeStyleModel(guide);
    if (!model.knots.length || guide.some(value => !parseColor(value))) {
        return { status: 'failure', colors, validation, diagnostics: ['风格主色需要至少一个有效 HEX；没有可搜索的邻域。'], seed, stats };
    }
    const pool = makePool(fixed, options, excluded, stats);
    let best = fixed;
    let bestStyleCost = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
        stats.attempts++;
        const candidate = fillAttempt(fixed, pool, model, targetCount, options.constraints, seed, attempt);
        const styleCost = candidate.slice(fixed.length).reduce((total, color) => {
            const location = styleLocation(color, model);
            return total + location.residual + location.chromaDeviation;
        }, 0);
        if (candidate.length > best.length || (candidate.length === best.length && styleCost < bestStyleCost)) {
            best = candidate;
            bestStyleCost = styleCost;
        }
    }
    const resultColors = [...colors, ...best.slice(fixed.length).map(color => color.hex)];
    const finalValidation = validatePalette(resultColors, options.constraints, options.domain);
    const complete = resultColors.length === targetCount && finalValidation.valid;
    const added = resultColors.length - fixed.length;
    const status = complete ? 'success' : added ? 'partial' : 'failure';
    const diagnostics = complete
        ? ['已沿主色相邻色系的小步路径补足 ' + targetCount + ' 色；保留主色，量化后的全部色对通过硬性约束。']
        : [
            '在当前域和本次确定性采样预算内仅找到 ' + resultColors.length + '/' + targetCount + ' 色。未降低任何约束。',
            '这表示当前有限搜索未找到完整解，不等于已经证明色彩空间中没有数学解。',
        ];
    return { status, colors: resultColors, validation: finalValidation, diagnostics, seed, stats };
}
export function generatePalette(options) {
    return generateInternal(options, false);
}
/** Atomic replacement: a partial search leaves every original position untouched. */
export function regenerateSelected(colors, indices, options) {
    const selected = [...new Set(indices)].sort((left, right) => left - right);
    const original = [...colors];
    const stats = emptyStats();
    const seed = String(options.seed);
    if (!selected.length ||
        colors.length < 1 ||
        colors.length > 25 ||
        selected.some(index => !Number.isInteger(index) || index < 0 || index >= colors.length)) {
        return {
            status: 'failure',
            colors: original,
            validation: validatePalette(original, options.constraints, options.domain),
            diagnostics: ['请选择有效的一个或多个颜色位置。'],
            seed,
            stats,
        };
    }
    const selectedSet = new Set(selected);
    const fixed = colors.filter((_, index) => !selectedSet.has(index));
    const excluded = new Set(colors.map(normalizeHex).filter((value) => !!value));
    const generated = generateInternal({ ...options, styleAnchors: options.styleAnchors ?? original, anchors: fixed, targetCount: colors.length }, true, excluded);
    if (generated.status !== 'success') {
        return {
            ...generated,
            status: 'failure',
            colors: original,
            validation: validatePalette(original, options.constraints, options.domain),
            partialColors: generated.colors.slice(fixed.length),
            diagnostics: [...generated.diagnostics, '未能补全所有选中位置，因此整次换色未应用，原色保持不变。'],
        };
    }
    const replacements = generated.colors.slice(fixed.length);
    const replaced = [...original];
    selected.forEach((index, replacementIndex) => {
        replaced[index] = replacements[replacementIndex];
    });
    const validation = validatePalette(replaced, options.constraints, options.domain);
    if (!validation.valid) {
        return {
            ...generated,
            status: 'failure',
            colors: original,
            validation: validatePalette(original, options.constraints, options.domain),
            diagnostics: ['最终实码审计未通过，换色未应用，原色保持不变。'],
        };
    }
    return {
        ...generated,
        colors: replaced,
        validation,
        diagnostics: ['仅重生成所选 ' + selected.length + ' 个位置；其余颜色及顺序完全保留。'],
    };
}
/**
 * Hue-family groups, followed by a greedy nearest-neighbor OKLab path.
 * Adjacent families may be reversed to reduce their join; this is not global TSP or L sorting.
 */
export function sortPalette(colors) {
    if (colors.length < 3)
        return [...colors];
    const items = colors.map((value, index) => ({ value, index, color: parseColor(value) }));
    if (items.some(item => !item.color))
        return [...colors];
    const sorted = items.sort((left, right) => left.color.lch.h - right.color.lch.h || left.index - right.index);
    let cut = 0;
    let largestGap = -1;
    for (let index = 0; index < sorted.length; index++) {
        const next = (index + 1) % sorted.length;
        const gap = next === 0
            ? sorted[0].color.lch.h + 360 - sorted[index].color.lch.h
            : sorted[next].color.lch.h - sorted[index].color.lch.h;
        if (gap > largestGap) {
            largestGap = gap;
            cut = next;
        }
    }
    const rotated = [...sorted.slice(cut), ...sorted.slice(0, cut)];
    const coveredArc = 360 - largestGap;
    const familyCount = coveredArc < 35 ? 1 : coveredArc < 85 ? 2 : 3;
    const gaps = rotated
        .slice(1)
        .map((item, index) => ({
        index: index + 1,
        gap: wrapHue(item.color.lch.h - rotated[index].color.lch.h),
    }))
        .sort((left, right) => right.gap - left.gap || left.index - right.index);
    const boundaries = [
        0,
        ...gaps
            .slice(0, familyCount - 1)
            .map(item => item.index)
            .sort((a, b) => a - b),
        rotated.length,
    ];
    const paths = [];
    for (let group = 0; group < boundaries.length - 1; group++) {
        const remaining = rotated.slice(boundaries[group], boundaries[group + 1]);
        const darkestIndex = remaining.reduce((best, item, index) => (item.color.lab.L < remaining[best].color.lab.L ? index : best), 0);
        const path = [remaining.splice(darkestIndex, 1)[0]];
        while (remaining.length) {
            let nearest = 0;
            let minimum = Infinity;
            const previous = path[path.length - 1].color;
            remaining.forEach((item, index) => {
                const distance = deltaE(previous.lab, item.color.lab);
                if (distance < minimum) {
                    minimum = distance;
                    nearest = index;
                }
            });
            path.push(remaining.splice(nearest, 1)[0]);
        }
        if (paths.length) {
            const previous = paths[paths.length - 1].at(-1).color;
            if (deltaE(previous.lab, path.at(-1).color.lab) < deltaE(previous.lab, path[0].color.lab))
                path.reverse();
        }
        paths.push(path);
    }
    return paths.flat().map(item => item.value);
}
