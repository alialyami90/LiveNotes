import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { NoteMeta } from '../library/types';
import './home.css';

interface Props {
  meta: NoteMeta;
  onPin(on: boolean): void;
  onArchive(on: boolean): void;
  onDelete(): void;
}

// The menu often sits near a card link; keep every click away from it.
const swallow = (e: MouseEvent) => {
  e.stopPropagation();
  e.preventDefault();
};

export function CardMenu({ meta, onPin, onArchive, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length].focus();
  };

  const choose = (e: MouseEvent, run: () => void) => {
    swallow(e);
    close(true);
    run();
  };

  const pinned = !!meta.pinned;
  const archived = !!meta.archived;

  return (
    <div
      className="card-menu"
      ref={root}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // A null relatedTarget (Safari doesn't focus buttons on click) is left to the pointerdown handler,
        // otherwise the list would close before the click on an item lands.
        const next = e.relatedTarget as Node | null;
        if (next && !root.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="card-menu__trigger"
        aria-label="Note actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          swallow(e);
          if (!open) {
            // Near the bottom of the screen the list would run off it, so open it upward.
            const r = e.currentTarget.getBoundingClientRect();
            setUp(r.top > window.innerHeight * 0.6);
          }
          setOpen((o) => !o);
        }}
      >
        ⋯
      </button>
      {open && (
        <div className={`card-menu__list${up ? ' card-menu__list--up' : ''}`} role="menu" id={menuId} aria-label="Note actions">
          <button type="button" role="menuitem" className="card-menu__item" onClick={(e) => choose(e, () => onPin(!pinned))}>
            {pinned ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="card-menu__item"
            onClick={(e) => choose(e, () => onArchive(!archived))}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="card-menu__item card-menu__item--danger"
            onClick={(e) => choose(e, onDelete)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
