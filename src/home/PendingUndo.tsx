import { useEffect, useRef } from 'react';
import { useLibrary } from '../library/LibraryProvider';
import { UndoBar } from './UndoBar';

/** Focus the bar owns: on it, or lost to <body> when the deleted card took it along. */
const barOwnsFocus = () => {
  const at = document.activeElement;
  return !at || at === document.body || !!at.closest('.undo-bar');
};

const attr = (v: string) => v.replace(/["\\]/g, '\\$&');

/**
 * The undo bar for Home and Archive. Root mounts it once beside both screens, so switching
 * between them keeps its countdown. When the bar goes, focus it held moves somewhere useful:
 * the restored card (or pinned chip) after Undo, the screen heading after the window ends.
 */
export function PendingUndo() {
  const { pendingDelete, undoDelete, expireDelete } = useLibrary();
  // Runs after the commit that removes the bar, when the restored card is in the DOM again.
  const focusNext = useRef<(() => void) | null>(null);
  useEffect(() => {
    const run = focusNext.current;
    focusNext.current = null;
    run?.();
  });

  if (pendingDelete === null) return null;
  const id = pendingDelete;
  const onUndo = () => {
    if (barOwnsFocus()) {
      focusNext.current = () =>
        document.querySelector<HTMLElement>(`main[data-screen] a[href="${attr(`#/note/${id}`)}"]`)?.focus();
    }
    undoDelete();
  };
  const onExpire = () => {
    if (barOwnsFocus()) focusNext.current = () => document.querySelector<HTMLElement>('main[data-screen] h1')?.focus();
    expireDelete();
  };
  // Keyed by note, so a second delete starts a fresh window.
  return <UndoBar key={id} onUndo={onUndo} onExpire={onExpire} />;
}
