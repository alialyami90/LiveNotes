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
}

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
    () => ({ metas, library, today, refresh, isNewThisSession }),
    [metas, library, today, refresh, isNewThisSession],
  );
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
