import { useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, Copy, SlidersHorizontal } from 'lucide-react';
import { contrastRatio, normalizeHex, oklchToHex, parseColor, type Lch } from '../color';
import { mountColorSpace } from '../color-space';
import { checkCandidate } from '../generator';
import { effectiveDomain, type Project } from '../project';

export type EditorTarget = { index: number };

interface ColorEditorProps {
  project: Project;
  editor: EditorTarget | null;
  onColor: (hex: string) => void;
  onNotice: (text: string) => void;
  onEditStart: () => void;
}

const parameters = [
  { key: 'L', label: '明度', left: '暗一些', right: '亮一些', help: '决定感知的明暗。它不等于文字对比度；对比还取决于文字色。', min: 0, max: 1, step: .005 },
  { key: 'h', label: '色相', left: '沿色环移动', right: '0° = 360°', help: '决定偏红、黄、绿还是蓝。接近灰色时，改变色相的视觉影响很小。', min: 0, max: 360, step: 1 },
  { key: 'C', label: '彩度', left: '更灰、更柔和', right: '更鲜明', help: '决定离中性灰有多远。灰色轨道表示该明度和色相下超出 sRGB。', min: 0, max: .4, step: .002 },
] as const;

const directions = [
  { name: '更明亮', key: 'L', amount: .04, why: '增加明度，让底色更轻；白字对比通常降低。' },
  { name: '更沉稳', key: 'L', amount: -.04, why: '降低明度，让底色更深；白字对比通常提高。' },
  { name: '更柔和', key: 'C', amount: -.015, why: '靠近中性灰，减弱鲜艳感，保留色相方向。' },
  { name: '更鲜明', key: 'C', amount: .015, why: '远离中性灰，增强色感，可能触及 sRGB 边界。' },
  { name: '色相 −15°', key: 'h', amount: -15, why: '沿色环向前探索，保持明度和彩度。' },
  { name: '色相 +15°', key: 'h', amount: 15, why: '沿色环向后探索，寻找另一侧的邻近色。' },
] as const;

function directionColor(lch: Lch, key: keyof Lch, delta: number) {
  const next = { ...lch, [key]: lch[key] + delta };
  if (key === 'h') next.h = (next.h + 360) % 360;
  if (next.L < 0 || next.L > 1 || next.C < 0 || next.C > .4) return null;
  return oklchToHex(next);
}

function gradient(lch: Lch, key: keyof Lch) {
  const stops = Array.from({ length: 15 }, (_, i) => {
    const value = key === 'L' ? i / 14 : key === 'C' ? i / 14 * .4 : i / 14 * 360;
    return oklchToHex({ ...lch, [key]: value }) ?? '#dfe2df';
  });
  return `linear-gradient(90deg,${stops.join(',')})`;
}

const numberStrings = (lch: Lch): Record<keyof Lch, string> => ({
  L: lch.L.toFixed(3), h: lch.h.toFixed(1), C: lch.C.toFixed(3),
});

/** Switching the edited color resets only its draft; unrelated app state preserves the editor DOM. */
export function ColorEditor(props: ColorEditorProps) {
  const { project, editor } = props;
  const hex = editor ? project.colors[editor.index] : undefined;
  if (!editor || !hex) return <div className="editor-empty">
    <SlidersHorizontal aria-hidden="true" /><strong>给颜色一点方向</strong>
    <p>在右侧添加或选择颜色，<br />在色彩图中分析，再用参数微调。</p>
  </div>;
  return <ActiveEditor key={editor.index} {...props} editor={editor} hex={hex} />;
}

function ActiveEditor({ project, editor, hex, onColor, onNotice, onEditStart }: ColorEditorProps & { editor: EditorTarget; hex: string }) {
  const initialLch = parseColor(hex)!.lch;
  const [draftLch, setDraftLch] = useState<Lch>(initialLch);
  const [numberDraft, setNumberDraft] = useState(() => numberStrings(initialLch));
  const [hexDraft, setHexDraft] = useState(hex);
  const draftRef = useRef(draftLch);
  const rangePending = useRef(false);
  const hexPending = useRef(false);
  const numberPending = useRef(new Set<keyof Lch>());
  const spaceHost = useRef<HTMLDivElement>(null);
  const restoreMapFocus = useRef(false);
  const callbacks = useRef({ onColor, onEditStart });
  callbacks.current = { onColor, onEditStart };

  const existing = project.colors.filter((_, index) => index !== editor.index);
  const domain = effectiveDomain(project);
  // The drawing API is imperative, but its lifecycle depends on color inputs only.
  // A toast, selection change, or worker status update must not discard map zoom/focus.
  const existingKey = JSON.stringify(existing);
  const constraintKey = JSON.stringify(project.constraints);
  const domainKey = JSON.stringify(domain);

  useEffect(() => {
    const lch = parseColor(hex)!.lch;
    draftRef.current = lch;
    setDraftLch(lch);
    setNumberDraft(numberStrings(lch));
    setHexDraft(hex);
    rangePending.current = hexPending.current = false;
    numberPending.current.clear();
  }, [hex]);

  useEffect(() => {
    const host = spaceHost.current;
    if (!host) return;
    const space = mountColorSpace(host, {
      hex, existing, constraints: project.constraints, domain,
      onEditStart: () => callbacks.current.onEditStart(),
      onPick: picked => callbacks.current.onColor(picked),
    });
    if (restoreMapFocus.current) host.querySelector('canvas')?.focus({ preventScroll: true });
    restoreMapFocus.current = false;
    return () => {
      restoreMapFocus.current = host.querySelector('canvas') === document.activeElement;
      space.destroy();
    };
  }, [hex, existingKey, constraintKey, domainKey]);

  function setDraft(next: Lch) {
    draftRef.current = next;
    setDraftLch(next);
    setNumberDraft(numberStrings(next));
  }

  function resetDraft() {
    setDraft(parseColor(hex)!.lch);
    setHexDraft(hex);
    rangePending.current = hexPending.current = false;
    numberPending.current.clear();
  }

  function applyHex(next: string) {
    setDraft(parseColor(next)!.lch);
    setHexDraft(next);
    rangePending.current = hexPending.current = false;
    numberPending.current.clear();
    if (next !== hex) {
      onEditStart();
      onColor(next);
    }
  }

  function commitLch(next: Lch) {
    const nextHex = oklchToHex(next);
    if (!nextHex) {
      onNotice('此颜色超出 sRGB，尚未应用。请减小彩度或调整明度。');
      resetDraft();
      return;
    }
    applyHex(nextHex);
  }

  function commitHex() {
    if (!hexPending.current) return;
    const next = normalizeHex(hexDraft);
    if (!next) {
      onNotice('请输入有效的 HEX 色码。');
      resetDraft();
      return;
    }
    applyHex(next);
  }

  function commitNumber(key: keyof Lch, raw: string) {
    if (!numberPending.current.has(key)) return;
    const parameter = parameters.find(item => item.key === key)!;
    const value = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) {
      onNotice(`${parameter.label}需要在 ${parameter.min}–${parameter.max} 之间。`);
      resetDraft();
      return;
    }
    commitLch({ ...draftRef.current, [key]: value });
  }

  function commitRange() {
    if (!rangePending.current) return;
    rangePending.current = false;
    commitLch(draftRef.current);
  }

  const previewHex = oklchToHex(draftLch);
  const displayHex = previewHex ?? hex;
  const check = checkCandidate(displayHex, existing, project.constraints, domain);
  const allowed = Boolean(previewHex) && check.hardAllowed;

  return <>
    <div className="section-head compact">
      <h3>颜色 {editor.index + 1}</h3>
    </div>
    <div className="editor-preview" style={{ background: displayHex, color: project.constraints.textColor }}>
      <span>Aa <small>课程预览</small></span><span id="preview-hex">{displayHex}</span>
    </div>
    <label className="field hex-field"><span>HEX <small>sRGB 色码</small></span><div className="row">
      <input id="editor-hex" value={hexDraft} maxLength={7} spellCheck={false} aria-label="当前颜色 HEX"
        onChange={event => { hexPending.current = true; setHexDraft(event.currentTarget.value); onEditStart(); }}
        onBlur={commitHex} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commitHex(); }
          if (event.key === 'Escape') { event.preventDefault(); resetDraft(); }
        }} />
      <button type="button" className="icon-button" aria-label="复制当前 HEX" onClick={async () => {
        try { await navigator.clipboard.writeText(hex); onNotice(`已复制 ${hex}`); }
        catch { onNotice('复制失败，请手动复制 HEX。'); }
      }}><Copy aria-hidden="true" /></button>
    </div></label>
    <div className="space-heading"><strong>在色彩空间中探索</strong><small>固定当前明度 L</small></div>
    <div id="color-space" ref={spaceHost} />
    <div className="fine-controls">{parameters.map(parameter => {
      const { key, label, left, right, help, min, max, step } = parameter;
      return <div className="parameter" key={key}>
        <div className="parameter-head"><label htmlFor={`range-${key}`}>{label} <small>{key}</small></label>
          <input data-lch={key} type="number" min={min} max={max} step={step} value={numberDraft[key]} aria-label={`${label}数值`}
            onChange={event => {
              const raw = event.currentTarget.value;
              numberPending.current.add(key);
              setNumberDraft(previous => ({ ...previous, [key]: raw }));
              const value = raw.trim() === '' ? NaN : Number(raw);
              if (Number.isFinite(value) && value >= min && value <= max) {
                draftRef.current = { ...draftRef.current, [key]: value };
                setDraftLch(draftRef.current);
              }
              onEditStart();
            }} onBlur={event => commitNumber(key, event.currentTarget.value)} onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); commitNumber(key, event.currentTarget.value); }
              if (event.key === 'Escape') { event.preventDefault(); resetDraft(); }
            }} />
        </div>
        <input id={`range-${key}`} data-lch={key} type="range" min={min} max={max} step={step} value={draftLch[key]}
          style={{ background: gradient(draftLch, key) }} aria-label={`${label}滑块`}
          onChange={event => { rangePending.current = true; setDraft({ ...draftRef.current, [key]: Number(event.currentTarget.value) }); onEditStart(); }}
          onPointerUp={commitRange} onPointerCancel={resetDraft} onBlur={commitRange}
          onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitRange(); }} />
        <div className="range-labels"><span>{left}</span><span>{right}</span></div><p className="parameter-help">{help}</p>
      </div>;
    })}</div>
    <div className={`color-status${allowed ? '' : ' warn'}`}>
      {allowed ? <Check aria-hidden="true" /> : <CircleHelp aria-hidden="true" />}
      <div><strong>{!previewHex ? '超出 sRGB · 尚未应用' : allowed ? '当前颜色符合生成规则' : '可编辑 · 生成前需要调整'}</strong>
        <p>{!previewHex ? '减小彩度或调整明度后再应用。' : <>文字对比 {contrastRatio(displayHex, project.constraints.textColor).toFixed(2)}:1{!check.hardAllowed ? ` · ${check.issues[0]?.message ?? '请检查全局规则'}` : ''}</>}</p>
      </div>
    </div>
    <div className="direction-head"><h3>试一个方向</h3><small>每次一小步，可连续尝试</small></div>
    <div className="direction-grid">{directions.map(direction => {
      const next = directionColor(draftLch, direction.key, direction.amount);
      const result = next ? checkCandidate(next, existing, project.constraints, domain) : null;
      const trail = [.5, 1, 1.5].map(factor => directionColor(draftLch, direction.key, direction.amount * factor));
      return <button type="button" key={direction.name} className="direction" disabled={!next || next === hex}
        onClick={() => { if (next) applyHex(next); }}
        title={`${direction.why}${result && !result.hardAllowed ? ` ${result.issues[0]?.message ?? ''}` : ''}`}>
        <span className="direction-top"><strong>{direction.name}</strong><span className="direction-trail">{trail.map((color, index) => <i key={index} style={{ background: color ?? '#e5e8e5' }} />)}</span></span>
        <span>{direction.key} {direction.amount > 0 ? '+' : ''}{direction.amount} · {!next ? '已到色域边缘' : result!.hardAllowed ? '符合规则' : '需调整规则'}</span>
        <small>{direction.why}</small>
      </button>;
    })}</div>
  </>;
}
