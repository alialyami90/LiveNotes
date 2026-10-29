import { useCallback, useEffect, useRef, useState } from 'react';
import type { Doc } from '../model/types';
import { parseImport } from '../model/storage';

const SAVE_DELAY_MS = 300;

/**
 * Debounced save of `doc` under `key`, flushed when the page hides and when the
 * provider unmounts (leaving or switching notes must never lose the last 300 ms
 * of typing). Another tab's write to the same key arrives through `onExternal`.
 * Returns whether the last save failed (quota, blocked storage); a failed save stays
 * pending, so the next flush (a later edit, hiding the page, leaving) retries it.
 */
export function usePersistence(
  storage: Storage | null,
  key: string,
  doc: Doc,
  onExternal: (doc: Doc) => void,
  /** `previousRaw` is what the key held before this save, so callers can tell what kind of change it was. */
  onSaved?: (doc: Doc, previousRaw: string | null) => void,
  /** Every flush's outcome, including the one on unmount, which no banner can show. */
  onSaveResult?: (ok: boolean) => void,
): boolean {
  const docRef = useRef(doc);
  docRef.current = doc;
  // Callers pass inline callbacks; refs keep `flush` stable so effects don't re-run each render.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onExternalRef = useRef(onExternal);
  onExternalRef.current = onExternal;
  const onResultRef = useRef(onSaveResult);
  onResultRef.current = onSaveResult;
  const [saveError, setSaveError] = useState(false);
  const failed = useRef(false);
  /** Reports only changes and failures, so a healthy session doesn't re-render on every save. */
  const settle = useCallback((ok: boolean) => {
    if (ok && !failed.current) return;
    failed.current = !ok;
    setSaveError(!ok);
    onResultRef.current?.(ok);
  }, []);

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
    const previous = lastWritten.current ?? null;
    // Edits undone back to what is stored: storage already matches, so a past failure is moot.
    if (json === previous) return settle(true);
    try {
      storage.setItem(key, json);
      lastWritten.current = json;
    } catch (e) {
      console.warn('LiveNotes: could not save', e);
      dirty.current = true;
      return settle(false);
    }
    settle(true);
    onSavedRef.current?.(current, previous);
  }, [storage, key, settle]);

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
      // Their write replaces our unsaved edits, so there is nothing left that failed to save.
      settle(true);
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
  }, [storage, key, flush, settle]);

  return saveError;
}
