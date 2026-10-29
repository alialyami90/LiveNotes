import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isoDate, type ISODate } from '../context/resolve';
import { safeStorage } from '../model/storage';
import { memoryStorage } from './memoryStorage';
import { createLibrary, INDEX_KEY, type Library } from './storage';
import type { NoteMeta } from './types';

interface LibraryValue {
  metas: NoteMeta[];
  library: Library;
  today: ISODate;
  refresh(): void;
  /** Created by this tab since it loaded: the only notes that leaving empty may discard. */
  isNewThisSession(id: string): boolean;
  /** The note whose delete can still be undone; Home shows the undo bar while it is set. */
  pendingDelete: string | null;
  /** Soft-deletes now; the note is purged when the undo window ends or the app hides. */
  deleteWithUndo(id: string): void;
  undoDelete(): void;
  expireDelete(): void;
  /**
   * Runs a library write the user asked for. A failure (quota, blocked storage) is reported
   * with an alert instead of taking the screen down; either way the lists are refreshed.
   * Returns whether the write went through.
   */
  attempt(what: string, run: () => void): boolean;
}

/** One wording for every storage failure the user is told about. */
export const storageFailure = (what: string): string => `Could not ${what}: storage is full or unavailable.`;

const LibraryContext = createContext<LibraryValue | null>(null);

export function useLibrary(): LibraryValue {
  const v = useContext(LibraryContext);
  if (!v) throw new Error('useLibrary outside LibraryProvider');
  return v;
}

const localToday = (): ISODate => {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

interface Props {
  children: ReactNode;
  /** Defaults to localStorage, or memory when site data is blocked so the session still works. */
  storage?: Storage;
  today?: ISODate;
}

export function LibraryProvider({ children, storage, today = localToday() }: Props) {
  const todayRef = useRef(today);
  todayRef.current = today;
  // Construction migrates and may write, so it happens once, not on every render.
  const [{ library, created }] = useState(() => {
    const base = createLibrary(storage ?? safeStorage() ?? memoryStorage(), { today: () => todayRef.current });
    const ids = new Set<string>();
    // Wrapped so every caller's new note counts, whichever screen creates it.
    const lib: Library = {
      ...base,
      create(doc) {
        const meta = base.create(doc);
        ids.add(meta.id);
        return meta;
      },
    };
    return { library: lib, created: ids };
  });
  const [metas, setMetas] = useState(() => library.list());
  const refresh = useCallback(() => setMetas(library.list()), [library]);
  const isNewThisSession = useCallback((id: string) => created.has(id), [created]);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const pendingRef = useRef(pendingDelete);
  pendingRef.current = pendingDelete;

  // Background writes (the undo window's own bookkeeping) only warn: an alert on pagehide would be noise.
  const quietly = useCallback(
    (what: string, run: () => void) => {
      try {
        run();
      } catch (e) {
        console.warn(`LiveNotes: could not ${what}`, e);
      }
      refresh();
    },
    [refresh],
  );

  const expireDelete = useCallback(() => {
    if (pendingRef.current === null) return;
    setPendingDelete(null);
    quietly('delete the note', () => library.purgeDeleted());
  }, [library, quietly]);

  const deleteWithUndo = useCallback(
    (id: string) => {
      // Only one undo at a time: a second delete makes the first one final.
      const previous = pendingRef.current;
      setPendingDelete(id);
      quietly('delete the note', () => {
        if (previous !== null && previous !== id) library.purgeDeleted();
        library.softDelete(id);
      });
    },
    [library, quietly],
  );

  const undoDelete = useCallback(() => {
    const id = pendingRef.current;
    if (id === null) return;
    setPendingDelete(null);
    quietly('restore the note', () => library.undoDelete(id));
  }, [library, quietly]);

  const attempt = useCallback(
    (what: string, run: () => void) => {
      let ok = true;
      try {
        run();
      } catch (e) {
        ok = false;
        console.warn(`LiveNotes: could not ${what}`, e);
        alert(storageFailure(what));
      }
      refresh();
      return ok;
    },
    [refresh],
  );

  // Leaving the app ends the undo window (spec §2), so a delete is never left half-done.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && expireDelete();
    window.addEventListener('pagehide', expireDelete);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', expireDelete);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [expireDelete]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== INDEX_KEY) return;
      library.reload();
      refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [library, refresh]);

  const value = useMemo(
    () => ({ metas, library, today, refresh, isNewThisSession, pendingDelete, deleteWithUndo, undoDelete, expireDelete, attempt }),
    [metas, library, today, refresh, isNewThisSession, pendingDelete, deleteWithUndo, undoDelete, expireDelete, attempt],
  );
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
