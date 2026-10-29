import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { setTitle } from '../model/ops';
import { useStore } from '../ui/store';
import './note.css';

/** A title is one line: pasted or typed line breaks become spaces. */
const oneLine = (s: string) => s.replace(/\r\n|\r|\n/g, ' ');

export function TitleField({ autoFocus = false }: { autoFocus?: boolean }) {
  const { doc, apply, setFocus } = useStore();
  const title = doc.title ?? '';
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !autoFocus) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  // Grows with its content like the bullet editor; wrapping a long title is fine.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const goToOutline = () => {
    const first = doc.nodes[doc.rootId].children[0];
    if (first) {
      setFocus({ id: first, caret: 0 });
      return;
    }
    // Same as Outline's "Start typing…" button, which we may not touch from here.
    apply((d) => {
      const node = { id: crypto.randomUUID(), text: '', children: [] };
      const root = d.nodes[d.rootId];
      return {
        doc: { ...d, nodes: { ...d.nodes, [node.id]: node, [root.id]: { ...root, children: [node.id] } } },
        focus: { id: node.id, caret: 0 },
      };
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Android keyboards confirm an IME composition with Enter; that must not leave the field.
    if (e.nativeEvent.isComposing) return;
    goToOutline();
  };

  return (
    <textarea
      ref={ref}
      className="title-field"
      rows={1}
      aria-label="Title"
      placeholder="Title"
      value={title}
      spellCheck={false}
      onChange={(e) => apply((d) => setTitle(d, oneLine(e.target.value)))}
      onKeyDown={onKeyDown}
    />
  );
}
