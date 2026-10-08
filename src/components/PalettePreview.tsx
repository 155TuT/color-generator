import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { effectiveDomain, makeExample, type Project } from '../project';
import { validatePalette } from '../generator';
import { analyzePalette } from '../palette-analysis';
import { mountDistribution, type DistributionView } from '../distribution-view';
import type { PresetId } from './GlobalSettings';

const fmt = (value: number | null) => value === null ? '—' : value.toFixed(2);

export function PalettePreview({ project, preset, canAddColor, onClose, onUsePrimaries, onAddColor }: {
  project: Project; preset?: PresetId; canAddColor: boolean; onClose: () => void;
  onUsePrimaries: (preset: PresetId) => void; onAddColor: (hex: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), chart = useRef<HTMLDivElement>(null);
  const distribution = useRef<DistributionView | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const validation = validatePalette(project.colors, project.constraints, effectiveDomain(project));
  const d = analyzePalette(project.colors).distributions;
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  useEffect(() => {
    const view = mountDistribution(chart.current!, project.colors, project.constraints.textColor, { onActivate: setActiveIndex });
    distribution.current = view;
    return () => { view.destroy(); distribution.current = null; };
  }, [project.colors, project.constraints.textColor]);
  useEffect(() => {
    distribution.current?.setSelection({ activeIndex, selectedIndices: activeIndex === null ? [] : [activeIndex] });
  }, [activeIndex, project.colors, project.constraints.textColor]);

  return <dialog ref={dialog} id="palette-dialog" aria-labelledby="palette-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="section-head preview-header"><div><span className="eyebrow">{preset ? '固定示例 · 原始 25 色' : '当前色板 · 空间分布'}</span><h2 id="palette-dialog-title">{project.name || '当前色板'}</h2></div><div className="row">{preset && <button onClick={() => onUsePrimaries(preset)}><Plus />使用主色</button>}<button className="icon-button" onClick={onClose} aria-label="关闭色板预览"><X /></button></div></div>
    <p className="help">{preset ? '点击颜色查看两图中的位置与分析；加号可逐个取色，使用主色可载入代表主色和边界。原始色板保持不变。' : '查看当前颜色之间的衔接，不改变颜色或排列。'}</p>
    {preset && <div className="preview-anchors">{makeExample(preset).anchors.map((hex, index) => <button key={index} disabled={!canAddColor} title={canAddColor ? '添加到色板' : '色板已有 25 色，请先删除颜色'} onClick={() => onAddColor(hex)} aria-label={`添加示例主色 ${hex}`}><i style={{ background: hex }} /><span>{hex}</span><Plus /></button>)}</div>}
    {preset && !canAddColor && <p className="preview-capacity-note">色板已有 25 色，取色已停用；仍可查看颜色分析或使用主色。</p>}
    <div className="preview-palette">{project.colors.map((hex, index) => <div key={index} className={activeIndex === index ? 'preview-swatch is-active' : 'preview-swatch'}>
      <button className="preview-color-select" onClick={() => setActiveIndex(index)} aria-label={`查看示例色 ${hex}`} aria-pressed={activeIndex === index} style={{ background: hex, color: project.constraints.textColor }}><span>Aa</span><small>{hex}</small></button>
      {preset && <button className="preview-color-plus" disabled={!canAddColor} onClick={() => onAddColor(hex)} aria-label={`添加示例色 ${hex}`} title={canAddColor ? '添加到色板' : '色板已有 25 色，请先删除颜色'}><Plus aria-hidden="true" /></button>}
    </div>)}</div>
    <p className="style-explanation">{preset === 'forest' ? '雾绿 → 蓝绿 → 雾蓝在同一段色相弧内连接；明度、色相和彩度共同变化。' : preset === 'clay' ? '灰蓝 → 藕紫 → 玫瑰 → 陶土跨过 0° 连续相接。原色最大底色对比为 3.42:1，示例采用 3.5 上限。' : '近邻距离与连接步长描述连续性，极值用于检查硬约束。'}</p>
    <div ref={chart} id="example-distribution" />
    <div className="preview-metrics"><span>最近邻中位 {fmt(d.nearestNeighborDeltaE.median)}</span><span>最近邻 P90 {fmt(d.nearestNeighborDeltaE.p90)}</span><span>最大连接步长 {fmt(d.mstDeltaE.max)}</span></div>
    <p className="help">全部 {project.colors.length * (project.colors.length - 1) / 2} 对：色差中位 {fmt(d.pairDeltaE.median)} / P90 {fmt(d.pairDeltaE.p90)}；底色对比中位 {fmt(d.pairContrast.median)}:1 / P90 {fmt(d.pairContrast.p90)}:1。</p>
    <div className="preview-metrics"><span>最小色差 {fmt(validation.minDeltaE)}</span><span>底色最大 {fmt(validation.maxBackgroundContrast)}:1</span><span>文字最低 {fmt(validation.minTextContrast)}:1</span></div>
    <details><summary>查看生成规则与边界</summary><pre>{JSON.stringify({ constraints: project.constraints, domain: effectiveDomain(project), seed: project.seed }, null, 2)}</pre></details>
    <p className="help">{validation.valid ? '此色板通过所展示的规则。' : '此色板含有约束冲突。'}{preset && '使用主色保留工作台的文字色和最低文字对比；逐个取色保持全部当前规则。'}</p>
  </dialog>;
}
