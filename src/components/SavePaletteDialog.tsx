import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, X } from 'lucide-react';
import { safeFilename } from '../export';
import { chooseSaveDirectory, supportsDirectorySave, type SaveDirectoryHandle } from '../file-save';

export type PaletteExportFormat = 'JSON' | 'SVG' | 'PNG';

interface SavePaletteDialogProps {
  initialName: string;
  initialDirectory: SaveDirectoryHandle | null;
  onDirectoryChange: (directory: SaveDirectoryHandle | null) => void;
  onClose: () => void;
  onSave: (name: string, format: PaletteExportFormat, directory: SaveDirectoryHandle | null) => Promise<void>;
}

/** Naming belongs to the save action, while the working palette remains unnamed. */
export function SavePaletteDialog({ initialName, initialDirectory, onDirectoryChange, onClose, onSave }: SavePaletteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName.slice(0, 40));
  const [format, setFormat] = useState<PaletteExportFormat>('JSON');
  const [directory, setDirectory] = useState(initialDirectory);
  const [destination, setDestination] = useState<'download' | 'directory'>(initialDirectory ? 'directory' : 'download');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<{ key: string; status: 'checking' | 'new' | 'existing' | 'error'; message?: string } | null>(null);
  const finalName = (name.trim() || '课程配色色板').slice(0, 40);
  const filename = safeFilename(finalName, '.' + format.toLowerCase());
  const supported = supportsDirectorySave();
  const checkKey = destination === 'directory' && directory ? filename : '';
  const checking = Boolean(checkKey && (check?.key !== checkKey || check.status === 'checking'));
  const existing = Boolean(checkKey && check?.key === checkKey && check.status === 'existing');
  const checkError = checkKey && check?.key === checkKey && check.status === 'error' ? check.message : '';
  const formatHelp = {
    JSON: '保留颜色、规则与生成关系，导入后可继续编辑。',
    SVG: '保存为可缩放的矢量色板图，适合排版与设计。',
    PNG: '保存为色板图片，适合预览与分享。',
  };

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    input.current?.focus();
    input.current?.select();
    return () => node.close();
  }, []);

  useEffect(() => {
    if (!directory || destination !== 'directory') { setCheck(null); return; }
    let active = true;
    setCheck({ key: filename, status: 'checking' });
    directory.getFileHandle(filename).then(() => {
      if (active) setCheck({ key: filename, status: 'existing' });
    }).catch((cause: unknown) => {
      if (!active) return;
      const missing = cause instanceof Error && cause.name === 'NotFoundError';
      setCheck({ key: filename, status: missing ? 'new' : 'error', message: missing ? undefined : '无法检查此文件夹，请重新选择保存位置。' });
    });
    return () => { active = false; };
  }, [directory, destination, filename]);

  const chooseDirectory = async () => {
    setError(''); setPending(true);
    try {
      const next = await chooseSaveDirectory();
      setCheck(null); setDirectory(next); onDirectoryChange(next);
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : '无法选择保存位置，请重试。');
    } finally { setPending(false); }
  };

  return <dialog ref={dialog} id="save-palette-dialog" className="save-dialog" aria-labelledby="save-palette-title"
    onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <div className="section-head save-dialog-header">
      <h2 id="save-palette-title">保存色板</h2>
      <button type="button" className="icon-button" disabled={pending} onClick={onClose} aria-label="关闭保存色板"><X aria-hidden="true" /></button>
    </div>
    <form className="save-dialog-form" onSubmit={async event => {
      event.preventDefault();
      if (pending || checking || checkError || (destination === 'directory' && !directory)) return;
      setPending(true); setError('');
      try { await onSave(finalName, format, destination === 'directory' ? directory : null); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); }
      finally { setPending(false); }
    }}>
      <label className="field" htmlFor="save-palette-name">
        <span>色板名称</span>
        <input ref={input} id="save-palette-name" disabled={pending} value={name} maxLength={40} placeholder="课程配色色板"
          autoComplete="off" onChange={event => setName(event.currentTarget.value)} />
      </label>
      <label className="field" htmlFor="save-palette-format">
        <span>文件格式</span>
        <select id="save-palette-format" disabled={pending} value={format} aria-describedby="save-palette-format-help"
          onChange={event => setFormat(event.currentTarget.value as PaletteExportFormat)}>
          <option value="JSON">JSON · 可继续编辑</option>
          <option value="SVG">SVG · 矢量图</option>
          <option value="PNG">PNG · 图片</option>
        </select>
      </label>
      <p id="save-palette-format-help" className="help">{formatHelp[format]}</p>
      <label className="field" htmlFor="save-palette-destination">
        <span>保存位置</span>
        <select id="save-palette-destination" disabled={pending} value={destination}
          onChange={event => { setDestination(event.target.value as 'download' | 'directory'); setError(''); }}>
          <option value="download">浏览器下载</option>
          <option value="directory" disabled={!supported}>自选文件夹</option>
        </select>
      </label>
      {destination === 'directory' ? <div className="save-location">
        <button type="button" disabled={pending} onClick={() => void chooseDirectory()}><FolderOpen aria-hidden="true" />{directory ? '更换文件夹' : '选择文件夹'}</button>
        {directory && <p className="save-path">{directory.name}/{filename}</p>}
        <p className="help" role="status">{checking ? '正在检查同名文件…' : checkError || (existing
          ? '已找到同名文件，保存将替换原文件。'
          : directory ? '将在此文件夹中新建文件。' : '选择保存文件夹；再次保存时会识别并替换同名文件。')}</p>
      </div> : <p className="help">{supported ? '下载到浏览器设定的位置；需要替换同名文件时请选择“自选文件夹”。' : '当前浏览器不支持直接选择文件夹，请使用 Chrome 或 Edge 打开本地页面或 HTTPS 页面。'}</p>}
      {error && <p className="save-error" role="alert">{error}</p>}
      <div className="save-dialog-actions">
        <button type="button" disabled={pending} onClick={onClose}>取消</button>
        <button type="submit" className="primary" disabled={pending || checking || Boolean(checkError) || (destination === 'directory' && !directory)}><Download aria-hidden="true" />{pending ? '处理中…' : existing ? '替换保存' : '保存'}</button>
      </div>
    </form>
  </dialog>;
}
