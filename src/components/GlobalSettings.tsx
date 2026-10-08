import { Fragment, useEffect, useRef, useState } from 'react';
import { RotateCcw, Shuffle } from 'lucide-react';
import { normalizeHex } from '../color';
import { effectiveDomain, makeExample, type Project } from '../project';
import type { ColorDomain, ConstraintConfig } from '../types';

export type PresetId = 'forest' | 'clay';

interface GlobalSettingsProps {
  project: Project;
  onChange: (project: Project, message: string) => void;
  onPreview: (preset: PresetId) => void;
  onEditStart: () => void;
  onNotice: (message: string) => void;
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onEditStart: () => void;
  onNotice: (message: string) => void;
  onCommit: (value: number) => boolean;
}

/** Keep unfinished edits local so an unrelated project render cannot erase them. */
function NumberField({ id, label, value, min, max, step, onEditStart, onNotice, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  const edited = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);

  const commit = () => {
    focused.current = false;
    if (!edited.current) { setDraft(String(value)); return; }
    edited.current = false;
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > max) {
      onNotice(`${label}需要 ${min}–${max} 范围内的有效数值。`);
      setDraft(String(value));
      return;
    }
    setDraft(onCommit(next) ? String(next) : String(value));
  };

  return <input id={id} type="number" aria-label={label} min={min} max={max} step={step} value={draft}
    onFocus={() => { focused.current = true; }}
    onChange={event => { edited.current = true; setDraft(event.target.value); onEditStart(); }}
    onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); edited.current = false; setDraft(String(value)); event.currentTarget.blur(); }
    }} />;
}

function TextColorField({ value, onEditStart, onNotice, onCommit }: {
  value: string;
  onEditStart: () => void;
  onNotice: (message: string) => void;
  onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const edited = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return <input id="text-color" value={draft} aria-label="课程文字 HEX" maxLength={7}
    onFocus={() => { focused.current = true; }}
    onChange={event => { edited.current = true; setDraft(event.target.value); onEditStart(); }}
    onBlur={() => {
      focused.current = false;
      if (!edited.current) { setDraft(value); return; }
      edited.current = false;
      const hex = normalizeHex(draft);
      if (!hex) { onNotice('请输入有效的三位或六位 HEX 文字色。'); setDraft(value); return; }
      setDraft(hex);
      onCommit(hex);
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); edited.current = false; setDraft(value); event.currentTarget.blur(); }
    }} />;
}

const constraintFields = [
  ['minDeltaE', '色差下限', 0, 100, 0.1, '避免过度相似，不以拉大距离为目标。'],
  ['maxBackgroundContrast', '底色对比上限', 1, 21, 0.05, '限制整套底色的深浅跨度。'],
] as const;

const domainFields = [
  ['lightness', '明度 L', 1, 0.005],
  ['hue', '色相 h / °', 360, 1],
  ['chroma', '彩度 C', 0.4, 0.005],
] as const;

export function GlobalSettings({ project, onChange, onPreview, onEditStart, onNotice }: GlobalSettingsProps) {
  const c = project.constraints;
  const d = effectiveDomain(project);
  const contrastMax = Math.max(7, c.minTextContrast);

  const setConstraint = <K extends keyof ConstraintConfig>(key: K, value: ConstraintConfig[K]) => {
    if ((key === 'minChroma' && Number(value) > c.maxChroma) || (key === 'maxChroma' && Number(value) < (c.minChroma ?? 0))) {
      onNotice('彩度下限不能大于上限，请先调整另一端。');
      return false;
    }
    onEditStart();
    onChange({ ...project, constraints: { ...c, [key]: value } },
      key === 'textColor' ? '文字颜色已更新，请查看当前对比度。' : '全局规则已更新，现有色板已重新检查。');
    return true;
  };

  const setDomainBound = (key: keyof ColorDomain, end: number, value: number) => {
    const domain = effectiveDomain(project);
    const range = [...domain[key]] as [number, number];
    range[end] = value;
    if (key !== 'hue' && range[0] > range[1]) {
      onNotice('区间下界不能大于上界。');
      return false;
    }
    domain[key] = range;
    onChange({ ...project, domain, domainMode: 'manual' }, '生成边界已固定为自定义范围。');
    return true;
  };

  return <>
    <div className="settings-head">
      <h1>全局规则</h1>
      <div className="style-presets">
        <span>风格预设</span>
        {(['forest', 'clay'] as const).map(id => {
          const preset = makeExample(id);
          return <div className="style-preset" key={id}>
            <button type="button" onClick={() => onPreview(id)} title={`查看${preset.name}原色板与分布`} aria-label={`查看${preset.name}原色板与分布`}>
              <span className="preset-colors" aria-hidden="true">{preset.anchors.slice(0, 5).map(hex => <i key={hex} style={{ background: hex }} />)}</span>
              {preset.name}
            </button>
          </div>;
        })}
      </div>
    </div>

    <div className="settings-topline">
      <label className="field"><span>课程文字颜色</span><div className="row">
        <input id="text-picker" type="color" value={c.textColor} aria-label="选择课程文字颜色" onChange={event => setConstraint('textColor', event.target.value.toUpperCase())} />
        <TextColorField value={c.textColor} onEditStart={onEditStart} onNotice={onNotice} onCommit={hex => setConstraint('textColor', hex)} />
      </div></label>

      <div className="contrast-control parameter">
        <div className="parameter-head">
          <label htmlFor="text-contrast-range">最低文字对比度 <small>:1</small></label>
          <NumberField id="text-contrast-number" label="最低文字对比度数值" value={c.minTextContrast} min={1} max={21} step={0.05}
            onEditStart={onEditStart} onNotice={onNotice} onCommit={value => setConstraint('minTextContrast', value)} />
        </div>
        <input id="text-contrast-range" type="range" min={1} max={contrastMax} step={0.05} value={c.minTextContrast}
          aria-label="最低文字对比度滑杆" aria-describedby="contrast-description" style={{ background: 'linear-gradient(90deg,#d6dfcd,#8a9d78,#39502f)' }}
          onChange={event => setConstraint('minTextContrast', Number(event.target.value))} />
        <div className="contrast-ticks"><span>1</span>{[1.65, 4.5].map(value => <button key={value} type="button"
          style={{ left: `${(value - 1) / (contrastMax - 1) * 100}%` }} aria-label={`文字对比度设为 ${value}`}
          onClick={() => setConstraint('minTextContrast', value)}>{value}</button>)}<span>{contrastMax}</span></div>
        <p id="contrast-description" className="parameter-help">{c.minTextContrast < 4.5
          ? '当前低于常规正文 4.5:1；浅色风格可搭配深色文字。'
          : '提高下限会排除更多浅底白字组合，不会自动改动现有颜色。'}</p>
      </div>

      <label className="field"><span>生成种子 <small>相同输入可复现</small></span><div className="row">
        <input id="seed" value={project.seed} aria-label="生成种子" maxLength={100} onChange={event => {
          onEditStart();
          onChange({ ...project, seed: event.target.value }, '生成种子已更新，下次生成使用新种子。');
        }} />
        <button type="button" className="icon-button" aria-label="更换生成种子" onClick={() => {
          onEditStart();
          onChange({ ...project, seed: `palette-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}` }, '已更换种子，下次生成探索另一组结果。');
        }}><Shuffle aria-hidden="true" /></button>
      </div></label>
    </div>

    <div className="settings-detail-grid" id="advanced">
      <section aria-label="高级选项">
        <h3>高级选项</h3>
        <div className="constraint-grid">{constraintFields.map(([key, label, min, max, step, help]) => <label className="field" key={key}>
          <span>{label}</span>
          <NumberField id={`constraint-${key}`} label={label} value={c[key]} min={min} max={max} step={step}
            onEditStart={onEditStart} onNotice={onNotice} onCommit={value => setConstraint(key, value)} />
          <small>{help}</small>
        </label>)}<div className="field chroma-constraint">
          <span>彩度范围 C</span><div className="row">
            <NumberField id="constraint-minChroma" label="彩度下限" value={c.minChroma ?? 0} min={0} max={0.4} step={0.005}
              onEditStart={onEditStart} onNotice={onNotice} onCommit={value => setConstraint('minChroma', value)} />
            <span className="range-to">至</span>
            <NumberField id="constraint-maxChroma" label="彩度上限" value={c.maxChroma} min={0} max={0.4} step={0.005}
              onEditStart={onEditStart} onNotice={onNotice} onCommit={value => setConstraint('maxChroma', value)} />
          </div><small>下限避开黑白灰轴，上限控制鲜艳程度。</small>
        </div></div>
        <p className="settings-method">颜色相距远时补过渡，局部密集时向相邻色系探索；新增与生成沿用同一步骤。</p>
      </section>

      <section aria-label="自定义色彩范围">
        <div className="section-head compact"><h3>自定义色彩范围</h3><button type="button" className="text-button" onClick={() => {
          onEditStart();
          onChange({ ...project, domainMode: 'auto', growth: project.growth ? { ...project.growth, styleDomain: null } : undefined }, '生成边界已根据当前色板重新建立。');
        }}><RotateCcw aria-hidden="true" />重置为色板范围</button></div>
        <div className="domain-grid">{domainFields.map(([key, label, max, step]) => <div className="field" key={key}>
          <span>{label}</span><div className="row">{d[key].map((value, end) => <Fragment key={end}>
            {end === 1 && <span className="range-to">至</span>}
            <NumberField id={`domain-${key}-${end}`} label={`${label} ${end === 0 ? '下界' : '上界'}`} value={Number(value.toFixed(4))} min={0} max={max} step={step}
              onEditStart={onEditStart} onNotice={onNotice} onCommit={next => setDomainBound(key, end, next)} />
          </Fragment>)}</div>
        </div>)}</div>
        <p className="settings-method">{project.domainMode === 'manual' ? '已固定自定义边界。' : '自动范围限定相邻色系，直接编辑即可固定。'}色相沿递增方向取弧，330° → 45° 跨过 0°。</p>
      </section>
    </div>
  </>;
}
