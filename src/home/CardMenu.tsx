import { useId, useState, type MouseEvent } from 'react';
import type { NoteMeta } from '../library/types';
import { useMenu } from '../ui/useMenu';
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
  const { open, setOpen, rootRef, triggerRef, close, onKeyDown, onBlur } = useMenu();
  const [up, setUp] = useState(false);
  const menuId = useId();

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
      ref={rootRef}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
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
