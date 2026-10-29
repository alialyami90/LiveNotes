import { useEffect, useRef } from 'react';
import './home.css';

interface Props {
  onUndo(): void;
  onExpire(): void;
  ms?: number;
}

export function UndoBar({ onUndo, onExpire, ms = 6000 }: Props) {
  // The latest callback is read when the timer fires, so a parent re-render can't restart the countdown.
  const expire = useRef(onExpire);
  expire.current = onExpire;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const undo = useRef<HTMLButtonElement>(null);

  // A keyboard delete removes the focused card with it; catch focus here instead of losing it to <body>.
  useEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body) undo.current?.focus();
  }, []);

  useEffect(() => {
    timer.current = setTimeout(() => expire.current(), ms);
    return () => clearTimeout(timer.current);
  }, [ms]);

  return (
    <div className="undo-bar" role="status">
      <span>Note deleted</span>
      <button
        ref={undo}
        type="button"
        className="undo-bar__undo"
        onClick={() => {
          clearTimeout(timer.current);
          onUndo();
        }}
      >
        Undo
      </button>
    </div>
  );
}
