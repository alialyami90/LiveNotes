import { useId, useRef, type ChangeEvent } from 'react';
import { navigate } from '../app/router';
import { useLibrary } from '../library/LibraryProvider';
import { sampleNote } from '../library/storage';
import { useMenu } from '../ui/useMenu';

const NOT_A_NOTE = 'That file is not a LiveNotes document.';

/** The header ⋯ menu: Import note and Add sample note. */
export function HomeMenu() {
  const { library, today, attempt } = useLibrary();
  const { open, toggle, rootRef, triggerRef, close, onKeyDown, onBlur } = useMenu();
  const file = useRef<HTMLInputElement>(null);
  const menuId = useId();

  /** Runs a create-style write and opens the note it made; attempt() reports a storage failure. */
  const createAndOpen = (what: string, make: () => string | undefined): 'opened' | 'failed' | 'none' => {
    let id: string | undefined;
    if (!attempt(what, () => (id = make()))) return 'failed';
    if (!id) return 'none';
    navigate(`#/note/${encodeURIComponent(id)}`);
    return 'opened';
  };

  const addSample = () => {
    close(false);
    createAndOpen('add the sample note', () => library.create(sampleNote(today)).id);
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
      alert(NOT_A_NOTE);
      return;
    }
    if (createAndOpen('import the note', () => library.importDoc(text)?.id) === 'none') alert(NOT_A_NOTE);
  };

  return (
    <div className="home-menu" ref={rootRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="card-menu__trigger home-menu__trigger"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
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
