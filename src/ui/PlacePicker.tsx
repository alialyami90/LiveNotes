import { Fragment, useEffect, useRef, type SyntheticEvent } from 'react';
import { placeIcon } from '../services/kinds';
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
  const ref = useRef<HTMLDivElement & HTMLUListElement>(null);
  // On a phone the row being typed in often sits just above the keyboard and toolbar.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [items.length > 0]);

  // The list scrolls inside a fixed-height box, so a row reached by the arrow keys (or by
  // wrapping from the first row to the last) can be out of sight. Skip the first render:
  // opening the picker must not scroll beyond the effect above.
  const lastActive = useRef(active);
  useEffect(() => {
    if (lastActive.current === active) return;
    lastActive.current = active;
    ref.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (items.length === 0) {
    return loading ? (
      <div ref={ref} className="picker picker-status" aria-live="polite">
        Searching places…
      </div>
    ) : null;
  }
  return (
    <ul ref={ref} className="picker" role="listbox" aria-label="Places">
      {items.map((s, i) => (
        <Fragment key={`${s.place.lat},${s.place.lon},${i}`}>
          {/* Only between rows: a divider needs something above it (R9). `near` is implied, since without it nothing is elsewhere. */}
          {s.section === 'elsewhere' && i > 0 && items[i - 1].section !== 'elsewhere' && (
            <li role="presentation" className="picker-divider">
              Elsewhere
            </li>
          )}
          <li
            role="option"
            aria-selected={i === active}
            className={`picker-option${i === active ? ' is-active' : ''}${s.saved ? ' is-saved' : ''}`}
            onPointerDown={keepEditorFocus}
            onMouseDown={keepEditorFocus}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(s)}
          >
            <span className="picker-icon" aria-hidden="true">
              {placeIcon(s.place)}
            </span>
            <span className="picker-text">
              <strong>{s.place.name}</strong>
              <span className="picker-label">{s.place.label ?? ''}</span>
            </span>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}
