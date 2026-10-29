import { useEffect, useRef, useState } from 'react';
import { goBack, navigate } from '../app/router';
import { useLibrary } from '../library/LibraryProvider';
import { isBlankDoc } from '../library/blank';
import { exportDocument } from '../platform/export';
import { MobileToolbar } from '../ui/MobileToolbar';
import { Outline } from '../ui/Outline';
import { useStore } from '../ui/store';
import { TitleField } from './TitleField';
import './screen.css';

const FALLBACK_NAME = 'livenotes.json';

/** weekend-trip.json from "Weekend trip!"; letters of any script are kept, so non-Latin titles still name the file. */
export function exportName(title: string | undefined): string {
  const full = (title ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // By code point: a UTF-16 cut could split a surrogate pair.
  const slug = Array.from(full).slice(0, 60).join('').replace(/-+$/, '');
  return slug ? `${slug}.json` : FALLBACK_NAME;
}

export function NoteScreen({ id, isNew }: { id: string; isNew: boolean }) {
  const { doc } = useStore();
  const { metas, library, refresh, deleteWithUndo } = useLibrary();
  const meta = metas.find((m) => m.id === id);
  const pinned = !!meta?.pinned;
  const archived = !!meta?.archived;

  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    buttonRef.current?.focus();
  };

  /** A failed write must not take the screen down; the note simply stays as it was. */
  const mutate = (what: string, run: () => void) => {
    try {
      run();
    } catch (e) {
      console.warn(`LiveNotes: could not ${what}`, e);
    }
    refresh();
  };

  const onExport = () =>
    exportDocument(JSON.stringify(doc, null, 2), { name: exportName(doc.title?.trim() || meta?.summary.title) }).catch((e: unknown) =>
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`),
    );

  const items: { label: string; danger?: boolean; run: () => void }[] = [
    { label: pinned ? 'Unpin' : 'Pin', run: () => mutate('pin the note', () => library.setPinned(id, !pinned)) },
    { label: archived ? 'Unarchive' : 'Archive', run: () => mutate('archive the note', () => library.setArchived(id, !archived)) },
    { label: 'Export', run: () => void onExport() },
    {
      label: 'Delete',
      danger: true,
      run: () => {
        // Nothing worth undoing: Root's discard-on-leave removes it, and an Undo bar would restore nothing.
        if (!(isNew && isBlankDoc(doc))) deleteWithUndo(id);
        // Replace, not push: back from home must not land on a note that no longer exists.
        navigate('#/', { replace: true });
      },
    },
  ];

  return (
    <main className="note-screen" data-screen="note">
      <header className="note-bar">
        <button type="button" className="note-bar-btn" aria-label="Back" onClick={goBack}>
          ←
        </button>
        {archived && <span className="note-pill">Archived</span>}
        <div
          className="note-menu-wrap"
          ref={wrapRef}
          onBlur={(e) => {
            // A null relatedTarget (Safari doesn't focus buttons on click) is left to the pointerdown handler,
            // otherwise the menu would close before the click on an item lands.
            const next = e.relatedTarget as Node | null;
            if (menuOpen && next && !wrapRef.current?.contains(next)) setMenuOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !menuOpen) return;
            e.stopPropagation();
            closeMenu();
          }}
        >
          <button
            type="button"
            ref={buttonRef}
            className="note-bar-btn"
            aria-label="Note menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="note-menu" role="menu" aria-label="Note actions">
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`note-menu-item${item.danger ? ' is-danger' : ''}`}
                  onClick={() => {
                    closeMenu();
                    item.run();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <div className="note-page">
        <TitleField autoFocus={isNew} />
        <Outline />
        <footer className="legend">
          <span><code>@Place</code> or <code>@[Two Words]</code> mentions a place</span>
          <span><code>Nov 3</code> mentions a date</span>
          <span><code>{'{weather()}'}</code> <code>{'{route(prev, here)}'}</code> formulas</span>
          <span><code>/map</code> <code>/calendar</code> <code>/table</code> + Enter adds a view</span>
        </footer>
      </div>
      <MobileToolbar />
    </main>
  );
}
