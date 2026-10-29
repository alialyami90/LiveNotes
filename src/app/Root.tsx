import { useCallback, useEffect, useRef, useState } from 'react';
import type { ISODate } from '../context/resolve';
import type { Doc } from '../model/types';
import { safeStorage } from '../model/storage';
import type { Services } from '../services/types';
import { memoize } from '../services/memo';
import { httpServices } from '../services/http';
import { isBlankDoc } from '../library/blank';
import { LibraryProvider, useLibrary } from '../library/LibraryProvider';
import { memoryStorage } from '../library/memoryStorage';
import { NoteRoute } from './NoteRoute';
import { navigate, useRoute, type Route } from './router';

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
  if (route.name === 'note') {
    return <NoteRoute key={route.id} id={route.id} storage={storage} services={services} onDoc={onDoc} />;
  }
  return <HomePlaceholder archive={route.name === 'archive'} />;
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

/** Stand-in until the timeline home lands. */
function HomePlaceholder({ archive }: { archive: boolean }) {
  const { metas, library, refresh } = useLibrary();
  const shown = metas.filter((m) => m.deletedAt === undefined && !!m.archived === archive);
  const create = () => {
    let id: string;
    try {
      id = library.create().id;
    } catch (e) {
      console.warn('LiveNotes: could not create a note', e);
      alert('Could not create a note: storage is full or unavailable.');
      return;
    }
    refresh();
    navigate(`#/note/${encodeURIComponent(id)}`);
  };
  return (
    <main data-screen="home">
      <ul>
        {shown.map((m) => (
          <li key={m.id}>
            <a href={`#/note/${encodeURIComponent(m.id)}`}>{m.summary.title || 'Untitled'}</a>
          </li>
        ))}
      </ul>
      <button type="button" onClick={create}>
        New note
      </button>
    </main>
  );
}
