import type { SyntheticEvent } from 'react';
import type { Suggestion } from './usePlaceSearch';

interface Props {
  items: Suggestion[];
  active: number;
  loading: boolean;
  onPick(s: Suggestion): void;
  onHover(index: number): void;
}

const keepEditorFocus = (e: SyntheticEvent) => e.preventDefault();

export function PlacePicker({ items, active, loading, onPick, onHover }: Props) {
  if (items.length === 0) {
    return loading ? (
      <div className="picker picker-status" aria-live="polite">
        Searching places…
      </div>
    ) : null;
  }
  return (
    <ul className="picker" role="listbox" aria-label="Places">
      {items.map((s, i) => (
        <li
          key={`${s.place.lat},${s.place.lon},${i}`}
          role="option"
          aria-selected={i === active}
          className={`picker-option${i === active ? ' is-active' : ''}${s.saved ? ' is-saved' : ''}`}
          onPointerDown={keepEditorFocus}
          onMouseDown={keepEditorFocus}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(s)}
        >
          <strong>{s.place.name}</strong>
          <span>{s.place.label ?? ''}</span>
        </li>
      ))}
    </ul>
  );
}
