import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { NodeId } from '../model/types';
import { formatValue } from '../formula/format';
import { useStore } from './store';
import { useFormula } from './useFormula';

export function PlaceChip({ placeKey, name }: { placeKey: string; name: string }) {
  const { doc, placeStatus, retryPlace } = useStore();
  const place = doc.places[placeKey];
  const s = placeStatus[placeKey];
  const status = place ? 'is-resolved' : s === 'missing' ? 'is-missing' : s === 'error' ? 'is-error' : 'is-pending';
  const title = place
    ? (place.label ?? place.name)
    : status === 'is-missing'
      ? 'Place not found — edit the mention and pick a suggestion'
      : status === 'is-error'
        ? 'Couldn’t reach the place service — retrying; tap to retry now'
        : 'Looking up…';
  const onClick = (e: MouseEvent) => {
    if (status !== 'is-error') return;
    e.stopPropagation(); // retry instead of opening the editor
    retryPlace(placeKey);
  };
  return (
    <span className={`chip chip-place ${status}`} title={title} onClick={onClick}>
      {name}
    </span>
  );
}

export function DateChip({ raw, iso }: { raw: string; iso?: string }) {
  return (
    <span className="chip chip-date" title={iso}>
      {raw}
    </span>
  );
}

/**
 * The chip truncates long messages, and the hover tooltip doesn't exist on a phone,
 * so a tap opens the full text. The popover is a sibling of the chip (which clips
 * its overflow) and swallows clicks so the row doesn't switch to the editor.
 */
function ErrorChip({ source, message, text }: { source: string; message: string; text: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };
  return (
    <span className="chip-wrap" ref={wrap}>
      <span
        className="chip chip-formula kind-error is-error"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={`{${source}}\n${message}`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(e);
          }
        }}
      >
        {text}
      </span>
      {open && (
        <span className="chip-popover" role="status" onClick={(e) => e.stopPropagation()}>
          {message}
        </span>
      )}
    </span>
  );
}

export function FormulaChip({ nodeId, source }: { nodeId: NodeId; source: string }) {
  const state = useFormula(nodeId, source);
  if (state.status === 'pending') {
    return (
      <span className="chip chip-formula is-pending" title={`{${source}}`}>
        …
      </span>
    );
  }
  const { value } = state;
  if (value.kind === 'error') return <ErrorChip source={source} message={value.message} text={formatValue(value)} />;
  return (
    <span className={`chip chip-formula kind-${value.kind}`} title={`{${source}}`}>
      {formatValue(value)}
    </span>
  );
}
