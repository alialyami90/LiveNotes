import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { navigate } from '../app/router';
import { useLibrary } from '../library/LibraryProvider';
import { sampleDoc } from '../model/sample';

/** The library names its first-launch sample the same way; Home uses it to spot a sample-only library. */
export const SAMPLE_TITLE = 'Portugal road trip (sample)';

const STORAGE_FAILED = 'storage is full or unavailable.';

/** The header ⋯ menu: Import note and Add sample note. */
export function HomeMenu() {
  const { library, refresh, today } = useLibrary();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
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
    if (e.key === 'Escape' && open) {
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

  const openNote = (id: string) => {
    refresh();
    navigate(`#/note/${encodeURIComponent(id)}`);
  };

  const addSample = () => {
    close(false);
    let id: string;
    try {
      id = library.create({ ...sampleDoc(new Date(`${today}T12:00:00`)), title: SAMPLE_TITLE }).id;
    } catch (e) {
      console.warn('LiveNotes: could not add the sample note', e);
      alert(`Could not add the sample note: ${STORAGE_FAILED}`);
      return;
    }
    openNote(id);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Cleared so picking the same file again still fires a change.
    e.target.value = '';
    if (!picked) return;
    let text: string;
    try {
      text = await picked.text();
    } catch {
      alert('That file is not a LiveNotes document.');
      return;
    }
    let id: string | undefined;
    try {
      id = library.importDoc(text)?.id;
    } catch (err) {
      console.warn('LiveNotes: could not import the note', err);
      alert(`Could not import the note: ${STORAGE_FAILED}`);
      return;
    }
    if (!id) {
      alert('That file is not a LiveNotes document.');
      return;
    }
    openNote(id);
  };

  return (
    <div
      className="home-menu"
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !root.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="card-menu__trigger home-menu__trigger"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="card-menu__list home-menu__list" role="menu" id={menuId} aria-label="More">
          <button
            type="button"
            role="menuitem"
            className="card-menu__item"
            onClick={() => {
              close(false);
              file.current?.click();
            }}
          >
            Import note
          </button>
          <button type="button" role="menuitem" className="card-menu__item" onClick={addSample}>
            Add sample note
          </button>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="home-menu__file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void onFile(e)}
      />
    </div>
  );
}
