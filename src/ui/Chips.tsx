import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { NodeId } from '../model/types';
import { formatValue } from '../formula/format';
import { placeIcon } from '../services/kinds';
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
    <span className={`chip chip-place ${status}`} data-icon={placeIcon(place)} title={title} onClick={onClick}>
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

const POPOVER_MARGIN = 8;
const POPOVER_GAP = 4;

/**
 * The chip truncates long messages, and the hover tooltip doesn't exist on a phone,
 * so a tap opens the full text. The popover is portalled to <body> because views clip
 * their overflow; it is fixed-positioned from the chip's rect. React still bubbles its
 * events through the portal to the row, so it swallows clicks like the chip does.
 */
function ErrorChip({ source, message, text }: { source: string; message: string; text: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    // Below the chip, flipped above when it would run off the bottom, and clamped
    // sideways into the viewport. Re-run on scroll/resize so it follows the chip.
    const place = () => {
      const c = chip.current?.getBoundingClientRect();
      const el = pop.current;
      if (!c || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = c.bottom + POPOVER_GAP;
      const above = c.top - POPOVER_GAP - h;
      const flip = below + h + POPOVER_MARGIN > window.innerHeight && above >= POPOVER_MARGIN;
      const left = Math.max(POPOVER_MARGIN, Math.min(c.left, window.innerWidth - w - POPOVER_MARGIN));
      el.style.top = `${flip ? above : below}px`;
      el.style.left = `${left}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
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
  // The click handler sits on the wrapper so its ::before can widen the touch target
  // to 44px on phones without being clipped by the chip's own overflow.
  return (
    <span className="chip-wrap" ref={wrap} onClick={toggle}>
      <span
        ref={chip}
        className="chip chip-formula kind-error is-error"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={`{${source}}\n${message}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(e);
          }
        }}
      >
        {text}
      </span>
      {open &&
        createPortal(
          <span ref={pop} className="chip-popover" role="status" onClick={(e) => e.stopPropagation()}>
            {message}
          </span>,
          document.body,
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
  if (value.kind === 'travel' && value.directionsUrl) {
    // R11: a plain link; Capacitor hands other hosts to the system browser. Its click must
    // not open the row editor, and on touch its own ::before widens it to 44px (chips.css).
    return (
      <span className="chip-wrap">
        <span className="chip chip-formula kind-travel" title={`{${source}}`}>
          {formatValue(value)} ·{' '}
          <a
            className="chip-link"
            href={value.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Public transport directions in Google Maps (opens in a new tab)"
            onClick={(e) => e.stopPropagation()}
          >
            Directions ↗
          </a>
        </span>
      </span>
    );
  }
  return (
    <span className={`chip chip-formula kind-${value.kind}`} title={`{${source}}`}>
      {formatValue(value)}
    </span>
  );
}
