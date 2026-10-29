import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Focus, NodeId, ViewKind } from '../model/types';
import { indent, moveDown, moveUp, outdent, removeOrMerge, setPlace, setText, setView, splitNode, toggleCollapse } from '../model/ops';
import { visibleOrder } from '../model/tree';
import { useStore } from './store';
import { placeKey, tokenize } from '../syntax/tokenize';
import { activeMention, insertMention } from '../syntax/mention';
import { usePlaceSearch, type Suggestion } from './usePlaceSearch';
import { PlacePicker } from './PlacePicker';

/** Raw text with tokens coloured; must render character-for-character like the textarea. */
function Mirror({ text }: { text: string }) {
  return (
    <div className="editor-mirror" aria-hidden>
      {tokenize(text).map((s, i) =>
        s.kind === 'text' ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span key={i} className={`hl-${s.kind}`}>
            {s.raw}
          </span>
        ),
      )}
      {/* keeps a trailing newline from collapsing the last line */}
      {'\u200b'}
    </div>
  );
}

const VIEW_COMMAND = /(?:^|\s+)\/(map|calendar|table|none)$/;

export function NodeEditor({ id, focus }: { id: NodeId; focus: Focus }) {
  const { doc, viewDoc, contexts, apply, setFocus } = useStore();
  const text = doc.nodes[id].text;
  const ref = useRef<HTMLTextAreaElement>(null);

  // The @mention under the caret drives the place picker.
  const [caretPos, setCaretPos] = useState(focus.caret);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const mention = activeMention(text, caretPos);
  const pickerOpen = mention !== null && mention.start !== dismissedAt;
  const nearKey = contexts.get(id)?.inheritedPlaceKey;
  const { items, loading } = usePlaceSearch(pickerOpen ? mention.query : null, nearKey ? viewDoc.places[nearKey] : undefined);
  const showing = pickerOpen && (items.length > 0 || loading);
  const trackCaret = () => setCaretPos(ref.current?.selectionStart ?? 0);

  const pick = (s: Suggestion) => {
    if (!mention) return;
    const next = insertMention(text, mention, s.place.name);
    const key = placeKey(s.place.name.replace(/[[\]]/g, ''));
    apply((d) => setPlace(setText(d, id, next.text).doc, key, s.place), { id, caret: next.caret });
    setCaretPos(next.caret);
    setActive(0);
  };

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
    if (showing && mention) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && items[active]) {
        e.preventDefault();
        pick(items[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedAt(mention.start);
        return;
      }
    }
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
    <div className="editor-wrap">
      <Mirror text={text} />
      <textarea
        ref={ref}
        className="editor"
        rows={1}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          apply((d) => setText(d, id, e.target.value));
          setCaretPos(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={trackCaret}
        onKeyDown={onKeyDown}
        onBlur={() => setFocus((f) => (f?.id === id ? null : f))}
      />
      {showing && <PlacePicker items={items} active={Math.min(active, Math.max(items.length - 1, 0))} loading={loading} onPick={pick} onHover={setActive} />}
    </div>
  );
}
