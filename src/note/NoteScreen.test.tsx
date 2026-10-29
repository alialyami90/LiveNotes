import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc } from '../model/types';
import type { Services } from '../services/types';
import { memoryStorage } from '../library/memoryStorage';
import { LibraryProvider, useLibrary } from '../library/LibraryProvider';
import { NoteRoute } from '../app/NoteRoute';
import { Root } from '../app/Root';
import { INDEX_KEY, noteKey } from '../library/storage';
import { exportName } from './NoteScreen';
import { navigate, useRoute } from '../app/router';
import { exportDocument } from '../platform/export';

vi.mock('../platform/export', () => ({ exportDocument: vi.fn(async () => {}) }));

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

type Lib = ReturnType<typeof useLibrary>;

/** Home is rebuilt elsewhere, so the tests stand in a bare home and read the library directly. */
function Harness({ storage, onLib }: { storage: Storage; onLib: (l: Lib) => void }) {
  const lib = useLibrary();
  onLib(lib);
  const route = useRoute();
  return route.name === 'note' ? (
    <NoteRoute key={route.id} id={route.id} storage={storage} services={services} onDoc={() => {}} />
  ) : (
    <main data-screen="home">Home</main>
  );
}

function setup() {
  const user = userEvent.setup();
  const storage = memoryStorage();
  let current!: Lib;
  render(
    <LibraryProvider storage={storage} today="2026-10-28">
      <Harness storage={storage} onLib={(l) => (current = l)} />
    </LibraryProvider>,
  );
  /** Opens a note the way Home's New note does, or one with content when `existing` is given. */
  const open = (existing?: Doc) => {
    let id!: string;
    act(() => {
      id = current.library.create(existing).id;
      current.refresh();
      navigate(`#/note/${encodeURIComponent(id)}`);
    });
    return id;
  };
  const meta = (id: string) => current.library.list().find((m) => m.id === id);
  return { user, storage, open, meta, lib: () => current };
}

const title = () => screen.getByRole('textbox', { name: 'Title' });
const menuButton = () => screen.getByRole('button', { name: 'Note menu' });

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(menuButton());
}

beforeEach(() => {
  history.replaceState(null, '', '#/');
  vi.mocked(exportDocument).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NoteScreen', () => {
  it('is the note screen root, with the title above the outline', async () => {
    const { open } = setup();
    open();
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('data-screen', 'note');
    expect(main.contains(title())).toBe(true);
    expect(main.querySelector('.outline')).not.toBeNull();
  });

  it('focuses the title of a new, blank note', async () => {
    const { open } = setup();
    open();
    await waitFor(() => expect(title()).toHaveFocus());
  });

  it('does not steal focus for a note that already has content', async () => {
    const { open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    expect(title()).not.toHaveFocus();
  });

  it('typing a title then Enter focuses the first bullet editor', async () => {
    const { user, open } = setup();
    open();
    await waitFor(() => expect(title()).toHaveFocus());
    await user.keyboard('Weekend{Enter}');
    const editor = document.querySelector('li[data-node-id] textarea');
    expect(editor).not.toBeNull();
    expect(editor).toHaveFocus();
    expect(title()).toHaveValue('Weekend');
  });

  it('back returns home and the library holds the title', async () => {
    const { user, open, meta } = setup();
    const id = open();
    await waitFor(() => expect(title()).toHaveFocus());
    await user.keyboard('Weekend');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(document.querySelector('main[data-screen="home"]')).not.toBeNull());
    expect(location.hash).toBe('#/');
    await waitFor(() => expect(meta(id)?.summary.title).toBe('Weekend'));
  });

  it('has a Back button that reads ←', async () => {
    const { open } = setup();
    open(doc('alpha', 'Trip'));
    expect(await screen.findByRole('button', { name: 'Back' })).toHaveTextContent('←');
  });
});

describe('note menu', () => {
  it('opens with Pin, Archive, Export and Delete as large targets', async () => {
    const { user, open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    await openMenu(user);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((b) => b.textContent)).toEqual(['Pin', 'Archive', 'Export', 'Delete']);
    // jsdom has no layout, so the 44px floor lives in screen.css under this class.
    for (const b of items) expect(b).toHaveClass('note-menu-item');
  });

  it('Pin flips to Unpin and back, and is stored in the library', async () => {
    const { user, open, meta } = setup();
    const id = open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(meta(id)?.pinned).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Unpin' }));
    expect(meta(id)?.pinned).toBeFalsy();
    await openMenu(user);
    expect(screen.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
  });

  it('Archive archives the note, stays on it and shows an Archived pill', async () => {
    const { user, open, meta } = setup();
    const id = open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    expect(screen.queryByText('Archived')).toBeNull();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(meta(id)?.archived).toBe(true);
    expect(location.hash).toBe(`#/note/${id}`);
    expect(screen.getByText('Archived')).toBeInTheDocument();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Unarchive' }));
    expect(meta(id)?.archived).toBeFalsy();
    expect(screen.queryByText('Archived')).toBeNull();
  });

  it('Delete soft-deletes with undo pending and goes back home without growing history', async () => {
    const { user, open, meta, lib } = setup();
    const id = open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    const before = history.length;
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(location.hash).toBe('#/'));
    expect(meta(id)?.deletedAt).toBeDefined();
    expect(lib().pendingDelete).toBe(id);
    // back, not push or replace: no second home for Android's back to step through
    expect(history.length).toBe(before);
    expect(document.querySelector('main[data-screen="home"]')).not.toBeNull();
  });

  it('Export hands the document JSON to the exporter, named after the title', async () => {
    const { user, open } = setup();
    open(doc('alpha', 'Weekend trip!'));
    await screen.findByText('alpha');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(exportDocument).toHaveBeenCalledTimes(1);
    const [json, opts] = vi.mocked(exportDocument).mock.calls[0];
    expect(JSON.parse(json)).toMatchObject({ title: 'Weekend trip!', nodes: { a: { text: 'alpha' } } });
    expect(opts).toEqual({ name: 'weekend-trip.json' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Export falls back to livenotes.json without a usable title', async () => {
    const { user, open } = setup();
    open(doc('alpha', '  ?!  '));
    await screen.findByText('alpha');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(vi.mocked(exportDocument).mock.calls[0][1]).toEqual({ name: 'livenotes.json' });
  });

  it('names the file after the card title when the note has no title of its own', async () => {
    const { user, open } = setup();
    open(doc('Lisbon weekend', undefined));
    await screen.findByText('Lisbon weekend');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(vi.mocked(exportDocument).mock.calls[0][1]).toEqual({ name: 'lisbon-weekend.json' });
  });

  it('never splits a surrogate pair when cutting a long name', () => {
    // Letters outside the BMP take two UTF-16 units each, so a unit-based cut would land mid-pair.
    const stem = exportName('𐐀'.repeat(80)).replace(/\.json$/, '');
    expect(Array.from(stem)).toHaveLength(60);
    expect(stem).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('reports a failed export instead of swallowing it', async () => {
    const { user, open } = setup();
    open(doc('alpha', 'Trip'));
    vi.mocked(exportDocument).mockRejectedValueOnce(new Error('disk full'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await screen.findByText('alpha');
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Export failed: disk full'));
  });

  it('closes on Escape and returns focus to the menu button', async () => {
    const { user, open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    await openMenu(user);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menuButton()).toHaveFocus();
  });

  it('closes when tapping outside it', async () => {
    const { user, open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    await openMenu(user);
    await user.click(screen.getByText('alpha'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when focus moves outside the menu, but not on a null relatedTarget', async () => {
    const { user, open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    await openMenu(user);
    const item = screen.getAllByRole('menuitem')[0];
    fireEvent.blur(item, { relatedTarget: null });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.blur(item, { relatedTarget: title() });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('no longer offers Import or Reset to sample', async () => {
    const { user, open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    await openMenu(user);
    expect(screen.queryByText('Import')).toBeNull();
    expect(screen.queryByText(/Reset to sample/)).toBeNull();
  });
});

describe('legend', () => {
  it('is rendered in the note footer', async () => {
    const { open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    expect(document.querySelector('main[data-screen="note"] footer.legend')).not.toBeNull();
  });
});

describe('deleting', () => {
  it('a brand-new blank note is not soft-deleted, so no dead Undo appears', async () => {
    const { user, open, meta, lib } = setup();
    const id = open();
    await waitFor(() => expect(title()).toHaveFocus());
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(location.hash).toBe('#/'));
    expect(lib().pendingDelete).toBeNull();
    expect(meta(id)?.deletedAt).toBeUndefined();
  });

  it('leaving through Root then discards the blank note entirely', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    render(<Root storage={storage} services={services} today="2026-10-28" />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await waitFor(() => expect(location.hash).toMatch(/^#\/note\//));
    const id = decodeURIComponent(location.hash.slice('#/note/'.length));
    await waitFor(() => expect(title()).toHaveFocus());
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(location.hash).toBe('#/'));
    await waitFor(() => expect(storage.getItem(noteKey(id))).toBeNull());
    expect(storage.getItem(INDEX_KEY)).not.toContain(id);
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
  });

  // The editor's debounced save is flushed on unmount; it must not resurrect or un-delete the note.
  it.each([
    ['a bullet', () => screen.getByText('alpha'), '{End} typed', 'typed'],
    ['the title', () => title(), ' more', 'Trip more'],
  ])('Delete within the save debounce after typing in %s keeps the delete and the text', async (_n, target, keys, expected) => {
    const { user, storage, open, meta, lib } = setup();
    const id = open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    await user.click(target());
    await user.keyboard(keys);
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(location.hash).toBe('#/'));
    expect(meta(id)?.deletedAt).toBeDefined();
    await act(() => new Promise((r) => setTimeout(r, 600)));
    expect(meta(id)?.deletedAt).toBeDefined();
    const saved = meta(id)!.summary;
    expect(`${saved.title} ${saved.preview}`).toContain(expected);
    act(() => lib().expireDelete());
    expect(meta(id)).toBeUndefined();
    expect(storage.getItem(noteKey(id))).toBeNull();
  });
});

describe('phone toolbar', () => {
  afterEach(() => {
    // @ts-expect-error jsdom has no matchMedia, so restoring means removing it
    delete window.matchMedia;
  });

  it('mounts the editing toolbar when a row is focused on a touch screen', async () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q === '(pointer: coarse)',
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { user, open } = setup();
    open(doc('alpha', 'Trip'));
    await screen.findByText('alpha');
    expect(screen.queryByRole('toolbar')).toBeNull();
    await user.click(screen.getByText('alpha'));
    expect(await screen.findByRole('toolbar', { name: 'Edit bullet' })).toBeInTheDocument();
  });
});
