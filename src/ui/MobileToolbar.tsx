import { useSyncExternalStore, type SyntheticEvent } from 'react';
import type { Doc, NodeId, OpResult } from '../model/types';
import { deleteNode, indent, moveDown, moveUp, outdent, toggleCollapse } from '../model/ops';
import { useStore } from './store';

const COARSE = '(pointer: coarse)';

function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.(COARSE);
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    () => window.matchMedia?.(COARSE).matches ?? false,
  );
}

type Action = { label: string; icon: string; op: (doc: Doc, id: NodeId) => OpResult; keepFocus: boolean };

const ACTIONS: Action[] = [
  { label: 'Outdent', icon: '⇤', op: outdent, keepFocus: true },
  { label: 'Indent', icon: '⇥', op: indent, keepFocus: true },
  { label: 'Move up', icon: '↑', op: moveUp, keepFocus: true },
  { label: 'Move down', icon: '↓', op: moveDown, keepFocus: true },
  { label: 'Collapse', icon: '▾', op: toggleCollapse, keepFocus: true },
  { label: 'Delete bullet', icon: '🗑', op: deleteNode, keepFocus: false },
];

/** Keeps focus (and the soft keyboard) on the editor while a button is pressed. */
const keepEditorFocus = (e: SyntheticEvent) => e.preventDefault();

/**
 * Soft keyboards have no Tab and an unreliable Backspace, so structural edits
 * get buttons while a row is being edited on a touch screen.
 */
export function MobileToolbar({ forceVisible = false }: { forceVisible?: boolean }) {
  const { doc, focus, apply } = useStore();
  const coarse = useCoarsePointer();
  if (!focus || !(coarse || forceVisible)) return null;

  const run = (a: Action) => {
    const editor = document.activeElement;
    const caret = editor instanceof HTMLTextAreaElement ? editor.selectionStart : focus.caret;
    if (a.label === 'Delete bullet' && doc.nodes[focus.id].children.length > 0 && !confirm('Delete this bullet and everything under it?')) return;
    apply((d) => a.op(d, focus.id), a.keepFocus ? { id: focus.id, caret } : undefined);
  };

  return (
    <div className="mobile-toolbar" role="toolbar" aria-label="Edit bullet">
      {ACTIONS.map((a) => (
        <button
          key={a.label}
          type="button"
          aria-label={a.label}
          title={a.label}
          onPointerDown={keepEditorFocus}
          onMouseDown={keepEditorFocus}
          onClick={() => run(a)}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}
