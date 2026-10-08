import { contrastRatio, oklchToHex, parseColor } from './color.js';
import { createCandidateChecker, hueSpan } from './generator.js';
import { createElement, Plus, Minus, RotateCcw, Maximize2, X } from 'lucide';
import './color-space.css';
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const toPoint = ({ C, h }) => ({ a: C * Math.cos(h * Math.PI / 180), b: C * Math.sin(h * Math.PI / 180) });
const toLch = (L, { a, b }) => ({ L, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 });
const inGamut = (rgb) => rgb.every(value => value >= -2e-7 && value <= 1 + 2e-7);
function linearSrgb(L, a, b) {
    const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
    const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
    const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
        -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
}
function linearP3(L, a, b) {
    // CSS Color 4 §19: OKLab -> D65 XYZ -> linear Display P3. P3 uses D65,
    // so there is no D50 adaptation and no DCI-P3 gamma/white-point substitution.
    // https://www.w3.org/TR/css-color-4/#color-conversion-code
    const l = (L + .3963377773761749 * a + .2158037573099136 * b) ** 3;
    const m = (L - .1055613458156586 * a - .0638541728258133 * b) ** 3;
    const s = (L - .0894841775298119 * a - 1.2914855480194092 * b) ** 3;
    const x = 1.2268798758459243 * l - .5578149944602171 * m + .2813910456659647 * s;
    const y = -.0405757452148008 * l + 1.112286803280317 * m - .0717110580655164 * s;
    const z = -.0763729366746601 * l - .4214933324022432 * m + 1.5869240198367816 * s;
    return [(446124 * x - 166638.5 * y - 72051 * z) / 178915,
        (-14852 * x + 31560.5 * y + 423 * z) / 17905,
        (11844 * x - 25168.5 * y + 316169 * z) / 330415];
}
function boundary(L, converter) {
    return Array.from({ length: 721 }, (_, index) => {
        const angle = index / 720 * TAU;
        const a = Math.cos(angle), b = Math.sin(angle);
        let low = 0, high = .5;
        for (let step = 0; step < 23; step++) {
            const C = (low + high) / 2;
            if (inGamut(converter(L, C * a, C * b)))
                low = C;
            else
                high = C;
        }
        return { a: low * a, b: low * b };
    });
}
function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text)
        node.textContent = text;
    return node;
}
export function mountColorSpace(host, options) {
    return mount(host, options, false);
}
function mount(host, options, expanded) {
    const color = parseColor(options.hex);
    if (!color)
        throw new Error('颜色探索器需要有效 HEX。');
    const L = color.lch.L;
    const selected = toPoint(color.lch);
    const checker = createCandidateChecker(options.existing, options.constraints, options.domain);
    const hardChecker = createCandidateChecker(options.existing, options.constraints);
    const minimumChroma = options.constraints.minChroma ?? 0;
    const maximumChroma = options.constraints.maxChroma;
    const srgbBoundary = boundary(L, linearSrgb);
    const p3Boundary = boundary(L, linearP3);
    // Adapt to this lightness slice, instead of confusing a style's C=.1 with a device limit.
    const extent = Math.max(.035, ...p3Boundary.map(point => Math.hypot(point.a, point.b))) * 1.19;
    const shell = element('div', 'color-space');
    const toolbar = element('div', 'color-space-toolbar');
    const title = element('div', 'color-space-slice');
    title.append(element('span', '', `OKLCh · L ${(L * 100).toFixed(1)}%`));
    const controls = element('div', 'color-space-controls');
    const zoomText = element('span', 'color-space-zoom', '100%');
    const makeButton = (icon, titleText, action) => {
        const button = element('button', '');
        button.append(createElement(icon, { width: '15', height: '15', 'aria-hidden': 'true', class: 'lucide color-space-icon' }));
        button.type = 'button';
        button.title = titleText;
        button.setAttribute('aria-label', titleText);
        button.addEventListener('click', action);
        return button;
    };
    const zoomOut = makeButton(Minus, '缩小色彩地图', () => setZoom(zoom / 1.5));
    const zoomIn = makeButton(Plus, '放大色彩地图', () => setZoom(zoom * 1.5));
    const reset = makeButton(RotateCcw, '还原色彩地图视图', () => { center = { a: 0, b: 0 }; setZoom(1); });
    controls.append(zoomOut, zoomText, zoomIn, reset);
    toolbar.append(title, controls);
    const stage = element('div', 'color-space-stage');
    const canvas = element('canvas', 'color-space-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `固定明度的 OKLCh 色彩地图。中心 C=0 为灰轴，彩度内外圈为 ${minimumChroma.toFixed(3)} 至 ${maximumChroma.toFixed(3)}。左右键调色相，上下键调彩度，Enter 应用，Escape 取消预览；也可使用图下方的参数控件。`);
    const selectedMarker = element('span', 'color-space-marker');
    const hoverMarker = element('span', 'color-space-marker is-hover');
    const tooltip = element('div', 'color-space-tooltip');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = hoverMarker.hidden = true;
    const tooltipHead = element('div', 'color-space-tooltip-head');
    const tooltipSwatch = element('span', 'color-space-tooltip-swatch');
    const tooltipHex = element('strong', '');
    tooltipHead.append(tooltipSwatch, tooltipHex);
    const tooltipMetrics = element('div', 'color-space-tooltip-metrics');
    const tooltipStatus = element('p', 'color-space-tooltip-status');
    const tooltipReason = element('p', 'color-space-tooltip-reason');
    tooltip.append(tooltipHead, tooltipMetrics, tooltipStatus, tooltipReason);
    stage.append(canvas, selectedMarker, hoverMarker, tooltip);
    const legend = element('div', 'color-space-legend');
    for (const [className, label] of [['srgb', 'sRGB 边界'], ['p3', 'Display P3 参考边界'], ['chroma', `彩度上下界 ${minimumChroma.toFixed(3)}–${maximumChroma.toFixed(3)}`], ['domain', '生成范围'], ['hard', '硬约束不通过']]) {
        const item = element('span', '');
        item.append(element('i', `color-space-key ${className}`), document.createTextNode(label));
        legend.append(item);
    }
    const note = element('p', 'color-space-note', 'C=0 为灰轴，彩度需在内外圈之间。绕轴调色相，明度在下方调整；拖动松开应用。');
    const status = element('p', 'color-space-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const details = element('details', 'color-space-details');
    details.append(element('summary', '', '读懂边界与键盘操作'));
    details.append(element('p', '', '彩色区域可输出为 sRGB HEX；灰色 P3 环带仅作色域参考，不模拟超出 sRGB 的颜色。设备边界随明度变化；棕色内外圈是全局彩度上下界，绿色虚线来自自定义生成范围。斜线表示硬约束未通过的区域，悬停以实码检查为准。图中所有 sRGB 色均可编辑，未通过的条件会说明原因。'));
    details.append(element('p', '', '聚焦地图后：← / → 调色相 2°，↑ / ↓ 调彩度 0.003，按住 Shift 加大步幅，Enter 应用，Escape 取消。放大以当前预览色为中心，复位查看完整切片。'));
    shell.append(toolbar, stage, legend, note, status, details);
    host.append(shell);
    let zoom = 1;
    let center = { a: 0, b: 0 };
    let preview = null;
    let keyboardPreview = null;
    let dragging = false;
    let destroyed = false;
    let redrawFrame = 0;
    let hoverFrame = 0;
    let lastPointer = null;
    let dialog = null;
    let expandedView = null;
    function coordinates(point, size = stage.clientWidth) {
        const scale = size * zoom / (2 * extent);
        return { x: size / 2 + (point.a - center.a) * scale, y: size / 2 - (point.b - center.b) * scale };
    }
    function pointAt(x, y, size = stage.clientWidth) {
        const scale = size * zoom / (2 * extent);
        return { a: (x - size / 2) / scale + center.a, b: (size / 2 - y) / scale + center.b };
    }
    function positionMarker(marker, point) {
        const { x, y } = coordinates(point);
        marker.style.left = `${x}px`;
        marker.style.top = `${y}px`;
        marker.hidden = x < 0 || y < 0 || x > stage.clientWidth || y > stage.clientWidth;
    }
    function requestDraw() {
        cancelAnimationFrame(redrawFrame);
        redrawFrame = requestAnimationFrame(draw);
    }
    function setZoom(value) {
        if (value > zoom)
            center = preview ? toPoint(preview) : selected;
        zoom = clamp(value, 1, 5);
        if (zoom === 1)
            center = { a: 0, b: 0 };
        zoomText.textContent = `${Math.round(zoom * 100)}%`;
        zoomOut.disabled = zoom <= 1;
        zoomIn.disabled = zoom >= 5;
        tooltip.hidden = hoverMarker.hidden = true;
        requestDraw();
    }
    function draw() {
        if (destroyed || !stage.clientWidth)
            return;
        const cssSize = stage.clientWidth;
        // At least 2x supersampling makes the raster/clip boundary smooth even on a 1x screen.
        // Bound total pixel work for expanded views; vector boundaries remain device-scale sharp.
        const density = Math.min(Math.max(2, window.devicePixelRatio || 1), 1500 / cssSize);
        const size = Math.round(cssSize * density);
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context)
            return;
        const image = context.createImageData(size, size);
        const pixels = image.data;
        const step = (2 * extent) / (size * zoom);
        const a0 = center.a - extent / zoom;
        const b0 = center.b + extent / zoom;
        const encode = (channel) => Math.round(255 * (channel <= .0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - .055));
        for (let y = 0; y < size; y++) {
            const b = b0 - (y + .5) * step;
            for (let x = 0; x < size; x++) {
                const a = a0 + (x + .5) * step;
                const rgb = linearSrgb(L, a, b);
                const index = (y * size + x) * 4;
                if (inGamut(rgb)) {
                    pixels[index] = encode(clamp(rgb[0], 0, 1));
                    pixels[index + 1] = encode(clamp(rgb[1], 0, 1));
                    pixels[index + 2] = encode(clamp(rgb[2], 0, 1));
                }
                else {
                    // Deliberately neutral reference area: clipped RGB would falsely depict P3 colors.
                    const p3 = inGamut(linearP3(L, a, b));
                    const stripe = p3 && (Math.floor((x + y) / density) % 10 < 2);
                    const shade = p3 ? (stripe ? 215 : 231) : 247;
                    pixels[index] = shade;
                    pixels[index + 1] = shade + (p3 ? 1 : 0);
                    pixels[index + 2] = shade + (p3 ? 3 : 0);
                }
                pixels[index + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
        context.scale(density, density);
        const pathBoundary = (points) => {
            context.beginPath();
            points.forEach((point, index) => {
                const { x, y } = coordinates(point);
                if (!index)
                    context.moveTo(x, y);
                else
                    context.lineTo(x, y);
            });
            context.closePath();
        };
        // Check a coarse mask rather than running a full palette audit for every device pixel.
        // Exact, quantized HEX validation is performed separately for every hovered/picked color.
        context.save();
        pathBoundary(srgbBoundary);
        context.clip();
        const tile = 7;
        context.strokeStyle = 'rgba(59, 40, 28, .25)';
        context.lineWidth = .8;
        context.beginPath();
        for (let y = 0; y < cssSize; y += tile) {
            for (let x = 0; x < cssSize; x += tile) {
                const lch = toLch(L, pointAt(x + tile / 2, y + tile / 2));
                const hex = oklchToHex(lch);
                if (hex && !hardChecker(hex).hardAllowed) {
                    context.moveTo(x, y + tile);
                    context.lineTo(x + tile, y);
                }
            }
        }
        context.stroke();
        context.restore();
        const origin = coordinates({ a: 0, b: 0 });
        const scale = cssSize * zoom / (2 * extent);
        context.strokeStyle = 'rgba(255,255,255,.42)';
        context.lineWidth = .75;
        context.setLineDash([2, 4]);
        // Use roughly 3–4 useful ticks, with enough CSS-pixel spacing for their labels.
        // Recompute for zoom, rather than making a dense fixed .05 grid on a phone.
        const targetTicks = clamp(Math.floor(cssSize / 100), 2, 4);
        const desiredStep = extent / (zoom * targetTicks);
        const magnitude = 10 ** Math.floor(Math.log10(desiredStep));
        const candidates = [1, 1.25, 1.5, 2, 2.5, 4, 5, 7.5, 10].map(value => value * magnitude);
        const ringStep = candidates.filter(value => value * scale >= 48)
            .sort((left, right) => Math.abs(left - desiredStep) - Math.abs(right - desiredStep))[0] ?? candidates.at(-1);
        const tickDecimals = Math.abs(ringStep * 100 - Math.round(ringStep * 100)) < 1e-8 ? 2 : 3;
        context.font = '10px system-ui, sans-serif';
        context.textAlign = 'center';
        for (let C = ringStep; C < extent; C += ringStep) {
            context.beginPath();
            context.arc(origin.x, origin.y, C * scale, 0, TAU);
            context.stroke();
            const x = origin.x + C * scale;
            if (x > 20 && x < cssSize - 18 && origin.y >= 14 && origin.y < cssSize - 8) {
                const label = C.toFixed(tickDecimals);
                const labelWidth = context.measureText(label).width + 8;
                context.fillStyle = 'rgba(255,255,255,.85)';
                context.fillRect(x - labelWidth / 2, origin.y - 11, labelWidth, 15);
                context.fillStyle = '#3f4543';
                context.fillText(label, x, origin.y);
            }
        }
        context.setLineDash([]);
        const strokeBoundary = (points, stroke, dash, width) => {
            pathBoundary(points);
            context.strokeStyle = stroke;
            context.setLineDash(dash);
            context.lineWidth = width;
            context.stroke();
        };
        strokeBoundary(p3Boundary, '#81778e', [6, 4], 1.4);
        strokeBoundary(srgbBoundary, 'rgba(255,255,255,.9)', [], 3.3);
        strokeBoundary(srgbBoundary, '#34463e', [], 1.2);
        if (L >= options.domain.lightness[0] && L <= options.domain.lightness[1]) {
            const span = hueSpan(options.domain);
            const steps = Math.max(2, Math.ceil(span * 2));
            const outer = [], inner = [];
            for (let index = 0; index <= steps; index++)
                outer.push(toPoint({ L, C: options.domain.chroma[1], h: options.domain.hue[0] + span * index / steps }));
            for (let index = steps; index >= 0; index--)
                inner.push(toPoint({ L, C: options.domain.chroma[0], h: options.domain.hue[0] + span * index / steps }));
            // A complete hue circle has no radial seam; a partial arc does have two hue boundaries.
            for (const points of span >= 360 ? [outer, inner] : [[...outer, ...inner]]) {
                strokeBoundary(points, '#f9fffa', [], 4);
                strokeBoundary(points, '#247c64', [5, 4], 2);
            }
        }
        // Hard chroma limits measure distance from the neutral RGB axis in this a/b
        // slice. Draw outlines only: the original sRGB colors remain visible inside
        // and outside the allowed annulus, with hard-check hatching applied above.
        context.save();
        context.beginPath();
        context.rect(0, 0, cssSize, cssSize);
        context.clip();
        context.setLineDash([]);
        for (const C of new Set([minimumChroma, maximumChroma])) {
            if (!(C > 0) || !Number.isFinite(C))
                continue;
            context.beginPath();
            context.arc(origin.x, origin.y, C * scale, 0, TAU);
            context.strokeStyle = 'rgba(255,255,255,.92)';
            context.lineWidth = 3.8;
            context.stroke();
            context.strokeStyle = '#9a5d22';
            context.lineWidth = 1.6;
            context.stroke();
        }
        // Keep the neutral-axis marker small and omit its label if zoom pushes it
        // against the edge; clipped rings still describe the same centered bounds.
        if (origin.x >= 5 && origin.x <= cssSize - 5 && origin.y >= 5 && origin.y <= cssSize - 5) {
            context.beginPath();
            context.arc(origin.x, origin.y, 2.4, 0, TAU);
            context.fillStyle = '#57605b';
            context.fill();
            context.strokeStyle = '#fff';
            context.lineWidth = 1;
            context.stroke();
            const label = 'C=0';
            context.font = '9px system-ui, sans-serif';
            context.textAlign = 'left';
            const labelWidth = context.measureText(label).width;
            if (origin.x + labelWidth + 9 < cssSize && origin.y + 15 < cssSize) {
                context.lineWidth = 2.5;
                context.strokeStyle = 'rgba(255,255,255,.9)';
                context.strokeText(label, origin.x + 6, origin.y + 12);
                context.fillStyle = '#57605b';
                context.fillText(label, origin.x + 6, origin.y + 12);
            }
        }
        context.restore();
        context.setLineDash([]);
        if (zoom === 1) {
            const inset = 16;
            context.fillStyle = '#686c67';
            context.font = '11px system-ui, sans-serif';
            context.fillText('90° 黄', cssSize / 2, inset);
            context.fillText('270° 蓝', cssSize / 2, cssSize - 9);
            context.textAlign = 'left';
            context.fillText('180° 青', 8, cssSize / 2 - 10);
            context.textAlign = 'right';
            context.fillText('0° 红', cssSize - 8, cssSize / 2 - 10);
        }
        positionMarker(selectedMarker, selected);
        if (preview)
            positionMarker(hoverMarker, toPoint(preview));
        zoomOut.disabled = zoom <= 1;
        zoomIn.disabled = zoom >= 5;
        const lightnessOutside = L < options.domain.lightness[0] || L > options.domain.lightness[1];
        status.textContent = lightnessOutside ? '当前明度不在生成范围内；可继续探索，或调整下方明度 / 全局生成范围。' : '图中可自由选色；生成前会检查所选主色与全局规则是否兼容。';
    }
    function showPreview(lch, x, y) {
        preview = lch;
        const hex = oklchToHex(lch);
        const actual = hex ? parseColor(hex) : null;
        const metrics = actual?.lch ?? lch;
        const report = hex ? checker(hex) : null;
        const point = toPoint(lch);
        const p3 = inGamut(linearP3(L, point.a, point.b));
        tooltipHex.textContent = hex ?? '无 sRGB HEX';
        tooltipSwatch.style.background = hex ?? '#e9e9ed';
        tooltipMetrics.textContent = `L ${(metrics.L * 100).toFixed(1)}% · C ${metrics.C.toFixed(3)} · h ${metrics.C < .0001 ? '—' : `${metrics.h.toFixed(1)}°`}`;
        if (hex && report) {
            const contrast = contrastRatio(hex, options.constraints.textColor);
            tooltipStatus.textContent = `文字对比 ${contrast.toFixed(2)}:1 · ${report.hardAllowed ? '符合生成条件' : '可编辑 · 生成条件未通过'}`;
            tooltipReason.textContent = report.hardAllowed ? '当前切片上的实码颜色；点击或松开鼠标应用。' : report.issues.map(issue => issue.message).join(' ');
        }
        else {
            tooltipStatus.textContent = p3 ? '仅在 Display P3 内' : '超出 Display P3';
            tooltipReason.textContent = '当前输出使用 sRGB HEX。向中心移动以降低彩度，再选择颜色。';
        }
        tooltip.dataset.allowed = report?.hardAllowed ? 'yes' : 'no';
        tooltip.hidden = false;
        positionMarker(hoverMarker, point);
        const location = coordinates(point);
        const px = x ?? location.x, py = y ?? location.y;
        // Keep the floating card on-canvas, including narrow/mobile layouts.
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        tooltip.style.left = `${clamp(px + 18 + width > stage.clientWidth ? px - width - 18 : px + 18, 8, Math.max(8, stage.clientWidth - width - 8))}px`;
        tooltip.style.top = `${clamp(py - 18 - height < 8 ? py + 18 : py - 18 - height, 8, Math.max(8, stage.clientHeight - height - 8))}px`;
        return hex;
    }
    function previewPointer(event) {
        // Pointer and keyboard edits have separate starting points. A hover (including
        // an out-of-gamut hover) must not become the first keyboard adjustment's base.
        keyboardPreview = null;
        const bounds = canvas.getBoundingClientRect();
        lastPointer = { x: clamp(event.clientX - bounds.left, 0, bounds.width), y: clamp(event.clientY - bounds.top, 0, bounds.height) };
        if (hoverFrame)
            return;
        hoverFrame = requestAnimationFrame(() => {
            hoverFrame = 0;
            if (destroyed || !lastPointer)
                return;
            const { x, y } = lastPointer;
            showPreview(toLch(L, pointAt(x, y)), x, y);
        });
    }
    function applyPreview(lch) {
        const hex = oklchToHex(lch);
        if (!hex) {
            status.textContent = '此处超出 sRGB，尚未修改颜色；向中心移动以降低彩度。';
            return;
        }
        // Selecting a color and checking generation feasibility are deliberately independent.
        // onPick may synchronously destroy this entire mount; no work follows the callback.
        options.onPick(hex);
    }
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0)
            return;
        options.onEditStart?.();
        dragging = true;
        canvas.setPointerCapture(event.pointerId);
        canvas.focus({ preventScroll: true });
        previewPointer(event);
    });
    canvas.addEventListener('pointermove', previewPointer);
    canvas.addEventListener('pointerup', event => {
        if (!dragging)
            return;
        dragging = false;
        cancelAnimationFrame(hoverFrame);
        hoverFrame = 0;
        if (canvas.hasPointerCapture(event.pointerId))
            canvas.releasePointerCapture(event.pointerId);
        const bounds = canvas.getBoundingClientRect();
        const x = clamp(event.clientX - bounds.left, 0, bounds.width);
        const y = clamp(event.clientY - bounds.top, 0, bounds.height);
        const lch = toLch(L, pointAt(x, y));
        showPreview(lch, x, y);
        applyPreview(lch);
    });
    canvas.addEventListener('pointercancel', () => {
        dragging = false;
        cancelAnimationFrame(hoverFrame);
        hoverFrame = 0;
        tooltip.hidden = hoverMarker.hidden = true;
    });
    canvas.addEventListener('pointerleave', () => {
        if (!dragging) {
            cancelAnimationFrame(hoverFrame);
            hoverFrame = 0;
            tooltip.hidden = hoverMarker.hidden = true;
        }
    });
    canvas.addEventListener('keydown', event => {
        // A queued pointer frame must not overwrite a keyboard preview after this event.
        cancelAnimationFrame(hoverFrame);
        hoverFrame = 0;
        lastPointer = null;
        if (event.key === 'Escape') {
            preview = null;
            keyboardPreview = null;
            tooltip.hidden = hoverMarker.hidden = true;
            return;
        }
        if (event.key === 'Enter' && keyboardPreview) {
            event.preventDefault();
            options.onEditStart?.();
            applyPreview(keyboardPreview);
            return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
            return;
        event.preventDefault();
        options.onEditStart?.();
        const next = { ...(keyboardPreview ?? color.lch) };
        const factor = event.shiftKey ? 5 : 1;
        if (event.key === 'ArrowLeft')
            next.h = (next.h - 2 * factor + 360) % 360;
        if (event.key === 'ArrowRight')
            next.h = (next.h + 2 * factor) % 360;
        if (event.key === 'ArrowUp')
            next.C = Math.min(.5, next.C + .003 * factor);
        if (event.key === 'ArrowDown')
            next.C = Math.max(0, next.C - .003 * factor);
        keyboardPreview = next;
        showPreview(next);
        status.textContent = `预览色相 ${next.h.toFixed(1)}°、彩度 ${next.C.toFixed(3)}；按 Enter 应用。`;
    });
    function closeExpanded() {
        expandedView?.destroy();
        expandedView = null;
        dialog?.close();
        dialog?.remove();
        dialog = null;
    }
    if (!expanded) {
        controls.append(makeButton(Maximize2, '在大视图中探索颜色', () => {
            if (dialog)
                return;
            dialog = element('dialog', 'color-space-dialog');
            dialog.setAttribute('aria-label', '展开色彩地图');
            const head = element('div', 'color-space-dialog-header');
            head.append(element('strong', '', '色彩地图'), makeButton(X, '关闭展开视图', closeExpanded));
            const content = element('div', 'color-space-dialog-content');
            dialog.append(head, content);
            document.body.append(dialog);
            dialog.addEventListener('cancel', event => { event.preventDefault(); closeExpanded(); });
            dialog.showModal();
            expandedView = mount(content, { ...options, onPick: hex => { closeExpanded(); options.onPick(hex); } }, true);
        }));
    }
    const observer = new ResizeObserver(requestDraw);
    observer.observe(stage);
    requestDraw();
    return {
        destroy() {
            destroyed = true;
            observer.disconnect();
            cancelAnimationFrame(redrawFrame);
            cancelAnimationFrame(hoverFrame);
            closeExpanded();
            shell.remove();
        },
    };
}
