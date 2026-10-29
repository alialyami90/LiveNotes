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
