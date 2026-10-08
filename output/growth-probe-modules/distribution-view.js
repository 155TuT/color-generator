import { contrastRatio, deltaE, parseColor } from './color.js';
import './distribution-view.css';
const SVG_NS = 'http://www.w3.org/2000/svg';
let viewCount = 0;
function html(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text)
        node.textContent = text;
    return node;
}
function svg(tag, attributes, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes))
        node.setAttribute(key, String(value));
    if (text !== undefined)
        node.textContent = text;
    return node;
}
/** Prim's minimum spanning tree uses full, three-dimensional OKLab distances.
 * The two views only project this tree; neither input order nor 2D distance
 * determines the connections.
 */
function shortConnections(colors) {
    if (colors.length < 2)
        return [];
    const connected = new Set([0]);
    const best = colors.map((color, index) => ({ from: 0, to: index, distance: deltaE(colors[0].lab, color.lab) }));
    const edges = [];
    while (connected.size < colors.length) {
        let next;
        for (const edge of best) {
            if (!connected.has(edge.to) && (!next || edge.distance < next.distance))
                next = edge;
        }
        if (!next)
            break;
        edges.push(next);
        connected.add(next.to);
        for (let index = 0; index < colors.length; index++) {
            if (connected.has(index))
                continue;
            const distance = deltaE(colors[next.to].lab, colors[index].lab);
            if (distance < best[index].distance)
                best[index] = { from: next.to, to: index, distance };
        }
    }
    return edges;
}
function unwrapHues(colors) {
    const hues = colors.map(color => color.lch.h).sort((a, b) => a - b);
    if (hues.length === 0)
        return [];
    let largestGap = -1;
    let start = hues[0];
    for (let index = 0; index < hues.length; index++) {
        const next = hues[(index + 1) % hues.length] + (index === hues.length - 1 ? 360 : 0);
        if (next - hues[index] > largestGap) {
            largestGap = next - hues[index];
            start = next % 360;
        }
    }
    return colors.map(color => color.lch.h + (color.lch.h < start - 1e-8 ? 360 : 0));
}
/** Inspect the actual HEX palette without changing its colors or order. */
export function mountDistribution(host, input, textColor, options = {}) {
    // Preserve the caller's indices even if a malformed entry is omitted from the chart.
    const entries = input.flatMap((hex, inputIndex) => {
        const color = parseColor(hex);
        return color ? [{ color, inputIndex }] : [];
    });
    const colors = entries.map(entry => entry.color);
    const internalIndices = new Map(entries.map((entry, index) => [entry.inputIndex, index]));
    const shell = html('div', 'distribution-view');
    host.append(shell);
    if (colors.length === 0) {
        shell.append(html('p', 'distribution-empty', '生成色板后查看颜色之间的分布与衔接。'));
        return { destroy: () => shell.remove(), setSelection: () => { } };
    }
    const edges = shortConnections(colors);
    const nearest = colors.map((color, index) => {
        let minimum = Infinity;
        for (let other = 0; other < colors.length; other++) {
            if (index !== other)
                minimum = Math.min(minimum, deltaE(color.lab, colors[other].lab));
        }
        return minimum;
    });
    const hueValues = unwrapHues(colors);
    const plots = html('div', 'distribution-plots');
    const detail = html('div', 'distribution-detail');
    detail.id = `distribution-detail-${++viewCount}`;
    detail.setAttribute('role', 'status');
    detail.setAttribute('aria-live', 'polite');
    detail.setAttribute('aria-atomic', 'true');
    const detailSwatch = html('span', 'distribution-detail-swatch');
    const detailBody = html('div', 'distribution-detail-body');
    const detailTitle = html('strong', 'distribution-detail-title');
    const detailHint = html('span', 'distribution-detail-hint', '悬停、点击或用 Tab 聚焦色点；方向键切换颜色。');
    const detailMetrics = html('div', 'metrics distribution-detail-metrics');
    const metricValues = ['明度 L', '色相 h', '彩度 C', '文字对比', '最近邻色差'].map(label => {
        const item = html('div', '');
        const value = html('strong', '');
        item.append(value, html('span', '', label));
        detailMetrics.append(item);
        return value;
    });
    detailBody.append(detailTitle, detailHint);
    detail.append(detailSwatch, detailBody, detailMetrics);
    const caption = html('p', 'distribution-caption', '每个点代表一色，短连线看衔接。连线按 OKLab 色差组成最小生成树，与色板顺序无关；局部相近不代表任意两色都相近。');
    shell.append(plots, detail, caption);
    const pointNodes = [];
    const lineNodes = [];
    let pointerIndex = null;
    let focusIndex = null;
    let pinnedIndex = null;
    let activeIndex = null;
    let selectedIndices = new Set();
    let destroyed = false;
    const metricsText = (index) => {
        const color = colors[index];
        const contrast = contrastRatio(color.hex, textColor);
        return `L ${(color.lch.L * 100).toFixed(1)}% · h ${color.lch.h.toFixed(1)}° · C ${color.lch.C.toFixed(3)} · 文字对比 ${Number.isFinite(contrast) ? contrast.toFixed(2) + ':1' : '—'} · 最近邻 ΔE ${Number.isFinite(nearest[index]) ? nearest[index].toFixed(2) : '—'}`;
    };
    function highlight() {
        const active = pointerIndex ?? focusIndex ?? activeIndex ?? pinnedIndex;
        const neighbors = new Set();
        if (active !== null) {
            for (const edge of edges) {
                if (edge.from === active)
                    neighbors.add(edge.to);
                if (edge.to === active)
                    neighbors.add(edge.from);
            }
        }
        for (const points of pointNodes) {
            points.forEach((point, index) => {
                point.classList.toggle('is-active', index === active);
                point.setAttribute('aria-current', index === active ? 'true' : 'false');
                const selected = selectedIndices.has(index) || (!options.onActivate && pinnedIndex === index);
                point.classList.toggle('is-selected', selected);
                point.setAttribute('aria-pressed', String(selected));
                point.classList.toggle('is-neighbor', neighbors.has(index));
                point.classList.toggle('is-muted', active !== null && index !== active && !neighbors.has(index) && !selected);
                point.setAttribute('r', index === active ? '7' : '5.5');
            });
        }
        for (const lines of lineNodes) {
            lines.forEach((line, index) => {
                const edge = edges[index];
                line.classList.toggle('is-active', edge.from === active || edge.to === active);
                line.classList.toggle('is-muted', active !== null && edge.from !== active && edge.to !== active);
            });
        }
        detail.classList.toggle('has-color', active !== null);
        detailMetrics.hidden = active === null;
        detailHint.hidden = active !== null;
        if (active === null) {
            delete detail.dataset.colorIndex;
            detailSwatch.style.background = '';
            detailTitle.textContent = '查看颜色的相邻关系';
        }
        else {
            const color = colors[active];
            const contrast = contrastRatio(color.hex, textColor);
            detail.dataset.colorIndex = String(entries[active].inputIndex);
            detailSwatch.style.background = color.hex;
            detailTitle.textContent = color.hex;
            const values = [
                `${(color.lch.L * 100).toFixed(1)}%`, `${color.lch.h.toFixed(1)}°`, color.lch.C.toFixed(3),
                Number.isFinite(contrast) ? `${contrast.toFixed(2)}:1` : '—',
                Number.isFinite(nearest[active]) ? nearest[active].toFixed(2) : '—',
            ];
            metricValues.forEach((value, index) => { value.textContent = values[index]; });
        }
    }
    function activate(index) {
        if (options.onActivate) {
            // Selection belongs to the caller; hovering/focusing remains a temporary preview.
            options.onActivate(entries[index].inputIndex);
        }
        else {
            pinnedIndex = pinnedIndex === index ? null : index;
            highlight();
        }
    }
    function makePlot(title, subtitle, label) {
        const figure = html('figure', 'distribution-plot');
        const heading = html('figcaption', 'distribution-plot-heading');
        heading.append(html('strong', '', title), html('span', '', subtitle));
        const chart = svg('svg', { viewBox: '0 0 340 306', role: 'group', 'aria-label': label });
        figure.append(heading, chart);
        plots.append(figure);
        return chart;
    }
    function drawConnections(chart, positions) {
        const group = svg('g', { 'aria-hidden': 'true' });
        const lines = edges.map(edge => {
            const from = positions[edge.from], to = positions[edge.to];
            const line = svg('line', { class: 'distribution-link', x1: from.x, y1: from.y, x2: to.x, y2: to.y });
            group.append(line);
            return line;
        });
        chart.append(group);
        lineNodes.push(lines);
    }
    function drawPoints(chart, positions) {
        const points = colors.map((color, index) => {
            const point = svg('circle', {
                class: 'distribution-point', cx: positions[index].x, cy: positions[index].y, r: 5.5,
                fill: color.hex, tabindex: 0, role: 'button', 'aria-pressed': 'false',
                'data-color-index': entries[index].inputIndex,
                'aria-label': `第 ${entries[index].inputIndex + 1} 色 ${color.hex}，${metricsText(index)}`,
            });
            point.append(svg('title', {}, `${color.hex} · ${metricsText(index)}`));
            point.addEventListener('pointerenter', () => { pointerIndex = index; highlight(); });
            point.addEventListener('pointerleave', () => { pointerIndex = null; highlight(); });
            point.addEventListener('focus', () => { focusIndex = index; highlight(); });
            point.addEventListener('blur', () => { focusIndex = null; highlight(); });
            point.addEventListener('click', () => activate(index));
            point.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    pinnedIndex = pointerIndex = focusIndex = null;
                    point.blur();
                    highlight();
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activate(index);
                    return;
                }
                const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                if (offset) {
                    event.preventDefault();
                    points[(index + offset + points.length) % points.length].focus();
                }
            });
            chart.append(point);
            return point;
        });
        pointNodes.push(points);
    }
    const abChart = makePlot('色相与彩度', 'a / b · 靠近灰心时彩度更低', 'OKLab a b 平面的颜色分布');
    const extent = Math.max(.055, ...colors.map(color => color.lch.C)) * 1.2;
    const center = { x: 170, y: 143 };
    const radius = 114;
    const abPosition = (a, b) => ({ x: center.x + a / extent * radius, y: center.y - b / extent * radius });
    const backdrop = svg('g', { 'aria-hidden': 'true' });
    for (const fraction of [.5, 1]) {
        backdrop.append(svg('circle', { class: 'distribution-ring', cx: center.x, cy: center.y, r: radius * fraction }));
    }
    backdrop.append(svg('line', { class: 'distribution-axis', x1: center.x - radius, y1: center.y, x2: center.x + radius, y2: center.y }), svg('line', { class: 'distribution-axis', x1: center.x, y1: center.y - radius, x2: center.x, y2: center.y + radius }), svg('circle', { class: 'distribution-gray-center', cx: center.x, cy: center.y, r: 3 }), svg('text', { class: 'distribution-label', x: center.x + 7, y: center.y + 15 }, '灰心'), svg('text', { class: 'distribution-label', x: center.x, y: 16, 'text-anchor': 'middle' }, '+b 黄'), svg('text', { class: 'distribution-label', x: center.x, y: 276, 'text-anchor': 'middle' }, '−b 蓝'), svg('text', { class: 'distribution-label', x: 45, y: center.y + 4, 'text-anchor': 'end' }, '−a 绿'), svg('text', { class: 'distribution-label', x: 295, y: center.y + 4 }, '+a 红'), svg('text', { class: 'distribution-scale-label', x: center.x, y: 297, 'text-anchor': 'middle' }, `外圈 C = ${extent.toFixed(3)}`));
    abChart.append(backdrop);
    const abPositions = colors.map(color => abPosition(color.lab.a, color.lab.b));
    drawConnections(abChart, abPositions);
    drawPoints(abChart, abPositions);
    const lhChart = makePlot('色相与明度', 'h / L · 在色相最大空隙处展开', '连续色相和明度平面的颜色分布，色相跨越零度时保持连续');
    const hueMin = Math.min(...hueValues), hueMax = Math.max(...hueValues);
    const huePad = Math.max(6, (hueMax - hueMin) * .07);
    const xMin = hueMin - huePad, xMax = hueMax + huePad;
    const lightness = colors.map(color => color.lch.L);
    const lMin = Math.min(...lightness), lMax = Math.max(...lightness);
    const lPad = Math.max(.025, (lMax - lMin) * .13);
    const yMin = Math.max(0, lMin - lPad), yMax = Math.min(1, lMax + lPad);
    const left = 48, right = 320, top = 28, bottom = 255;
    const positionLH = (h, L) => ({
        x: left + (h - xMin) / (xMax - xMin) * (right - left),
        y: bottom - (L - yMin) / (yMax - yMin) * (bottom - top),
    });
    const grid = svg('g', { 'aria-hidden': 'true' });
    for (let tick = 0; tick < 5; tick++) {
        const h = xMin + (xMax - xMin) * tick / 4;
        const L = yMin + (yMax - yMin) * tick / 4;
        const x = positionLH(h, yMin).x, y = positionLH(xMin, L).y;
        grid.append(svg('line', { class: 'distribution-gridline', x1: x, y1: top, x2: x, y2: bottom }), svg('line', { class: 'distribution-gridline', x1: left, y1: y, x2: right, y2: y }), svg('text', { class: 'distribution-label', x, y: bottom + 19, 'text-anchor': 'middle' }, `${Math.round((h % 360 + 360) % 360) % 360}°`), svg('text', { class: 'distribution-label', x: left - 8, y: y + 4, 'text-anchor': 'end' }, `${(L * 100).toFixed(0)}%`));
    }
    grid.append(svg('text', { class: 'distribution-label', x: left, y: 16 }, 'L 明度'), svg('text', { class: 'distribution-label', x: (left + right) / 2, y: 297, 'text-anchor': 'middle' }, 'h 色相 →'));
    lhChart.append(grid);
    const lhPositions = colors.map((color, index) => positionLH(hueValues[index], color.lch.L));
    drawConnections(lhChart, lhPositions);
    drawPoints(lhChart, lhPositions);
    highlight();
    return {
        destroy: () => { destroyed = true; shell.remove(); },
        setSelection: selection => {
            if (destroyed)
                return;
            activeIndex = selection.activeIndex === null ? null : internalIndices.get(selection.activeIndex) ?? null;
            selectedIndices = new Set(selection.selectedIndices.flatMap(index => {
                const internal = internalIndices.get(index);
                return internal === undefined ? [] : [internal];
            }));
            // A new external selection supersedes an old hover, keyboard focus, or pin.
            // Keep focus only when it already belongs to the new active color, so Enter
            // activation can be followed by arrow navigation without an extra Tab.
            pointerIndex = focusIndex = pinnedIndex = null;
            const focused = document.activeElement;
            if (focused instanceof SVGElement && shell.contains(focused)
                && focused.getAttribute('data-color-index') !== String(selection.activeIndex))
                focused.blur();
            highlight();
        },
    };
}
