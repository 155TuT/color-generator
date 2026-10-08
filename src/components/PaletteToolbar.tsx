import { ArrowDownUp, Check, RefreshCw, WandSparkles, X } from 'lucide-react';

export interface PaletteToolbarProps {
  selectedCount: number;
  colorCount: number;
  isSorted: boolean;
  busy: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onSort: () => void;
  onRandomize: () => void;
  onGenerate: () => void;
  onCancel: () => void;
}

export function PaletteToolbar({ selectedCount, colorCount, isSorted, busy, onSelectAll, onClearSelection, onDeleteSelected, onSort, onRandomize, onGenerate, onCancel }: PaletteToolbarProps) {
  const allSelected = colorCount > 0 && selectedCount === colorCount;
  return <div className="palette-toolbar">
    <h2>色板</h2>
    <div className="palette-toolbar-actions">
      <div className="palette-toolbar-group selection-actions" role="group" aria-label="颜色选择">
        <span className="selection-count">已选 <strong>{selectedCount}</strong> 色</span>
        <button className="text-button" disabled={!colorCount || allSelected} onClick={onSelectAll}>全选</button>
        <button className="text-button" disabled={!selectedCount} onClick={onClearSelection}>清空</button>
      </div>
      <div className="palette-toolbar-group arrange-actions" role="group" aria-label="色板整理">
        <button className="text-button delete-colors" disabled={!selectedCount} onClick={onDeleteSelected}>删除</button>
        <button className={isSorted ? 'sort-button is-sorted' : 'sort-button'} disabled={busy || isSorted || colorCount < 2} onClick={onSort}>{isSorted ? <Check aria-hidden="true" /> : <ArrowDownUp aria-hidden="true" />}{isSorted ? '已排序' : '排序'}</button>
      </div>
      <div className="palette-toolbar-group generation-actions" role="group" aria-label="色彩生成">
        <button data-action="randomize" disabled={!selectedCount || busy} title={allSelected ? '按顺序重新随机抽取所有颜色' : '在现有色板范围内重新抽取选中颜色'} onClick={onRandomize}><RefreshCw aria-hidden="true" />随机</button>
        <button className="primary" data-action="generate" disabled={colorCount >= 25 || busy} aria-busy={busy} title={colorCount >= 25 ? '已有 25 色，删除颜色后可继续生成' : '按顺序生成，补齐到 25 色'} onClick={onGenerate}><WandSparkles aria-hidden="true" />生成</button>
        {busy && <button className="icon-button" aria-label="取消生成" onClick={onCancel}><X aria-hidden="true" /></button>}
      </div>
    </div>
  </div>;
}
