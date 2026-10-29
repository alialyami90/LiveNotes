import { useCallback, useEffect, useRef } from 'react';
import type { Doc } from '../model/types';
import { parseImport } from '../model/storage';

const SAVE_DELAY_MS = 300;

/**
 * Debounced save of `doc` under `key`, flushed when the page hides and when the
 * provider unmounts (leaving or switching notes must never lose the last 300 ms
 * of typing). Another tab's write to the same key arrives through `onExternal`.
 */
export function usePersistence(
  storage: Storage | null,
  key: string,
  doc: Doc,
  onExternal: (doc: Doc) => void,
  onSaved?: (doc: Doc) => void,
): void {
  const docRef = useRef(doc);
  docRef.current = doc;
  // Callers pass inline callbacks; refs keep `flush` stable so effects don't re-run each render.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onExternalRef = useRef(onExternal);
  onExternalRef.current = onExternal;

  // Seeded with what is stored, so merely opening a note neither rewrites it nor bumps its updatedAt.
  const lastWritten = useRef<string | null | undefined>(undefined);
  if (lastWritten.current === undefined) {
    try {
      lastWritten.current = storage?.getItem(key) ?? null;
    } catch {
      lastWritten.current = null;
    }
  }
  const dirty = useRef(false);

  const flush = useCallback(() => {
    if (!storage || !dirty.current) return;
    dirty.current = false;
    const current = docRef.current;
    const json = JSON.stringify(current);
    if (json === lastWritten.current) return;
    try {
      storage.setItem(key, json);
      lastWritten.current = json;
    } catch (e) {
      console.warn('LiveNotes: could not save', e);
      return;
    }
    onSavedRef.current?.(current);
  }, [storage, key]);

  useEffect(() => {
    if (!storage) return;
    dirty.current = true;
    const t = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [doc, storage, flush]);

  // StrictMode's simulated unmount lands here too; that is harmless because an unchanged doc writes nothing.
  useEffect(() => flush, [flush]);

  useEffect(() => {
    if (!storage) return;
    const onHide = () => flush();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue || e.newValue === lastWritten.current) return;
      const next = parseImport(e.newValue);
      if (!next) return;
      lastWritten.current = e.newValue;
      dirty.current = false;
      onExternalRef.current(next);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
    };
  }, [storage, key, flush]);
}
