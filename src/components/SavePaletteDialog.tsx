import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

export type PaletteExportFormat = 'JSON' | 'SVG' | 'PNG';

interface SavePaletteDialogProps {
  initialName: string;
  format: PaletteExportFormat;
  onClose: () => void;
  onSave: (name: string) => void;
}

/** Naming belongs to the save action, while the working palette remains unnamed. */
export function SavePaletteDialog({ initialName, format, onClose, onSave }: SavePaletteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    input.current?.focus();
    input.current?.select();
    return () => node.close();
  }, []);

  return <dialog ref={dialog} id="save-palette-dialog" className="save-dialog" aria-labelledby="save-palette-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="section-head save-dialog-header">
      <h2 id="save-palette-title">保存色板</h2>
      <button type="button" className="icon-button" onClick={onClose} aria-label="关闭保存色板"><X aria-hidden="true" /></button>
    </div>
    <form className="save-dialog-form" onSubmit={event => {
      event.preventDefault();
      onSave(name.trim() || '课程配色色板');
    }}>
      <label className="field" htmlFor="save-palette-name">
        <span>色板名称</span>
        <input ref={input} id="save-palette-name" value={name} maxLength={40} placeholder="课程配色色板"
          autoComplete="off" onChange={event => setName(event.currentTarget.value)} />
      </label>
      <p className="help">保存为 {format} 文件。</p>
      <div className="save-dialog-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" className="primary"><Download aria-hidden="true" />保存</button>
      </div>
    </form>
  </dialog>;
}
