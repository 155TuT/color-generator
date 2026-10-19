import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, CheckSquare, Palette, Plus, Square } from 'lucide-react';
import { normalizeHex } from './color';
import { sortPalette, validatePalette } from './generator';
import { createProject, effectiveDomain, snapshotProject, type Project } from './project';
import { synchronizeGrowth } from './sequential-growth';
import { createJsonExport, createPngExport, createSvgExport, downloadBlob } from './export';
import { saveBlobToDirectory, type SaveDirectoryHandle } from './file-save';
import { buildProjectExport, parseProjectJson, PROJECT_JSON_MAX_BYTES } from './project-io';
import { commitHistory, createHistory, endHistoryGroup, historyShortcut, redoHistory, sameSnapshot, undoHistory } from './history';
import type { GrowthOperation, GrowthResult } from './growth-types';
import { ColorEditor, type EditorTarget } from './components/ColorEditor';
import { GlobalSettings } from './components/GlobalSettings';
import { PaletteAnalysis } from './components/PaletteAnalysis';
import { PaletteToolbar } from './components/PaletteToolbar';
import { SavePaletteDialog, type PaletteExportFormat } from './components/SavePaletteDialog';

type WorkbenchSnapshot = { project: Project; editor: EditorTarget | null; selected: Set<number>; lastSelected: number };
type InteractionPatch = Partial<Omit<WorkbenchSnapshot, 'project'>>;

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
  const [saveOpen, setSaveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [toast, setToast] = useState('');
  const [editorRevision, setEditorRevision] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const worker = useRef<Worker | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const saveDirectory = useRef<SaveDirectoryHandle | null>(null);
  const importRequest = useRef(0);
  const history = useRef(createHistory<WorkbenchSnapshot>());
  const gesture = useRef<string | null>(null);
  const gestureCount = useRef(0);
  const projectRef = useRef(project);
  projectRef.current = project;
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
  const currentSnapshot = useCallback((): WorkbenchSnapshot => ({ project: projectRef.current, ...interaction.current }), []);
  const applySnapshot = useCallback((value: WorkbenchSnapshot) => {
    projectRef.current = value.project;
    interaction.current = { editor: value.editor, selected: value.selected, lastSelected: value.lastSelected };
    setProject(value.project); setEditor(value.editor); setSelected(value.selected); setLastSelected(value.lastSelected);
  }, []);
  const finishGesture = useCallback(() => {
    gesture.current = null; history.current = endHistoryGroup(history.current);
  }, []);
  const beginGesture = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLInputElement)) return;
    if (!['range', 'color'].includes(target.type)) return;
    finishGesture(); gesture.current = `edit-${++gestureCount.current}`;
  }, [finishGesture]);
  const commitProject = useCallback((next: Project, patch: InteractionPatch = {}) => {
    const before = currentSnapshot(), after = { ...before, ...patch, project: next };
    history.current = commitHistory(history.current, before, after, {
      group: gesture.current, equals: (left, right) => sameSnapshot(left.project, right.project),
    });
    importRequest.current++;
    applySnapshot(after);
  }, [currentSnapshot, applySnapshot]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const action = historyShortcut(event);
      if (!action) {
        if (!gesture.current && event.target instanceof HTMLInputElement && event.target.type === 'range'
          && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) beginGesture(event.target);
        return;
      }
      // Modal text editing keeps its native behavior and cannot change the palette behind it.
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault(); cancel(); finishGesture(); importRequest.current++;
      setNotice({ text: '', error: false });
      const result = (action === 'undo' ? undoHistory : redoHistory)(history.current, currentSnapshot());
      if (!result) return;
      history.current = result.history; applySnapshot(result.value);
      setEditorRevision(value => value + 1);
    };
    const endRangeGesture = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'color') return;
      finishGesture();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', endRangeGesture);
    window.addEventListener('pointerup', endRangeGesture);
    window.addEventListener('pointercancel', endRangeGesture);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', endRangeGesture);
      window.removeEventListener('pointerup', endRangeGesture);
      window.removeEventListener('pointercancel', endRangeGesture);
    };
  }, [applySnapshot, beginGesture, cancel, currentSnapshot, finishGesture]);
  const editStart = useCallback(() => {
    importRequest.current++;
    if (worker.current) { cancel(); setNotice({ text: '参数正在编辑，已取消上一轮计算。', error: false }); }
  }, [cancel]);
  const updateProject = useCallback((next: Project, text: string, patch: InteractionPatch = {}) => {
    cancel(); commitProject({ ...next, growth: synchronizeGrowth(next) }, patch); setNotice({ text, error: false });
  }, [cancel, commitProject]);

  function setColor(value: string) {
    const hex = normalizeHex(value);
    if (!hex || !editor || !project.colors[editor.index]) return;
    const colors = [...project.colors]; colors[editor.index] = hex;
    updateProject({ ...project, colors }, '颜色已更新，当前色板已重新检查。');
  }

  function addRandomColor() {
    runOperation({ kind: 'add' });
  }

  function deleteSelected() {
    if (!selected.size || busy) return;
    const positions = new Map<number, number>();
    const colors = project.colors.filter((_, index) => {
      if (selected.has(index)) return false;
      positions.set(index, positions.size); return true;
    });
    updateProject({ ...project, colors }, '已删除 ' + selected.size + ' 色。' + (colors.length ? '生成将保留其余颜色并补齐到 25 色。' : '点击加号添加新的颜色。'), {
      selected: new Set(), editor: colors.length ? { index: editor ? positions.get(editor.index) ?? Math.min(editor.index, colors.length - 1) : 0 } : null,
      lastSelected: positions.get(lastSelected) ?? 0,
    });
  }

  function applyOrderedColors(colors: string[], previous: string[], result?: GrowthResult) {
    const positions = positionMap(previous, colors), current = interaction.current;
    commitProject({ ...projectRef.current, colors, ...(result ? { growth: result.growth, seed: result.seed } : {}) }, {
      selected: new Set([...current.selected].flatMap(index => positions.has(index) ? [positions.get(index)!] : [])),
      editor: current.editor ? { index: positions.get(current.editor.index) ?? 0 } : colors.length ? { index: 0 } : null,
      lastSelected: positions.get(current.lastSelected) ?? 0,
    });
  }

  function runOperation(operation: GrowthOperation) {
    if (busy || (operation.kind !== 'randomize' && isFull) || (operation.kind === 'randomize' && !operation.indices?.length)) return;
    finishGesture(); importRequest.current++;
    const input = snapshotProject(project);
    const restart = operation.kind === 'randomize' && operation.indices!.length === input.colors.length;
    if (operation.kind === 'randomize') input.seed = `palette-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
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
          commitProject({ ...projectRef.current, colors: result.colors, growth: result.growth, seed: result.seed,
            ...(result.domainMode ? { domainMode: result.domainMode } : {}) }, operation.kind === 'add' ? { editor: { index: result.colors.length - 1 } } : {});
        }
        const detail = operation.kind === 'complete' ? '已补齐 25 色并自动排序，生成顺序独立保留。'
          : operation.kind === 'add' ? '已生成一步。' : `已重新抽取 ${operation.indices!.length} 色，数量和槽位保持。${restart ? input.domainMode === 'manual' ? '自定义范围保持。' : '范围随新色系重新建立。' : '未选颜色保持原值。'}`;
        setNotice({ text: detail, error: false });
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

  async function savePalette(name: string, format: PaletteExportFormat, directory: SaveDirectoryHandle | null) {
    const output = { ...snapshotProject(project), name };
    const file = format === 'JSON' ? createJsonExport(buildProjectExport(output, name), name)
      : format === 'SVG' ? createSvgExport(output.colors, output.constraints.textColor, name)
      : await createPngExport(output.colors, output.constraints.textColor, name);
    if (directory) {
      const result = await saveBlobToDirectory(directory, file.filename, file.blob);
      showToast(`${result.overwritten ? '已替换' : '已保存'} ${directory.name}/${result.filename}`);
    } else downloadBlob(file.blob, file.filename);
    commitProject({ ...projectRef.current, name }); setSaveOpen(false);
  }

  async function importPalette(file: File) {
    const request = ++importRequest.current;
    try {
      if (file.size > PROJECT_JSON_MAX_BYTES) throw new Error('无法导入：JSON 文件不能超过 1 MB。');
      cancel(); setNotice({ text: '', error: false });
      const next = parseProjectJson(await file.text());
      if (request !== importRequest.current) return;
      const audit = validatePalette(next.colors, next.constraints, effectiveDomain(next));
      cancel(); finishGesture();
      commitProject(next, { editor: next.colors.length ? { index: 0 } : null, selected: new Set(), lastSelected: 0 });
      setEditorRevision(value => value + 1);
      setNotice({ text: `已导入 ${next.colors.length} 色，颜色与参数已重新检查。${audit.valid ? '' : '现有规则存在冲突，可继续查看和编辑。'}`, error: !audit.valid });
    } catch (error) {
      if (request === importRequest.current) showToast(error instanceof Error ? error.message : '导入失败，当前色板保持不变。');
    }
  }

  return <>
    <header className="app-header"><a className="brand" href="./" aria-label="色序首页"><span className="brand-symbol"><Palette /></span><span><strong>色序<span className="brand-dot">.</span></strong><small>COLOR STUDIO</small></span></a>
      <nav className="header-links" aria-label="帮助文档"><a href="./docs/index.html" target="_blank" rel="noopener"><BookOpen />文档 <ArrowUpRight /></a></nav>
    </header>
    <main className="workspace" onPointerDownCapture={event => beginGesture(event.target)}
      onFocusCapture={event => beginGesture(event.target)}
      onBlur={finishGesture}>
      <section className="panel settings-panel" aria-label="全局规则与高级选项"><GlobalSettings project={project} onChange={updateProject} onEditStart={editStart} onNotice={showToast} /></section>
      <section className="panel edit-panel" aria-label="颜色分析与调整"><div id="editor-content"><ColorEditor key={editorRevision} project={project} editor={editor} onColor={setColor} onNotice={showToast} onEditStart={editStart} /></div></section>
      <section className="panel palette-panel" aria-label="色板"><div id="palette-content">
        <PaletteToolbar selectedCount={selected.size} colorCount={project.colors.length} isSorted={isSorted} busy={busy}
          onImport={() => importInput.current?.click()} onSave={() => setSaveOpen(true)}
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
        </>}
        <input ref={importInput} type="file" accept=".json,application/json" aria-label="导入色板 JSON" hidden
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importPalette(file); }} />
      </div></section>
    </main>
    <footer className="app-footer"><span>色序 · Course Color Studio</span><span>sRGB · OKLCh</span></footer>
    {toast && <div id="toast" role="status">{toast}</div>}
    {saveOpen && <SavePaletteDialog initialName={project.name} initialDirectory={saveDirectory.current}
      onDirectoryChange={directory => { saveDirectory.current = directory; }} onClose={() => setSaveOpen(false)} onSave={savePalette} />}
  </>;
}
