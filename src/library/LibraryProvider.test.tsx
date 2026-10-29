import { afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { LibraryProvider, useLibrary } from './LibraryProvider';
import { memoryStorage } from './memoryStorage';
import { createLibrary, INDEX_KEY, noteKey } from './storage';

afterEach(() => vi.restoreAllMocks());

type Lib = ReturnType<typeof useLibrary>;

function setup(storage: Storage = memoryStorage()) {
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

/** Every index write fails unless it shrinks the index, as when storage is full. */
function fullStorage() {
  const storage = memoryStorage();
  const setItem = storage.setItem.bind(storage);
  const state = { full: false };
  vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
    const before = storage.getItem(k)?.length ?? 0;
    if (state.full && String(v).length > before) throw new DOMException('full', 'QuotaExceededError');
    setItem(k, v);
  });
  return { storage, state };
}

describe('LibraryProvider delete when storage is full', () => {
  it('a soft-delete that cannot be written shows no undo bar, and declining leaves the note', () => {
    const { storage, state } = fullStorage();
    const { a, lib, visible } = setup(storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    state.full = true;
    act(() => lib().deleteWithUndo(a));
    expect(confirm).toHaveBeenCalledWith('Storage is full. Delete this note permanently now?');
    expect(lib().pendingDelete).toBeNull();
    expect(visible()).toContain(a);
    expect(storage.getItem(noteKey(a))).not.toBeNull();
  });

  it('confirming removes the note for good, which shrinks the index', () => {
    const { storage, state } = fullStorage();
    const { a, b, lib } = setup(storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    state.full = true;
    act(() => lib().deleteWithUndo(a));
    expect(lib().pendingDelete).toBeNull();
    expect(lib().metas.map((m) => m.id)).not.toContain(a);
    expect(lib().metas.map((m) => m.id)).toContain(b);
    expect(storage.getItem(noteKey(a))).toBeNull();
    expect(storage.getItem(INDEX_KEY)).not.toContain(a);
    expect(alert).not.toHaveBeenCalled();
  });

  it('alerts when even the permanent delete fails', () => {
    const storage = memoryStorage();
    const { a, lib, visible } = setup(storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    act(() => lib().deleteWithUndo(a));
    expect(alert).toHaveBeenCalledWith('Could not delete the note: storage is full or unavailable.');
    expect(visible()).toContain(a);
    expect(lib().pendingDelete).toBeNull();
  });
});

describe('LibraryProvider purges only its own delete', () => {
  it("expiring one tab's delete leaves another tab's pending delete undoable", () => {
    const { storage, a, b, lib } = setup();
    // The other tab: its own library on the same storage, with its own delete in its undo window.
    const other = createLibrary(storage);
    other.softDelete(b);
    act(() => lib().deleteWithUndo(a));
    act(() => lib().expireDelete());
    expect(storage.getItem(noteKey(a))).toBeNull();
    expect(storage.getItem(noteKey(b))).not.toBeNull();
    other.undoDelete(b);
    expect(other.list().find((m) => m.id === b)?.deletedAt).toBeUndefined();
    expect(other.read(b)).not.toBeNull();
  });

  it("a second delete purges only the first, not another tab's", () => {
    const storage = memoryStorage();
    const seed = createLibrary(storage);
    const c = seed.create().id;
    const { a, b, lib } = setup(storage);
    const other = createLibrary(storage);
    other.softDelete(c);
    act(() => lib().deleteWithUndo(a));
    act(() => lib().deleteWithUndo(b));
    expect(storage.getItem(noteKey(a))).toBeNull();
    expect(storage.getItem(noteKey(c))).not.toBeNull();
    other.undoDelete(c);
    expect(other.read(c)).not.toBeNull();
  });
});
