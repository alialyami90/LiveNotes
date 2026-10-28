import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Focus, NodeId, ViewKind } from '../model/types';
import { indent, moveDown, moveUp, outdent, removeOrMerge, setText, setView, splitNode, toggleCollapse } from '../model/ops';
import { visibleOrder } from '../model/tree';
import { useStore } from './store';

const VIEW_COMMAND = /\s*\/(map|calendar|table|none)$/;

export function NodeEditor({ id, focus }: { id: NodeId; focus: Focus }) {
  const { doc, apply, setFocus } = useStore();
  const text = doc.nodes[id].text;
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const caret = Math.min(focus.caret, el.value.length);
    el.setSelectionRange(caret, caret);
  }, [focus]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const caret = () => ref.current?.selectionStart ?? 0;
  const here = (): Focus => ({ id, caret: caret() });

  const moveFocus = (delta: -1 | 1) => {
    const order = visibleOrder(doc);
    const target = order[order.indexOf(id) + delta];
    if (!target) return false;
    const len = doc.nodes[target].text.length;
    setFocus({ id: target, caret: delta === -1 ? len : Math.min(caret(), len) });
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const collapsed = el.selectionStart === el.selectionEnd;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const cmd = text.match(VIEW_COMMAND);
      if (cmd) {
        const stripped = text.slice(0, cmd.index);
        const view = cmd[1] === 'none' ? undefined : (cmd[1] as ViewKind);
        apply((d) => setView(setText(d, id, stripped).doc, id, view), { id, caret: stripped.length });
        return;
      }
      apply((d) => splitNode(d, id, el.selectionStart));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      apply((d) => (e.shiftKey ? outdent(d, id) : indent(d, id)), here());
    } else if (e.key === 'Backspace' && collapsed && el.selectionStart === 0) {
      e.preventDefault();
      apply((d) => removeOrMerge(d, id));
    } else if (e.key === 'ArrowUp' && e.altKey && e.shiftKey) {
      e.preventDefault();
      apply((d) => moveUp(d, id), here());
    } else if (e.key === 'ArrowDown' && e.altKey && e.shiftKey) {
      e.preventDefault();
      apply((d) => moveDown(d, id), here());
    } else if (e.key === 'ArrowUp' && collapsed && !text.slice(0, el.selectionStart).includes('\n')) {
      if (moveFocus(-1)) e.preventDefault();
    } else if (e.key === 'ArrowDown' && collapsed && !text.slice(el.selectionEnd).includes('\n')) {
      if (moveFocus(1)) e.preventDefault();
    } else if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      apply((d) => toggleCollapse(d, id), here());
    } else if (e.key === 'Escape') {
      el.blur();
    }
  };

  return (
    <textarea
      ref={ref}
      className="editor"
      rows={1}
      value={text}
      spellCheck={false}
      onChange={(e) => apply((d) => setText(d, id, e.target.value))}
      onKeyDown={onKeyDown}
      onBlur={() => setFocus((f) => (f?.id === id ? null : f))}
    />
  );
}
