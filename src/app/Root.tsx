import { useEffect, useRef, useState } from 'react';
import type { ISODate } from '../context/resolve';
import { safeStorage } from '../model/storage';
import type { Services } from '../services/types';
import { memoize } from '../services/memo';
import { httpServices } from '../services/http';
import { isBlankDoc } from '../library/blank';
import { LibraryProvider, useLibrary } from '../library/LibraryProvider';
import { memoryStorage } from '../library/memoryStorage';
import { noteKey } from '../library/storage';
import { DocProvider } from '../ui/store';
import { App } from '../ui/App';
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
  useDiscardOnLeave(route);
  if (route.name === 'note') return <NoteRoute key={route.id} id={route.id} storage={storage} services={services} />;
  return <HomePlaceholder archive={route.name === 'archive'} />;
}

/**
 * A brand-new note left empty is deleted, so stray notes don't pile up. This runs
 * on the route change, never on unmount, so StrictMode's simulated unmount can't
 * discard a note that was just opened. The leaving note's provider has already
 * flushed by now (unmount cleanups run before new effects), so storage is current.
 */
function useDiscardOnLeave(route: Route) {
  const { library, refresh, isNewThisSession } = useLibrary();
  const openId = route.name === 'note' ? route.id : null;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const left = prev.current;
    prev.current = openId;
    if (!left || left === openId || !isNewThisSession(left)) return;
    const doc = library.read(left);
    if (!doc || !isBlankDoc(doc)) return;
    try {
      library.remove(left);
    } catch (e) {
      console.warn('LiveNotes: could not discard an empty note', e);
    }
    refresh();
  }, [openId, library, refresh, isNewThisSession]);
}

function NoteRoute({ id, storage, services }: { id: string; storage: Storage; services: Services }) {
  const { library, refresh, today } = useLibrary();
  // Decided once on open: a note deleted elsewhere while open keeps its editor (save re-adds it).
  // Asks the library rather than `metas`, which lags one render behind a note created just now.
  const [doc] = useState(() => (library.list().some((m) => m.id === id && m.deletedAt === undefined) ? library.read(id) : null));
  useEffect(() => {
    if (!doc) navigate('#/');
  }, [doc]);
  if (!doc) return null;
  const onSaved = (d: typeof doc) => {
    try {
      library.save(id, d);
    } catch (e) {
      console.warn('LiveNotes: could not update the note list', e);
    }
    refresh();
  };
  return (
    <DocProvider storageKey={noteKey(id)} storage={storage} initialDoc={doc} services={services} today={today} onSaved={onSaved}>
      <App />
    </DocProvider>
  );
}

/** Stand-in until the timeline home lands. */
function HomePlaceholder({ archive }: { archive: boolean }) {
  const { metas, library, refresh } = useLibrary();
  const shown = metas.filter((m) => m.deletedAt === undefined && !!m.archived === archive);
  const create = () => {
    const { id } = library.create();
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
