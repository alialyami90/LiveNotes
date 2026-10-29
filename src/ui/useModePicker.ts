import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MODES, insertModeWord, routeWithoutMode } from '../syntax/phrases';
import { scan } from '../syntax/scan';

interface Armed {
  text: string;
  at: number;
  /** R10: `${at}|${mentionRaw}`; a dismissed signature never re-arms. */
  sig: string;
}

// Holding a modifier is not "typing another key" (Shift for a capital, Ctrl before a shortcut).
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

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
  const [active, setActive] = useState(0);
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
    setArmed({ text: next, at: found.at, sig });
    setActive(0);
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
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : MODES.length - 1)) % MODES.length);
      return 'handled';
    }
    if (plain && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      return 'choose';
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return 'handled';
    }
    dismiss();
    return 'pass';
  };

  return { open, active, arm, dismiss, setActive, choose, onKeyDown };
}
