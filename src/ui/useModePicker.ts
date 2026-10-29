import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MODES, insertModeWord, routeWithoutMode } from '../syntax/phrases';
import { scan } from '../syntax/scan';
import { activeMention } from '../syntax/mention';

interface Armed {
  text: string;
  at: number;
  /** Where the caret was; moving it anywhere else ends the phrase. */
  caret: number;
  /** R10: `${at}|${mentionRaw}`; a dismissed signature never re-arms. */
  sig: string;
}

// Holding a modifier is not "typing another key" (Shift for a capital, Ctrl before a shortcut).
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

const BOUNDARY = /^[\s\p{P}]$/u;
const CLOSES_BRACKET = /@\[[^\]]*\]$/;

/**
 * True when `next` is `prev` plus one space or punctuation mark typed just before
 * `caret` that ends a mention. Not a hyphen or apostrophe that continues the name
 * (@Porto-Novo), and not the `]` closing `@[São Bento]`: the space that usually
 * follows would dismiss a popup opened on the bracket.
 */
function endsMention(prev: string, next: string, caret: number): boolean {
  if (next.length !== prev.length + 1 || caret < 1) return false;
  if (!BOUNDARY.test(next[caret - 1]) || next.slice(0, caret - 1) + next.slice(caret) !== prev) return false;
  return !activeMention(next, caret) && !CLOSES_BRACKET.test(next.slice(0, caret));
}

function signature(text: string, caret: number, at: number): string {
  const places = scan(text.slice(0, caret)).filter((s) => s.kind === 'place');
  return `${at}|${places.at(-1)?.raw ?? ''}`;
}

/**
 * The travel-mode popup's state for one editor. It is open only while the text is
 * exactly what it was armed with (R10), so any edit closes it, including the
 * keyCode-229 input of Android keyboards, which never reaches onKeyDown.
 */
export function useModePicker(text: string) {
  const [armed, setArmedState] = useState<Armed | null>(null);
  // -1: nothing selected. The popup opens that way so Enter and Tab keep their
  // editor meaning (split, indent) unless the user has chosen a row (C1).
  const [active, setActive] = useState(-1);
  const armedRef = useRef<Armed | null>(null);
  const dismissed = useRef(new Set<string>());

  const setArmed = (a: Armed | null) => {
    armedRef.current = a;
    setArmedState(a);
  };
  const dismiss = () => {
    if (armedRef.current) dismissed.current.add(armedRef.current.sig);
    setArmed(null);
  };

  // An edit away from the armed text dismisses the phrase, as if the user had moved on.
  useEffect(() => {
    if (armedRef.current && armedRef.current.text !== text) dismiss();
  }, [text]);

  const open = armed !== null && armed.text === text;

  const arm = (next: string, caret: number) => {
    if (armedRef.current && armedRef.current.text !== next) dismiss();
    const found = routeWithoutMode(next, caret);
    if (!found) return;
    const sig = signature(next, caret, found.at);
    if (dismissed.current.has(sig)) return;
    setArmed({ text: next, at: found.at, caret, sig });
    setActive(-1);
  };

  /** Arms after an edit only when the user just typed the end of a mention. */
  const armAfterChange = (prev: string, next: string, caret: number) => {
    if (endsMention(prev, next, caret)) arm(next, caret);
  };

  /** A tap, click or selection away from the armed caret dismisses the phrase. */
  const caretMoved = (start: number, end: number) => {
    const a = armedRef.current;
    if (a && (start !== a.caret || end !== a.caret)) dismiss();
  };

  const choose = (i: number, caret: number): { text: string; caret: number } | null => {
    const mode = MODES[i];
    if (!open || !armed || !mode) return null;
    setArmed(null);
    return insertModeWord(text, armed.at, mode.mode, caret);
  };

  const onKeyDown = (e: KeyboardEvent): 'choose' | 'handled' | 'pass' => {
    if (!open) return 'pass';
    if (MODIFIERS.has(e.key)) return 'pass';
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (plain && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      setActive((a) => (a < 0 ? (down ? 0 : MODES.length - 1) : (a + (down ? 1 : MODES.length - 1)) % MODES.length));
      return 'handled';
    }
    if (plain && (e.key === 'Enter' || e.key === 'Tab') && active >= 0) {
      e.preventDefault();
      return 'choose';
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return 'handled';
    }
    // Anything else, including Enter or Tab with no row selected, dismisses the
    // phrase and then does its normal editor job.
    dismiss();
    return 'pass';
  };

  return { open, active, arm, armAfterChange, caretMoved, dismiss, setActive, choose, onKeyDown };
}
