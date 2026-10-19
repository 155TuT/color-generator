/** Minimal File System Access shapes, kept separate from browser-specific DOM declarations. */
export interface SaveWritableFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface SaveFileHandle {
  createWritable(options?: { keepExistingData?: boolean }): Promise<SaveWritableFile>;
}

export interface SaveDirectoryHandle {
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<SaveFileHandle>;
}

export interface DirectorySaveResult {
  filename: string;
  overwritten: boolean;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<SaveDirectoryHandle>;
};

export function supportsDirectorySave(): boolean {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

/** Must be called from a user gesture; the caller retains the handle only for this session. */
export async function chooseSaveDirectory(): Promise<SaveDirectoryHandle> {
  const browser = typeof window === 'undefined' ? null : window as DirectoryPickerWindow;
  if (typeof browser?.showDirectoryPicker !== 'function') {
    throw new Error('当前浏览器不支持选择保存目录。');
  }
  return browser.showDirectoryPicker({ mode: 'readwrite', id: 'color-studio-exports' });
}

function isNotFound(error: unknown): boolean {
  // Browser DOMExceptions can come from another realm; do not rely on instanceof.
  return error !== null && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError';
}

/** Write only the named file; do not enumerate, rename, or persist directory access. */
export async function saveBlobToDirectory(directory: SaveDirectoryHandle, filename: string, blob: Blob): Promise<DirectorySaveResult> {
  if (!filename || filename === '.' || filename === '..' || /[\/\\\u0000]/.test(filename)) {
    throw new Error('保存文件名不能为空，也不能包含目录路径。');
  }
  let file: SaveFileHandle;
  let overwritten = true;
  try {
    file = await directory.getFileHandle(filename);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    file = await directory.getFileHandle(filename, { create: true });
    overwritten = false;
  }

  // Explicit truncation prevents a shorter replacement from retaining old trailing bytes.
  const writable = await file.createWritable({ keepExistingData: false });
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* Preserve the original permission, write, or close failure. */ }
    throw error;
  }
  return { filename, overwritten };
}
