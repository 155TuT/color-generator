import { ArrowDownUp, Check, Download, RefreshCw, Square, Trash2, Upload, WandSparkles } from 'lucide-react';

export interface PaletteToolbarProps {
  selectedCount: number;
  colorCount: number;
  isSorted: boolean;
  busy: boolean;
  onImport: () => void;
  onSave: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onSort: () => void;
  onRandomize: () => void;
  onGenerate: () => void;
  onCancel: () => void;
}

export function PaletteToolbar({ selectedCount, colorCount, isSorted, busy, onImport, onSave, onSelectAll, onClearSelection, onDeleteSelected, onSort, onRandomize, onGenerate, onCancel }: PaletteToolbarProps) {
  const allSelected = colorCount > 0 && selectedCount === colorCount;
  const showSorted = colorCount > 1 && isSorted;
  return <div className="palette-toolbar">
    <div className="palette-toolbar-heading">
      <h2>色板</h2>
      <div className="palette-file-actions" role="group" aria-label="色板文件">
        <button disabled={busy} onClick={onImport}><Upload aria-hidden="true" />导入 JSON</button>
        <button disabled={!colorCount || busy} onClick={onSave}><Download aria-hidden="true" />保存色板</button>
      </div>
    </div>
    <div className="palette-toolbar-actions">
      <div className="palette-toolbar-group selection-actions" role="group" aria-label="颜色选择">
        <span className="selection-count">已选 <strong>{selectedCount}</strong> 色</span>
        <button className="text-button" disabled={!colorCount || allSelected} onClick={onSelectAll}>全选</button>
        <button className="text-button" disabled={!selectedCount} onClick={onClearSelection}>取消选择</button>
      </div>
      <div className="palette-toolbar-group selected-actions" role="group" aria-label="选中色操作">
        <button data-action="randomize" disabled={!selectedCount || busy} title={allSelected ? '按顺序重新随机抽取所有颜色' : '在现有色板范围内重新抽取选中颜色'} onClick={onRandomize}><RefreshCw aria-hidden="true" />随机</button>
        <button className="text-button delete-colors" disabled={!selectedCount || busy} title="删除选中的颜色" onClick={onDeleteSelected}><Trash2 aria-hidden="true" />删除</button>
      </div>
      <div className="palette-toolbar-group generation-actions" role="group" aria-label="整套色板操作">
        <button className={showSorted ? 'sort-button is-sorted' : 'sort-button'} disabled={busy || isSorted || colorCount < 2} onClick={onSort}>{showSorted ? <Check aria-hidden="true" /> : <ArrowDownUp aria-hidden="true" />}{showSorted ? '已排序' : '排序'}</button>
        {busy
          ? <button className="cancel-generation" data-action="cancel" onClick={onCancel}><Square aria-hidden="true" />取消生成</button>
          : <button className="primary" data-action="generate" disabled={colorCount >= 25} title={colorCount >= 25 ? '已有 25 色，删除颜色后可继续生成' : '按顺序生成，补齐到 25 色'} onClick={onGenerate}><WandSparkles aria-hidden="true" />生成</button>}
      </div>
    </div>
  </div>;
}
