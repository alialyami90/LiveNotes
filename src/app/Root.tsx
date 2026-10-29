import { useCallback, useEffect, useRef, useState } from 'react';
import type { ISODate } from '../context/resolve';
import type { Doc } from '../model/types';
import { safeStorage } from '../model/storage';
import type { Services } from '../services/types';
import { memoize } from '../services/memo';
import { httpServices } from '../services/http';
import { isBlankDoc } from '../library/blank';
import { LibraryProvider, storageFailure, useLibrary } from '../library/LibraryProvider';
import { memoryStorage } from '../library/memoryStorage';
import { Archive } from '../home/Archive';
import { Home } from '../home/Home';
import { PendingUndo } from '../home/PendingUndo';
import { NoteRoute } from './NoteRoute';
import { useRoute, type Route } from './router';

interface Props {
  storage?: Storage;
  services?: Services;
  today?: ISODate;
}

export function Root({ storage, services, today }: Props) {
  // One store and one Services for the whole session, so the memo cache and
  // Photon's request queue survive switching notes.
  const [store] = useState(() => storage ?? safeStorage() ?? memoryStorage());
  const [shared] = useState(() => services ?? memoize(httpServices()));
  return (
    <LibraryProvider storage={store} today={today}>
      <Screens storage={store} services={shared} />
    </LibraryProvider>
  );
}

function Screens({ storage, services }: { storage: Storage; services: Services }) {
  const route = useRoute();
  // The open note's in-memory doc, so discarding never trusts a save that failed.
  const lastDocs = useRef(new Map<string, Doc>());
  const onDoc = useCallback((id: string, doc: Doc) => void lastDocs.current.set(id, doc), []);
  useDiscardOnLeave(route, lastDocs.current);
  useExpireUndoOnOpen(route);
  useAlertUnsavedOnLeave(route);
  useFocusCardOnReturn(route);
  if (route.name === 'note') {
    return <NoteRoute key={route.id} id={route.id} storage={storage} services={services} onDoc={onDoc} />;
  }
  return (
    <>
      {route.name === 'archive' ? <Archive /> : <Home />}
      <PendingUndo />
    </>
  );
}

/**
 * Back from a note would leave focus on <body> (the Back button went with the screen), so a
 * keyboard or screen-reader user lands on the card they opened. Anything that already took
 * focus (the Undo bar after a delete) keeps it.
 */
function useFocusCardOnReturn(route: Route) {
  const openId = route.name === 'note' ? route.id : null;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const left = prev.current;
    prev.current = openId;
    if (!left || openId !== null) return;
    const at = document.activeElement;
    if (at && at !== document.body) return;
    const href = `#/note/${left}`.replace(/["\\]/g, '\\$&');
    document.querySelector<HTMLElement>(`main[data-screen] a[href="${href}"]`)?.focus();
  }, [openId]);
}

/**
 * The note screen's banner goes with it, so a note left while its save was failing (the
 * unmount retry failed too) is reported once here instead of vanishing without a word.
 */
function useAlertUnsavedOnLeave(route: Route) {
  const { takeUnsaved } = useLibrary();
  const onNote = route.name === 'note';
  useEffect(() => {
    if (!onNote && takeUnsaved()) alert(storageFailure('save the note'));
  }, [onNote, takeUnsaved]);
}

/**
 * Opening another note ends the undo window, so the bar never resurfaces on home long after
 * the delete (UndoBar's timer stops while the note screen is up).
 */
function useExpireUndoOnOpen(route: Route) {
  const { pendingDelete, expireDelete } = useLibrary();
  const openId = route.name === 'note' ? route.id : null;
  useEffect(() => {
    if (openId !== null && pendingDelete !== null && openId !== pendingDelete) expireDelete();
  }, [openId, pendingDelete, expireDelete]);
}

/**
 * A brand-new note left empty is deleted, so stray notes don't pile up. This runs
 * on the route change, never on unmount, so StrictMode's simulated unmount can't
 * discard a note that was just opened. Blankness is judged on the editor's last
 * doc, not storage: after a failed save (quota) storage still holds the empty note.
 */
function useDiscardOnLeave(route: Route, lastDocs: Map<string, Doc>) {
  const { library, refresh, isNewThisSession } = useLibrary();
  const openId = route.name === 'note' ? route.id : null;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const left = prev.current;
    prev.current = openId;
    if (!left || left === openId) return;
    const doc = lastDocs.get(left) ?? library.read(left);
    lastDocs.delete(left);
    if (!isNewThisSession(left) || !doc || !isBlankDoc(doc)) return;
    try {
      library.remove(left);
    } catch (e) {
      console.warn('LiveNotes: could not discard an empty note', e);
    }
    refresh();
  }, [openId, lastDocs, library, refresh, isNewThisSession]);
}
