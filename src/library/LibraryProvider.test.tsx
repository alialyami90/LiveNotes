import { act, render } from '@testing-library/react';
import { LibraryProvider, useLibrary } from './LibraryProvider';
import { memoryStorage } from './memoryStorage';
import { createLibrary, noteKey } from './storage';

type Lib = ReturnType<typeof useLibrary>;

function setup() {
  const storage = memoryStorage();
  const seed = createLibrary(storage);
  const a = seed.create().id;
  const b = seed.create().id;
  const box: { lib?: Lib } = {};
  const Probe = () => {
    box.lib = useLibrary();
    return null;
  };
  render(
    <LibraryProvider storage={storage} today="2026-10-28">
      <Probe />
    </LibraryProvider>,
  );
  const lib = () => box.lib!;
  const visible = () => lib().metas.filter((m) => m.deletedAt === undefined).map((m) => m.id);
  return { storage, a, b, lib, visible };
}

describe('LibraryProvider undo delete', () => {
  it('deleteWithUndo hides the note and undoDelete brings it back intact', () => {
    const { storage, a, lib, visible } = setup();
    const before = storage.getItem(noteKey(a));
    act(() => lib().deleteWithUndo(a));
    expect(lib().pendingDelete).toBe(a);
    expect(visible()).not.toContain(a);
    act(() => lib().undoDelete());
    expect(lib().pendingDelete).toBeNull();
    expect(visible()).toContain(a);
    expect(storage.getItem(noteKey(a))).toBe(before);
  });

  it('expireDelete makes the delete final', () => {
    const { storage, a, lib } = setup();
    act(() => lib().deleteWithUndo(a));
    act(() => lib().expireDelete());
    expect(lib().pendingDelete).toBeNull();
    expect(lib().metas.map((m) => m.id)).not.toContain(a);
    expect(storage.getItem(noteKey(a))).toBeNull();
  });

  it('a second delete makes the first one final and keeps only the second undoable', () => {
    const { storage, a, b, lib, visible } = setup();
    act(() => lib().deleteWithUndo(a));
    act(() => lib().deleteWithUndo(b));
    expect(storage.getItem(noteKey(a))).toBeNull();
    expect(lib().pendingDelete).toBe(b);
    act(() => lib().undoDelete());
    expect(visible()).toContain(b);
  });

  it('hiding the app ends the undo window', () => {
    const { storage, a, lib } = setup();
    act(() => lib().deleteWithUndo(a));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(lib().pendingDelete).toBeNull();
    expect(storage.getItem(noteKey(a))).toBeNull();
  });
});
