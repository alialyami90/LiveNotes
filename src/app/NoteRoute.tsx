import { useEffect, useState } from 'react';
import type { Doc } from '../model/types';
import { parseImport } from '../model/storage';
import type { Services } from '../services/types';
import { useLibrary } from '../library/LibraryProvider';
import { isBlankDoc } from '../library/blank';
import { noteKey } from '../library/storage';
import { DocProvider, useStore } from '../ui/store';
import { NoteScreen } from '../note/NoteScreen';
import { navigate } from './router';

/** Everything but the place cache: geocode results are not edits, so they must not reorder Recent. */
const userContent = (d: Doc): string => JSON.stringify({ ...d, places: {} });

/** Reports the provider's in-memory doc, which stays right even when a save to storage fails. */
function TrackDoc({ onDoc }: { onDoc: (doc: Doc) => void }) {
  const { doc } = useStore();
  useEffect(() => onDoc(doc), [doc, onDoc]);
  return null;
}

interface Props {
  id: string;
  storage: Storage;
  services: Services;
  onDoc: (id: string, doc: Doc) => void;
}

export function NoteRoute({ id, storage, services, onDoc }: Props) {
  const { library, refresh, today, isNewThisSession, reportSave, wasRemoved } = useLibrary();
  // Decided once on open: a note deleted elsewhere while open keeps its editor (save re-adds it).
  // Asks the library rather than `metas`, which lags one render behind a note created just now.
  const [doc] = useState(() =>
    library.list().some((m) => m.id === id && m.deletedAt === undefined) ? library.read(id) : null,
  );
  // Decided once on open, like the doc: typing the first title must not make the field refocus.
  const [isNew] = useState(() => isNewThisSession(id) && !!doc && isBlankDoc(doc));
  // Replace, not push: a bad entry left behind would make back land on it and redirect forever.
  useEffect(() => {
    if (!doc) navigate('#/', { replace: true });
  }, [doc]);
  const [track] = useState(() => (d: Doc) => onDoc(id, d));
  const [onSaveResult] = useState(() => (ok: boolean) => reportSave(id, ok));
  if (!doc) return null;

  /** The doc itself is already written; only the meta is updated, and updatedAt only for real edits. */
  const onSaved = (d: Doc, previousRaw: string | null) => {
    // save() would re-add the meta (right for another tab's purge), undoing a confirmed delete.
    if (wasRemoved(id)) {
      try {
        storage.removeItem(noteKey(id));
      } catch {
        // best effort: a stray key is invisible without a meta
      }
      return;
    }
    const previous = previousRaw === null ? null : parseImport(previousRaw);
    const touch = !previous || userContent(previous) !== userContent(d);
    try {
      library.save(id, d, { touch, writeDoc: false });
    } catch (e) {
      console.warn('LiveNotes: could not update the note list', e);
    }
    refresh();
  };
  return (
    <DocProvider storageKey={noteKey(id)} storage={storage} initialDoc={doc} services={services} today={today} onSaved={onSaved} onSaveResult={onSaveResult}>
      <TrackDoc onDoc={track} />
      <NoteScreen id={id} isNew={isNew} />
    </DocProvider>
  );
}
