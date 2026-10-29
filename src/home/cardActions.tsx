import { useCallback, type ReactNode } from 'react';
import { useLibrary } from '../library/LibraryProvider';
import type { NoteMeta } from '../library/types';
import { CardMenu } from './CardMenu';

/** The ⋯ menu for any card on Home or Archive, wired to the library. */
export function useCardMenu(): (meta: NoteMeta) => ReactNode {
  const { library, attempt, deleteWithUndo } = useLibrary();
  return useCallback(
    (meta: NoteMeta) => (
      <CardMenu
        meta={meta}
        onPin={(on) => attempt(on ? 'pin the note' : 'unpin the note', () => library.setPinned(meta.id, on))}
        onArchive={(on) => attempt(on ? 'archive the note' : 'unarchive the note', () => library.setArchived(meta.id, on))}
        onDelete={() => deleteWithUndo(meta.id)}
      />
    ),
    [library, attempt, deleteWithUndo],
  );
}
