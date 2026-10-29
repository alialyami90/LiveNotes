import { useEffect, useRef, type SyntheticEvent } from 'react';
import { MODES } from '../syntax/phrases';

interface Props {
  active: number;
  onPick(index: number): void;
  onHover(index: number): void;
}

const keepEditorFocus = (e: SyntheticEvent) => e.preventDefault();

/** "How do you get there?" under a `to @place` that has no mode word yet. */
export function ModePicker({ active, onPick, onHover }: Props) {
  const ref = useRef<HTMLUListElement>(null);
  // Same as the place picker: the row being typed in often sits just above the keyboard.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  return (
    <ul ref={ref} className="picker picker-modes" role="listbox" aria-label="Travel mode">
      {MODES.map((m, i) => (
        <li
          key={m.mode}
          role="option"
          aria-selected={i === active}
          className={`picker-option${i === active ? ' is-active' : ''}`}
          onPointerDown={keepEditorFocus}
          onMouseDown={keepEditorFocus}
          // Only a pointer that actually moves selects a row. The popup often opens right under
          // the cursor left by a click on the place picker, and the browser then reports a
          // mouseenter (and a still mousemove); selecting there would make Enter choose (C1).
          onMouseMove={(e) => {
            if (e.movementX || e.movementY) onHover(i);
          }}
          onClick={() => onPick(i)}
        >
          <span className="picker-icon" aria-hidden="true">
            {m.icon}
          </span>
          <strong>{m.label}</strong>
        </li>
      ))}
    </ul>
  );
}
