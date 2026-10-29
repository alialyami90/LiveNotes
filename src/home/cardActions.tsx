import { useCallback, type ReactNode } from 'react';
import { useLibrary } from '../library/LibraryProvider';
import type { NoteMeta } from '../library/types';
import { CardMenu } from './CardMenu';

/** The ⋯ menu for any card on Home or Archive, wired to the library. */
export function useCardMenu(): (meta: NoteMeta) => ReactNode {
  const { library, refresh, deleteWithUndo } = useLibrary();
  // A failed write (quota, blocked storage) must not take the screen down; the card just stays as it was.
  const run = useCallback(
    (what: string, fn: () => void) => {
      try {
        fn();
      } catch (e) {
        console.warn(`LiveNotes: could not ${what}`, e);
      }
      refresh();
    },
    [refresh],
  );
  return useCallback(
    (meta: NoteMeta) => (
      <CardMenu
        meta={meta}
        onPin={(on) => run(on ? 'pin the note' : 'unpin the note', () => library.setPinned(meta.id, on))}
        onArchive={(on) => run(on ? 'archive the note' : 'unarchive the note', () => library.setArchived(meta.id, on))}
        onDelete={() => deleteWithUndo(meta.id)}
      />
    ),
    [library, run, deleteWithUndo],
  );
}
