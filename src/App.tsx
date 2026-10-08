import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, CheckSquare, Download, Palette, Plus, Square } from 'lucide-react';
import { normalizeHex } from './color';
import { sortPalette, validatePalette } from './generator';
import { createProject, effectiveDomain, makeExample, snapshotProject, type Project } from './project';
import { synchronizeGrowth } from './sequential-growth';
import { exportJson, exportPng, exportSvg } from './export';
import type { GrowthOperation, GrowthResult } from './growth-types';
import { ColorEditor, type EditorTarget } from './components/ColorEditor';
import { GlobalSettings, type PresetId } from './components/GlobalSettings';
import { PalettePreview } from './components/PalettePreview';
import { PaletteAnalysis } from './components/PaletteAnalysis';
import { PaletteToolbar } from './components/PaletteToolbar';
import { SavePaletteDialog, type PaletteExportFormat } from './components/SavePaletteDialog';

type Preview = { project: Project; preset: PresetId };

// Track colors by their old slots, including equal HEX values, when order changes.
function positionMap(previous: string[], next: string[]): Map<number, number> {
  const slots = new Map<string, number[]>();
  previous.forEach((hex, index) => slots.set(hex, [...(slots.get(hex) ?? []), index]));
  const positions = new Map<number, number>();
  next.forEach((hex, index) => {
    const oldIndex = slots.get(hex)?.shift();
    if (oldIndex !== undefined) positions.set(oldIndex, index);
  });
  return positions;
}

export function App() {
  const [project, setProject] = useState(createProject);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [lastSelected, setLastSelected] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saveFormat, setSaveFormat] = useState<PaletteExportFormat | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const worker = useRef<Worker | null>(null);
  const interaction = useRef({ editor, selected, lastSelected });
  interaction.current = { editor, selected, lastSelected };
  const domain = useMemo(() => effectiveDomain(project), [project.colors, project.domain, project.domainMode, project.growth, project.constraints.minChroma, project.constraints.maxChroma]);
  const validation = useMemo(() => validatePalette(project.colors, project.constraints, domain), [project.colors, project.constraints, domain]);
  const orderedColors = useMemo(() => sortPalette(project.colors), [project.colors]);
  const isSorted = orderedColors.every((hex, index) => hex === project.colors[index]);
  const hasColors = project.colors.length > 0;
  const isFull = project.colors.length >= 25;

  useEffect(() => () => { worker.current?.terminate(); clearTimeout(toastTimer.current); }, []);
  const showToast = useCallback((text: string) => {
    clearTimeout(toastTimer.current); setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  const cancel = useCallback(() => { worker.current?.terminate(); worker.current = null; setBusy(false); }, []);
  const editStart = useCallback(() => {
    if (worker.current) { cancel(); setNotice({ text: '参数正在编辑，已取消上一轮计算。', error: false }); }
  }, [cancel]);
  const updateProject = useCallback((next: Project, text: string) => {
    cancel(); setProject({ ...next, growth: synchronizeGrowth(next) }); setNotice({ text, error: false });
  }, [cancel]);

  function setColor(value: string) {
    const hex = normalizeHex(value);
    if (!hex || !editor || !project.colors[editor.index]) return;
    const colors = [...project.colors]; colors[editor.index] = hex;
    updateProject({ ...project, colors }, '颜色已更新，当前色板已重新检查。');
  }

  function addColor(value: string) {
    const hex = normalizeHex(value);
    if (!hex) return;
    if (isFull) { showToast('色板已有 25 色，请先删除要替换的颜色。'); return; }
    updateProject({ ...project, colors: [...project.colors, hex] }, '');
    setEditor({ index: project.colors.length });
  }

  function addRandomColor() {
    runOperation({ kind: 'add' });
  }

  function deleteSelected() {
    if (!selected.size) return;
    const positions = new Map<number, number>();
    const colors = project.colors.filter((_, index) => {
      if (selected.has(index)) return false;
      positions.set(index, positions.size); return true;
    });
    updateProject({ ...project, colors }, '已删除 ' + selected.size + ' 色。' + (colors.length ? '生成将保留其余颜色并补齐到 25 色。' : '点击加号添加新的颜色。'));
    setSelected(new Set());
    setEditor(colors.length ? { index: editor ? positions.get(editor.index) ?? Math.min(editor.index, colors.length - 1) : 0 } : null);
    setLastSelected(positions.get(lastSelected) ?? 0);
  }

  function usePreset(id: PresetId) {
    const preset = makeExample(id);
    updateProject({ ...project, name: '', colors: [...preset.anchors], growth: undefined, domain: structuredClone(preset.domain), domainMode: 'manual',
      constraints: { ...preset.constraints, textColor: project.constraints.textColor, minTextContrast: project.constraints.minTextContrast } },
    '已取用' + preset.name + '的 ' + preset.anchors.length + ' 个代表色。点击生成补齐到 25 色。');
    setEditor({ index: 0 }); setSelected(new Set()); setLastSelected(0); setPreview(null);
  }

  function applyOrderedColors(colors: string[], previous: string[], result?: GrowthResult) {
    const positions = positionMap(previous, colors), current = interaction.current;
    setProject(value => ({ ...value, colors, ...(result ? { growth: result.growth, seed: result.seed } : {}) }));
    setSelected(new Set([...current.selected].flatMap(index => positions.has(index) ? [positions.get(index)!] : [])));
    setEditor(current.editor ? { index: positions.get(current.editor.index) ?? 0 } : colors.length ? { index: 0 } : null);
    setLastSelected(positions.get(current.lastSelected) ?? 0);
  }

  function runOperation(operation: GrowthOperation) {
    if (busy || (operation.kind !== 'randomize' && isFull) || (operation.kind === 'randomize' && !operation.indices?.length)) return;
    const input = snapshotProject(project);
    const restart = operation.kind === 'randomize' && operation.indices!.length === input.colors.length;
    if (operation.kind === 'randomize') input.seed = `palette-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    if (restart) input.domainMode = 'auto';
    const action = operation.kind === 'add' ? '添加' : operation.kind === 'randomize' ? '重新抽取' : '补齐';
    setBusy(true); setNotice({ text: operation.kind === 'add' ? '正在生成下一步…' : operation.kind === 'randomize'
      ? operation.indices!.length === input.colors.length ? '正在从首色开始，依次重新抽取…' : '正在保留未选颜色，在当前范围内重新抽取…'
      : '正在沿颜色之间的疏密逐步补齐到 25 色…', error: false });
    const job = new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });
    worker.current = job;
    job.onmessage = (event: MessageEvent<{ result?: GrowthResult; error?: string }>) => {
      if (worker.current !== job) return;
      job.terminate(); worker.current = null; setBusy(false);
      const result = event.data.result;
      if (result?.status === 'success') {
        if (operation.kind === 'complete') applyOrderedColors(sortPalette(result.colors), input.colors, result);
        else {
          setProject(value => ({ ...value, colors: result.colors, growth: result.growth, seed: result.seed, ...(restart ? { domainMode: 'auto' as const } : {}) }));
          if (operation.kind === 'add') setEditor({ index: result.colors.length - 1 });
        }
        const detail = operation.kind === 'complete' ? '已补齐 25 色并自动排序，生成顺序独立保留。'
          : operation.kind === 'add' ? '已生成一步。' : `已重新抽取 ${operation.indices!.length} 色，数量和槽位保持。${restart ? '范围随新色系重新建立。' : '未选颜色保持原值。'}`;
        setNotice({ text: detail + (result.validation.valid ? '' : '首色仅按彩度抽取，当前约束冲突已在下方列出；继续生成前请调整颜色或规则。'), error: false });
      } else {
        setNotice({ text: '未能' + action + '，现有颜色保持不变。' + (event.data.error ?? [...new Set(result?.diagnostics ?? [])].slice(0, 3).join(' ')), error: true });
      }
    };
    job.onerror = () => { if (worker.current !== job) return; cancel(); setNotice({ text: '计算中断，请重试；现有色板保留。', error: true }); };
    job.postMessage({ project: input, operation });
  }

  function selectColor(index: number, range: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      if (range) for (let i = Math.min(index, lastSelected); i <= Math.max(index, lastSelected); i++) next.add(i);
      else if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
    setLastSelected(index); setEditor({ index });
  }

  function sort() {
    if (busy || isSorted) return;
    applyOrderedColors(orderedColors, project.colors);
    setNotice({ text: '已按同色系近邻排序，颜色和选中对象保持不变。', error: false });
  }

  function savePalette(name: string) {
    try {
      const output = { ...snapshotProject(project), name };
      if (saveFormat === 'JSON') exportJson({ ...output, exportedAt: new Date().toISOString(), algorithm: 'oklch-adaptive-growth-v3', metrics: validation }, name + '.json');
      else if (saveFormat === 'SVG') exportSvg(output.colors, output.constraints.textColor, name);
      else if (saveFormat === 'PNG') exportPng(output.colors, output.constraints.textColor, name);
      setProject(previous => ({ ...previous, name })); setSaveFormat(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败，请重试。');
    }
  }

  return <>
    <header className="app-header"><a className="brand" href="./" aria-label="色序首页"><span className="brand-symbol"><Palette /></span><span><strong>色序<span className="brand-dot">.</span></strong><small>COLOR STUDIO</small></span></a>
      <nav className="header-links" aria-label="帮助文档"><a href="./docs/index.html" target="_blank" rel="noopener"><BookOpen />文档 <ArrowUpRight /></a></nav>
    </header>
    <main className="workspace">
      <section className="panel settings-panel" aria-label="全局预设与高级选项"><GlobalSettings project={project} onChange={updateProject} onPreview={preset => setPreview({ project: makeExample(preset), preset })} onEditStart={editStart} onNotice={showToast} /></section>
      <section className="panel edit-panel" aria-label="颜色分析与调整"><div id="editor-content"><ColorEditor project={project} editor={editor} onColor={setColor} onNotice={showToast} onEditStart={editStart} /></div></section>
      <section className="panel palette-panel" aria-label="色板"><div id="palette-content">
        <PaletteToolbar selectedCount={selected.size} colorCount={project.colors.length} isSorted={isSorted} busy={busy}
          onSelectAll={() => setSelected(new Set(project.colors.map((_, index) => index)))} onClearSelection={() => setSelected(new Set())}
          onDeleteSelected={deleteSelected} onSort={sort} onRandomize={() => runOperation({ kind: 'randomize', indices: [...selected] })}
          onGenerate={() => runOperation({ kind: 'complete' })} onCancel={() => { cancel(); setNotice({ text: '已取消，现有色板保留。', error: false }); }} />
        {notice.text && <div className={'notice' + (notice.error ? ' error' : '')} role="status">{notice.text}</div>}
        <div className="palette-grid" role="group" aria-label="课程色板">{project.colors.map((hex, index) => <div key={index} className={'swatch' + (selected.has(index) ? ' selected' : '') + (editor?.index === index ? ' editing' : '')}>
          <button className="swatch-color" style={{ background: hex, color: project.constraints.textColor }} onClick={event => selectColor(index, event.shiftKey)} aria-label={'选择课程色 ' + (index + 1) + ' ' + hex} aria-pressed={selected.has(index)}><span className="swatch-sample">Aa</span><span className="selection-mark">{selected.has(index) ? <CheckSquare /> : <Square />}</span></button>
          <button className="swatch-meta" onClick={() => setEditor({ index })} aria-label={'仅编辑课程色 ' + (index + 1)}><strong>{String(index + 1).padStart(2, '0')}</strong><small>{hex}</small></button>
        </div>)}
          {!isFull && <button className="swatch-add" aria-label="新增颜色" title="执行一步生成，可在左侧修改 HEX" disabled={busy} onClick={addRandomColor}><Plus aria-hidden="true" /></button>}
        </div>
        {hasColors && <>
          <p className="help selection-help">点击色块自由选取，再点取消；Shift 连选。点击色码仅切换编辑焦点。</p>
          <PaletteAnalysis project={project} domain={domain} validation={validation} activeIndex={editor?.index ?? null} selected={selected} onActivate={index => setEditor({ index })} />
          <div className="export-bar"><span className="help">保存色板</span><div className="row">{(['JSON', 'SVG', 'PNG'] as const).map(format => <button key={format} onClick={() => setSaveFormat(format)} disabled={busy}>{format === 'JSON' && <Download aria-hidden="true" />}{format}</button>)}</div></div>
        </>}
      </div></section>
    </main>
    <footer className="app-footer"><span>色序 · Course Color Studio</span><span>sRGB · OKLCh</span></footer>
    {toast && <div id="toast" role="status">{toast}</div>}
    {preview && <PalettePreview project={preview.project} preset={preview.preset} canAddColor={!isFull} onClose={() => setPreview(null)} onUsePrimaries={usePreset} onAddColor={addColor} />}
    {saveFormat && <SavePaletteDialog initialName={project.name} format={saveFormat} onClose={() => setSaveFormat(null)} onSave={savePalette} />}
  </>;
}
