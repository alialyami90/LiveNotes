import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc } from '../model/types';
import type { Services } from '../services/types';
import { createLibrary, INDEX_KEY, noteKey } from '../library/storage';
import { memoryStorage } from '../library/memoryStorage';
import { navigate } from './router';
import { Root } from './Root';

const services: Services = {
  search: async () => [],
  geocode: async () => null,
  weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
  route: async () => ({ seconds: 3600, meters: 100000 }),
};

const doc = (text: string, title?: string): Doc => ({
  version: 1,
  ...(title !== undefined ? { title } : {}),
  rootId: 'root',
  nodes: { root: { id: 'root', text: '', children: ['a'] }, a: { id: 'a', text, children: [] } },
  places: {},
});

function setup(storage: Storage = memoryStorage(), strict = false, svc: Services = services) {
  const user = userEvent.setup();
  const tree = <Root storage={storage} services={svc} today="2026-10-28" />;
  const utils = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { user, storage, ...utils };
}

/** The first id goes to the sample note that a first launch creates. */
function seeded(storage: Storage, ids: string[], now?: () => number) {
  const queue = ['sample', ...ids];
  return createLibrary(storage, { newId: () => queue.shift() ?? 'x', now, today: () => '2026-10-28' });
}

const home = () => document.querySelector('main[data-screen="home"]');
const titles = () =>
  [...document.querySelectorAll('main[data-screen="home"] :is(.note-card__title, .pinned-chip__title)')].map(
    (t) => t.textContent,
  );
const noteIdFromHash = () => /^#\/note\/(.+)$/.exec(location.hash)?.[1];

async function createNote(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New note' }));
  await waitFor(() => expect(noteIdFromHash()).toBeTruthy());
  await waitFor(() => expect(home()).toBeNull());
  return noteIdFromHash()!;
}

async function goHome() {
  act(() => navigate('#/'));
  await waitFor(() => expect(home()).not.toBeNull());
}

beforeEach(() => {
  history.replaceState(null, '', '#/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Root', () => {
  it('New note opens #/note/<id>', async () => {
    const { user, storage } = setup();
    const id = await createNote(user);
    expect(storage.getItem(noteKey(id))).not.toBeNull();
    expect(document.querySelector('li[data-node-id]')).not.toBeNull();
  });

  it('leaving a new note straight away discards it', async () => {
    const { user, storage } = setup();
    const before = titles();
    const id = await createNote(user);
    await goHome();
    expect(titles()).toEqual(before);
    expect(storage.getItem(noteKey(id))).toBeNull();
    expect(storage.getItem(INDEX_KEY)).not.toContain(id);
  });

  it('keeps a new note that has a bullet, saving it even when left within the debounce', async () => {
    const { user, container } = setup();
    await createNote(user);
    await user.click(container.querySelector('li[data-node-id] .rich')!);
    await user.keyboard('hello');
    await goHome();
    expect(titles()).toContain('hello');
  });

  it('keeps a new note that only has a title', async () => {
    const { user, storage } = setup();
    const id = await createNote(user);
    // No title field yet (Task 5), so the title arrives the way another tab's edit would.
    const titled = JSON.stringify({ ...JSON.parse(storage.getItem(noteKey(id))!), title: 'Weekend' });
    storage.setItem(noteKey(id), titled);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: noteKey(id), newValue: titled }));
    });
    await goHome();
    expect(storage.getItem(noteKey(id))).toContain('Weekend');
    expect(storage.getItem(INDEX_KEY)).toContain(id);
  });

  it('refreshes the home list when another tab changes the index', async () => {
    const { storage } = setup();
    createLibrary(storage, { today: () => '2026-10-28' }).create(doc('from the other tab'));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: INDEX_KEY, newValue: storage.getItem(INDEX_KEY) }));
    });
    await waitFor(() => expect(titles()).toContain('from the other tab'));
  });

  it('editing note A writes only its own key and the index', async () => {
    const storage = memoryStorage();
    const lib = seeded(storage, ['A', 'B']);
    lib.create(doc('alpha'));
    lib.create(doc('beta'));
    history.replaceState(null, '', '#/note/A');
    const { user } = setup(storage);
    const written: string[] = [];
    const setItem = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      written.push(k);
      setItem(k, v);
    });
    await user.click(await screen.findByText('alpha'));
    await user.keyboard('{End}!');
    await goHome();
    expect(written).toContain(noteKey('A'));
    expect(new Set(written)).toEqual(new Set([noteKey('A'), INDEX_KEY]));
    expect(storage.getItem(noteKey('B'))).toContain('beta');
  });

  it('opening a note without editing it does not touch its updatedAt', async () => {
    const storage = memoryStorage();
    const lib = seeded(storage, ['A'], () => 1000);
    lib.create(doc('alpha'));
    history.replaceState(null, '', '#/note/A');
    setup(storage);
    await screen.findByText('alpha');
    await goHome();
    const meta = JSON.parse(storage.getItem(INDEX_KEY)!).notes.find((m: { id: string }) => m.id === 'A');
    expect(meta.updatedAt).toBe(1000);
  });

  it('a meta with a malformed summary does not crash Home', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    const idx = JSON.parse(storage.getItem(INDEX_KEY)!);
    const meta = idx.notes.find((m: { id: string }) => m.id === 'A');
    delete meta.summary.placeNames;
    delete meta.summary.places;
    storage.setItem(INDEX_KEY, JSON.stringify(idx));
    setup(storage);
    expect(home()).not.toBeNull();
    expect(titles()).toContain('Trip');
  });

  it('an unknown note id goes home', async () => {
    history.replaceState(null, '', '#/note/nope');
    setup();
    await waitFor(() => expect(location.hash).toBe('#/'));
    expect(home()).not.toBeNull();
  });

  it('a soft-deleted note id goes home', async () => {
    const storage = memoryStorage();
    const lib = seeded(storage, ['A']);
    lib.create(doc('alpha'));
    lib.softDelete('A');
    history.replaceState(null, '', '#/note/A');
    setup(storage);
    await waitFor(() => expect(location.hash).toBe('#/'));
  });

  it('going back onto a bad note redirects in place, so back never loops', async () => {
    history.pushState(null, '', '#/note/nope');
    history.pushState(null, '', '#/archive');
    setup();
    const before = history.length;
    const seen: string[] = [];
    const record = () => seen.push(location.hash);
    window.addEventListener('hashchange', record);
    try {
      act(() => history.back());
      await waitFor(() => expect(seen).toEqual(['#/note/nope', '#/']));
      expect(history.length).toBe(before);
      // The bad entry is now home; going back again reaches the first entry, not the bad note.
      const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
      act(() => history.back());
      await act(() => popped);
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(location.hash).toBe('#/');
      expect(seen.filter((h) => h === '#/note/nope')).toHaveLength(1);
      expect(history.length).toBe(before);
    } finally {
      window.removeEventListener('hashchange', record);
    }
  });

  it('a place-cache write refreshes the summary but keeps updatedAt', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A'], () => 1000).create(doc('Visit @Lisbon'));
    history.replaceState(null, '', '#/note/A');
    const geo: Services = {
      ...services,
      geocode: async (name) => (name === 'lisbon' ? { name: 'Lisboa', lat: 38.72, lon: -9.14 } : null),
    };
    setup(storage, false, geo);
    await waitFor(() => expect(storage.getItem(noteKey('A'))).toContain('38.72'));
    await goHome();
    const meta = JSON.parse(storage.getItem(INDEX_KEY)!).notes.find((m: { id: string }) => m.id === 'A');
    expect(meta.updatedAt).toBe(1000);
    expect(meta.summary.places).toHaveLength(1);
    expect(meta.summary.places[0].lat).toBe(38.72);
  });

  it('does not discard a new note whose last save failed', async () => {
    const { user, container, storage } = setup();
    const id = await createNote(user);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Home tells the user once that the note was left unsaved (M7: stubbed, so jsdom stays quiet).
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const setItem = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      if (k === noteKey(id)) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    });
    await user.click(container.querySelector('li[data-node-id] .rich')!);
    await user.keyboard('hello');
    await goHome();
    expect(storage.getItem(INDEX_KEY)).toContain(id);
    expect(storage.getItem(noteKey(id))).not.toBeNull();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Could not save the note: storage is full or unavailable.');
  });

  it('New note reports a failed create instead of crashing', async () => {
    const { user, storage } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(alert).toHaveBeenCalled();
    expect(location.hash).toBe('#/');
    expect(home()).not.toBeNull();
  });
});

describe('Leaving a note whose save failed', () => {
  it('alerts once on Home, after the unmount retry also fails', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    history.replaceState(null, '', '#/note/A');
    const { user } = setup(storage);
    await screen.findByText('alpha');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const setItem = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      if (k === noteKey('A')) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    });
    await user.click(screen.getByText('alpha'));
    await user.keyboard('{End}!');
    await goHome();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Could not save the note: storage is full or unavailable.');
    act(() => navigate('#/archive'));
    await waitFor(() => expect(document.querySelector('main[data-screen="archive"]')).not.toBeNull());
    await goHome();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('stays quiet about a note that was just deleted (Undo shows instead)', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    history.replaceState({ livenotesDepth: 0 }, '', '#/'); // the app's stamped first entry
    const { user } = setup(storage);
    await user.click(screen.getByRole('link', { name: /Trip/ }));
    await screen.findByText('alpha');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const setItem = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      if (k === noteKey('A')) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    });
    await user.click(screen.getByText('alpha'));
    await user.keyboard('{End}!');
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Note menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(home()).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(alert).not.toHaveBeenCalled();
  });

  it('stays quiet when the retry on leaving succeeds', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    history.replaceState(null, '', '#/note/A');
    const { user } = setup(storage);
    await screen.findByText('alpha');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const setItem = storage.setItem.bind(storage);
    let full = true;
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      if (full && k === noteKey('A')) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    });
    await user.click(screen.getByText('alpha'));
    await user.keyboard('{End}!');
    await screen.findByRole('alert');
    full = false;
    await goHome();
    expect(alert).not.toHaveBeenCalled();
    expect(storage.getItem(noteKey('A'))).toContain('alpha!');
    expect(titles()).toContain('Trip');
  });
});

describe('Returning from a note', () => {
  beforeEach(() => history.replaceState({ livenotesDepth: 0 }, '', '#/'));

  it("focuses the note's card on Home", async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    const { user } = setup(storage);
    await user.click(screen.getByRole('link', { name: /Trip/ }));
    await screen.findByText('alpha');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(home()).not.toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: /Trip/ })));
  });

  it('leaves Undo focused after a delete', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    const { user } = setup(storage);
    await user.click(screen.getByRole('link', { name: /Trip/ }));
    await screen.findByText('alpha');
    await user.click(screen.getByRole('button', { name: 'Note menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(home()).not.toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' })));
  });
});

describe('Delete from the note screen', () => {
  // The app stamps its first entry at load; the shared beforeEach wiped that stamp.
  beforeEach(() => history.replaceState({ livenotesDepth: 0 }, '', '#/'));

  async function deleteOpenNote(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Note menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  }

  it('goes back to Home without growing history, and shows Undo there', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    const { user } = setup(storage);
    await user.click(screen.getByRole('link', { name: /Trip/ }));
    await screen.findByText('alpha');
    const atNote = history.length;
    await deleteOpenNote(user);
    await waitFor(() => expect(home()).not.toBeNull());
    expect(location.hash).toBe('#/');
    expect(history.length).toBe(atNote);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(titles()).not.toContain('Trip');
    // Back on the first in-app entry, not a second home stacked on it: one more back leaves the app.
    expect((history.state as { livenotesDepth?: number }).livenotesDepth).toBe(0);
  });

  it('opened from Archive, lands back on Archive with Undo', async () => {
    const storage = memoryStorage();
    const lib = seeded(storage, ['A']);
    lib.create(doc('alpha', 'Old trip'));
    lib.setArchived('A', true);
    const { user } = setup(storage);
    await user.click(screen.getByRole('link', { name: /Archive/ }));
    await waitFor(() => expect(document.querySelector('main[data-screen="archive"]')).not.toBeNull());
    await user.click(screen.getByRole('link', { name: /Old trip/ }));
    await screen.findByText('alpha');
    const atNote = history.length;
    await deleteOpenNote(user);
    await waitFor(() => expect(document.querySelector('main[data-screen="archive"]')).not.toBeNull());
    expect(location.hash).toBe('#/archive');
    expect(history.length).toBe(atNote);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('a confirmed permanent delete (storage full) is not undone by the leaving flush', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    const { user } = setup(storage);
    await user.click(screen.getByRole('link', { name: /Trip/ }));
    await screen.findByText('alpha');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const setItem = storage.setItem.bind(storage);
    // Full: the index may only shrink. The note key itself still has room.
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      if (k === INDEX_KEY && String(v).length > (storage.getItem(k)?.length ?? 0)) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    });
    await user.click(screen.getByText('alpha'));
    await user.keyboard('{End}!');
    await deleteOpenNote(user);
    await waitFor(() => expect(home()).not.toBeNull());
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(storage.getItem(noteKey('A'))).toBeNull();
    expect(storage.getItem(INDEX_KEY)).not.toContain('"A"');
    expect(titles()).not.toContain('Trip');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it('going Forward onto the deleted note redirects in place', async () => {
    const storage = memoryStorage();
    seeded(storage, ['A']).create(doc('alpha', 'Trip'));
    const { user } = setup(storage);
    await user.click(screen.getByRole('link', { name: /Trip/ }));
    await screen.findByText('alpha');
    const atNote = history.length;
    await deleteOpenNote(user);
    await waitFor(() => expect(home()).not.toBeNull());
    const seen: string[] = [];
    const record = () => seen.push(location.hash);
    window.addEventListener('hashchange', record);
    try {
      act(() => history.forward());
      await waitFor(() => expect(seen).toEqual(['#/note/A', '#/']));
      expect(history.length).toBe(atNote);
      expect(home()).not.toBeNull();
    } finally {
      window.removeEventListener('hashchange', record);
    }
  });
});

describe('Root in StrictMode', () => {
  it('does not discard or lose a new note during the simulated unmount', async () => {
    const { user, container, storage } = setup(memoryStorage(), true);
    const id = await createNote(user);
    expect(storage.getItem(noteKey(id))).not.toBeNull();
    expect(storage.getItem(INDEX_KEY)).toContain(id);
    await user.click(container.querySelector('li[data-node-id] .rich')!);
    await user.keyboard('strict');
    await goHome();
    expect(titles()).toContain('strict');
  });

  it('still discards an untouched new note on leave', async () => {
    const { user, storage } = setup(memoryStorage(), true);
    const id = await createNote(user);
    await goHome();
    expect(storage.getItem(noteKey(id))).toBeNull();
  });
});
