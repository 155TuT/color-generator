/** A bounded history of committed edits. Transient selection changes stay outside it. */
export interface HistoryState<T> {
  readonly past: readonly T[];
  readonly future: readonly T[];
  readonly limit: number;
  readonly group: string | null;
}

export interface HistoryCommitOptions<T> {
  /** Use one token for one continuous gesture, then call endHistoryGroup. */
  group?: string | null;
  /** Workbench snapshots can compare only their project, excluding selection/focus. */
  equals?: (before: T, after: T) => boolean;
}

export interface HistoryTransition<T> {
  history: HistoryState<T>;
  value: T;
}

/** Structural equality for the plain objects, arrays and Sets in workbench snapshots. */
export function sameSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (left instanceof Set || right instanceof Set) {
    if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
    return [...left].every(value => [...right].some(other => sameSnapshot(value, other)));
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameSnapshot(value, right[index]));
  }
  // Projects deliberately contain serializable data only; no DOM nodes or callbacks.
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key)
    && sameSnapshot((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export function createHistory<T>(limit = 100): HistoryState<T> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer.');
  return { past: [], future: [], limit, group: null };
}

/**
 * Capture the live pre-edit snapshot, including its current selection. Both arguments
 * are detached by callers' ordinary state updates; only the snapshot kept in history
 * is cloned here. A gesture stores its starting point once, even with many updates.
 */
export function commitHistory<T>(history: HistoryState<T>, before: T, after: T, options: HistoryCommitOptions<T> = {}): HistoryState<T> {
  const group = options.group ?? null;
  const equals = options.equals ?? sameSnapshot;
  if (equals(before, after)) {
    // An independent no-op still ends the previous gesture, but does not erase redo.
    return group === history.group ? history : { ...history, group: null };
  }
  const continuing = group !== null && history.group === group && history.past.length > 0;
  if (continuing && equals(history.past[history.past.length - 1], after)) {
    // Returning a slider or a native text undo to its starting value leaves no edit.
    return { ...history, past: history.past.slice(0, -1), future: [], group: null };
  }
  const past = continuing ? history.past : [...history.past, structuredClone(before)].slice(-history.limit);
  return { ...history, past, future: [], group };
}

export function endHistoryGroup<T>(history: HistoryState<T>): HistoryState<T> {
  return history.group === null ? history : { ...history, group: null };
}

export function undoHistory<T>(history: HistoryState<T>, current: T): HistoryTransition<T> | null {
  if (!history.past.length) return null;
  return {
    history: { ...history, past: history.past.slice(0, -1), future: [...history.future, structuredClone(current)].slice(-history.limit), group: null },
    value: structuredClone(history.past[history.past.length - 1]),
  };
}

export function redoHistory<T>(history: HistoryState<T>, current: T): HistoryTransition<T> | null {
  if (!history.future.length) return null;
  return {
    history: { ...history, past: [...history.past, structuredClone(current)].slice(-history.limit), future: history.future.slice(0, -1), group: null },
    value: structuredClone(history.future[history.future.length - 1]),
  };
}

type ShortcutTarget = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  parentElement?: ShortcutTarget | null;
};

/** Preserve native draft undo in text/number editors, including nested rich text. */
export function isTextEditingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as ShortcutTarget;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type?.toLowerCase() ?? 'text');
  }
  return element.parentElement ? isTextEditingTarget(element.parentElement) : false;
}

/** Ctrl+Z/Ctrl+Y and their usual macOS/Shift+Z equivalents; never steal text undo. */
export function historyShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}): 'undo' | 'redo' | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || (!event.ctrlKey && !event.metaKey) || isTextEditingTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
