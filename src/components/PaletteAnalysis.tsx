import { useLayoutEffect, useMemo, useRef } from 'react';
import { mountDistribution } from '../distribution-view';
import { analyzePalette } from '../palette-analysis';
import type { Project } from '../project';
import type { ColorDomain, PaletteValidation } from '../types';

const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
type Metric = { id: string; label: string; value: number | null | undefined; ratio?: boolean };

function Metrics({ items, label }: { items: Metric[]; label: string }) {
  return <div className={'metrics analysis-metrics analysis-columns-' + items.length} role="group" aria-label={label}>
    {items.map(item => <div key={item.id} data-metric={item.id}><strong>{number(item.value)}{item.ratio && item.value != null && Number.isFinite(item.value) && <small>:1</small>}</strong><span>{item.label}</span></div>)}
  </div>;
}

export function PaletteAnalysis({ project, domain, validation, activeIndex, selected, onActivate }: {
  project: Project;
  domain: ColorDomain;
  validation: PaletteValidation;
  activeIndex: number | null;
  selected: ReadonlySet<number>;
  onActivate: (index: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof mountDistribution> | null>(null);
  const callback = useRef(onActivate);
  callback.current = onActivate;
  const stats = useMemo(() => project.colors.length >= 2 ? analyzePalette(project.colors).distributions : null, [project.colors]);
  const pairCount = project.colors.length * (project.colors.length - 1) / 2;

  useLayoutEffect(() => {
    const current = mountDistribution(host.current!, project.colors, project.constraints.textColor, { onActivate: index => callback.current(index) });
    view.current = current;
    return () => { current.destroy(); view.current = null; };
  }, [project.colors, project.constraints.textColor]);

  useLayoutEffect(() => {
    view.current?.setSelection({ activeIndex, selectedIndices: [...selected] });
  }, [project.colors, project.constraints.textColor, activeIndex, selected]);

  return <section className="palette-analysis" aria-labelledby="palette-analysis-title">
    <div className="distribution-heading"><h3 id="palette-analysis-title">颜色之间的衔接</h3></div>
    <p className="help">近邻距离与连接步长描述连续性，极值用于检查硬约束。</p>
    <div ref={host} id="palette-distribution" className="inline-distribution" />
    <p className="help analysis-interaction">上方多选同步标记在两图中，详情对应当前查看的颜色。图上点击可定位编辑对象，不改变多选集合。</p>
    <Metrics label="近邻与连接步长" items={[
      { id: 'nearest-median', label: '最近邻色差 · 中位数', value: stats?.nearestNeighborDeltaE.median },
      { id: 'nearest-p90', label: '最近邻色差 · P90', value: stats?.nearestNeighborDeltaE.p90 },
      { id: 'mst-max', label: '连接整套色板的最大步长', value: stats?.mstDeltaE.max },
    ]} />
    <h4 className="analysis-group-title">全部 {pairCount} 对颜色</h4>
    <Metrics label="全部颜色对的分布" items={[
      { id: 'pair-delta-median', label: '色差 · 中位数', value: stats?.pairDeltaE.median },
      { id: 'pair-delta-p90', label: '色差 · P90', value: stats?.pairDeltaE.p90 },
      { id: 'pair-contrast-median', label: '底色对比 · 中位数', value: stats?.pairContrast.median, ratio: true },
      { id: 'pair-contrast-p90', label: '底色对比 · P90', value: stats?.pairContrast.p90, ratio: true },
    ]} />
    <h4 className="analysis-group-title">当前色板的约束检查</h4>
    <Metrics label="约束极值" items={[
      { id: 'min-delta', label: '最小色差', value: validation.minDeltaE },
      { id: 'max-background', label: '最大底色对比', value: pairCount ? validation.maxBackgroundContrast : null, ratio: true },
      { id: 'min-text', label: '最低文字对比', value: validation.minTextContrast, ratio: true },
    ]} />
    {!stats && <p className="help">至少两个颜色才有最近邻、连接步长和颜色对统计。</p>}
    <p className={'analysis-verdict' + (validation.valid ? '' : ' has-conflicts')}>{validation.valid ? '现有颜色通过当前规则。' : '现有颜色存在约束冲突。'}</p>
    {!validation.valid && <div className="audit"><strong>{validation.issues.length} 项冲突</strong><ul>{validation.issues.slice(0, 12).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>{validation.issues.length > 12 && <p>其余诊断包含在导出的 JSON 中。</p>}</div>}
    <section className="analysis-rules" aria-label="当前生成规则与边界">
      <h4>当前生成规则与边界</h4>
      <dl className="analysis-rule-list">
        <div><dt>文字颜色</dt><dd><i className="rule-text-swatch" style={{ background: project.constraints.textColor }} />{project.constraints.textColor}</dd></div>
        <div><dt>最低文字对比</dt><dd>≥ {number(project.constraints.minTextContrast)}:1</dd></div>
        <div><dt>色差下限</dt><dd>≥ {number(project.constraints.minDeltaE)}</dd></div>
        <div><dt>底色对比上限</dt><dd>≤ {number(project.constraints.maxBackgroundContrast)}:1</dd></div>
        <div><dt>硬彩度范围</dt><dd>{number(project.constraints.minChroma ?? 0, 3)} – {number(project.constraints.maxChroma, 3)}</dd></div>
        <div><dt>明度 L 范围</dt><dd>{number(domain.lightness[0] * 100, 1)}% – {number(domain.lightness[1] * 100, 1)}%</dd></div>
        <div><dt>色相 h 范围</dt><dd>{number(domain.hue[0], 1)}° → {number(domain.hue[1], 1)}°</dd></div>
        <div><dt>彩度 C 范围</dt><dd>{number(domain.chroma[0], 3)} – {number(domain.chroma[1], 3)}</dd></div>
        <div><dt>范围状态</dt><dd>{project.domainMode === 'auto' ? '自动生长范围' : '固定自定义范围'}</dd></div>
        <div><dt>生成种子</dt><dd>{project.seed || '（空）'}</dd></div>
      </dl>
    </section>
  </section>;
}
