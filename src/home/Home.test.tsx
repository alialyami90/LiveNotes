import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Root } from '../app/Root';
import { navigate } from '../app/router';
import { createLibrary, INDEX_KEY, noteKey } from '../library/storage';
import { memoryStorage } from '../library/memoryStorage';
import type { Doc, Place } from '../model/types';
import type { Services } from '../services/types';

const TODAY = '2026-10-28'; // a Wednesday

const services: Services = {
  search: async () => [],
  geocode: async () => null,
  weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
  route: async () => ({ seconds: 3600, meters: 100000 }),
};

function doc(title: string, lines: string[], places: Record<string, Place> = {}): Doc {
  const ids = lines.map((_, i) => `b${i}`);
  const nodes: Doc['nodes'] = { root: { id: 'root', text: '', children: ids } };
  lines.forEach((text, i) => (nodes[ids[i]] = { id: ids[i], text, children: [] }));
  return { version: 1, title, rootId: 'root', nodes, places };
}

const LISBON = doc('Lisbon trip', ['Nov 3 arrive @Lisbon', 'Nov 6 drive to @Porto'], {
  lisbon: { name: 'Lisbon', lat: 38.72, lon: -9.14 },
  porto: { name: 'Porto', lat: 41.15, lon: -8.61 },
});
const DINNER = doc('Dinner with Sam', ['Oct 30 at @Sintra']);
const GROCERIES = doc('Groceries', ['eggs, milk']);
const BOOKS = doc('Book club', ['read chapter 4']);

/** A library without the first-launch sample, seeded in order with ids n1, n2, … and rising updatedAt. */
function seed(docs: Doc[], storage: Storage = memoryStorage()) {
  let id = 0;
  let clock = 1000;
  const lib = createLibrary(storage, { newId: () => (id === 0 ? 'sample' : `n${id}`), now: () => clock, today: () => TODAY });
  id++;
  lib.remove('sample');
  for (const d of docs) {
    clock += 1000;
    lib.create(d);
    id++;
  }
  return storage;
}

function setup(storage: Storage = seed([LISBON, DINNER, GROCERIES, BOOKS])) {
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: (ms) => vi.advanceTimersByTime(ms) } : {});
  render(<Root storage={storage} services={services} today={TODAY} />);
  return { user, storage };
}

const home = () => document.querySelector('main[data-screen="home"]') as HTMLElement;
const cardTitles = () => [...home().querySelectorAll('.note-card__title')].map((h) => h.textContent);
const section = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement;
const openedId = () => /^#\/note\/(.+)$/.exec(location.hash)?.[1];
const indexIds = (storage: Storage) =>
  (JSON.parse(storage.getItem(INDEX_KEY)!).notes as { id: string }[]).map((m) => m.id);

async function act_(user: ReturnType<typeof userEvent.setup>, title: string, action: string) {
  const card = screen.getByRole('heading', { name: title }).closest('.note-card-wrap') as HTMLElement;
  await user.click(within(card).getByRole('button', { name: 'Note actions' }));
  await user.click(within(card).getByRole('menuitem', { name: action }));
}

beforeEach(() => {
  history.replaceState(null, '', '#/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Home timeline', () => {
  it('renders bucket headings only for non-empty buckets', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Next week' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Later' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument();
  });

  it('shows the range and relative days on a timeline card, hung off a date stamp', () => {
    setup();
    const card = screen.getByRole('link', { name: /Lisbon trip/ });
    expect(card).toHaveTextContent('Nov 3–6');
    expect(card).toHaveTextContent('in 6 days');
    const item = card.closest('li.rail__item') as HTMLElement;
    expect(item.parentElement).toHaveClass('rail');
    expect(item.querySelector(':scope > div.stamp + div.rail__cards')).toContainElement(card);
    expect(item.querySelector('.stamp__weekday')).toHaveTextContent('Tue');
    expect(item.querySelector('.stamp__day')).toHaveTextContent('3');
    expect(item.querySelector('.stamp')).not.toHaveClass('is-today');
  });

  it('stamps an ongoing plan with today and a Later plan with its month', () => {
    setup(seed([doc('Festival', ['Oct 26 to Oct 30 @Porto']), doc('Holidays', ['Dec 20 @Faro'])]));
    const ongoing = screen.getByRole('link', { name: /Festival/ }).closest('.rail__item') as HTMLElement;
    expect(section('Today')).toContainElement(ongoing);
    expect(ongoing.querySelector('.stamp')).toHaveClass('is-today');
    expect(ongoing.querySelector('.stamp__weekday')).toHaveTextContent('Wed');
    expect(ongoing.querySelector('.stamp__day')).toHaveTextContent('28');
    const later = screen.getByRole('link', { name: /Holidays/ }).closest('.rail__item') as HTMLElement;
    expect(section('Later')).toContainElement(later);
    expect(later.querySelector('.stamp')).toHaveClass('stamp--month');
    expect(later.querySelector('.stamp__weekday')).toHaveTextContent('Dec');
    expect(later.querySelector('.stamp__day')).toHaveTextContent('20');
  });

  it('groups same-day notes under one stamp', () => {
    setup(seed([doc('Museum', ['Nov 3 @Lisbon']), doc('Dinner', ['Nov 3 late dinner']), doc('Fado', ['Nov 4 fado night'])]));
    const items = section('Next week').querySelectorAll('li.rail__item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelectorAll('.rail__cards .note-card')).toHaveLength(2);
    expect(items[0].querySelectorAll('.stamp')).toHaveLength(1);
    expect(items[1].querySelector('.stamp__day')).toHaveTextContent('4');
  });

  it('orders recent notes by updatedAt, newest first', () => {
    setup();
    const recent = section('Recent');
    const titles = [...recent.querySelectorAll('.note-card__title')].map((h) => h.textContent);
    expect(titles).toEqual(['Book club', 'Groceries']);
  });

  it('hides the Archive link when nothing is archived', () => {
    setup();
    expect(screen.queryByRole('link', { name: /^Archive/ })).toBeNull();
  });
});

describe('Home search', () => {
  it('keeps the no-match live region mounted and empty until it is needed', async () => {
    const { user } = setup();
    const region = home().querySelector('.home-status') as HTMLElement;
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'zzz');
    expect(home().querySelector('.home-status')).toBe(region);
    expect(region).toHaveTextContent('No notes match "zzz"');
  });

  it('filters live to matching notes', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'lisb');
    expect(cardTitles()).toEqual(['Lisbon trip']);
    expect(screen.queryByRole('heading', { name: 'Recent' })).toBeNull();
  });

  it('shows the no-match copy, and Clear restores the sections and focuses the field', async () => {
    const { user } = setup();
    const search = screen.getByRole('searchbox', { name: 'Search notes' });
    await user.type(search, 'zzz');
    expect(screen.getByText('No notes match "zzz"')).toHaveAttribute('role', 'status');
    expect(cardTitles()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument();
    expect(cardTitles()).toHaveLength(4);
  });
});

describe('Home card actions', () => {
  it('pin moves a note into the pinned row', async () => {
    const { user } = setup();
    expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull();
    await act_(user, 'Groceries', 'Pin');
    const pinned = screen.getByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByRole('link', { name: /Groceries/ })).toBeInTheDocument();
    expect(within(section('Recent')).queryByText('Groceries')).toBeNull();
  });

  it('archive hides a note and shows Archive (1); unarchive brings it back', async () => {
    const { user } = setup();
    await act_(user, 'Groceries', 'Archive');
    expect(cardTitles()).not.toContain('Groceries');
    const link = screen.getByRole('link', { name: 'Archive (1)' });
    expect(link).toHaveAttribute('href', '#/archive');

    await user.click(link);
    const archive = await waitFor(() => {
      const el = document.querySelector('main[data-screen="archive"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(archive).getByRole('heading', { level: 1, name: 'Archive' })).toBeInTheDocument();
    await act_(user, 'Groceries', 'Unarchive');
    expect(within(archive).getByText('Nothing archived')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(() => expect(home()).not.toBeNull());
    expect(cardTitles()).toContain('Groceries');
    expect(screen.queryByRole('link', { name: /^Archive/ })).toBeNull();
  });

  it('delete removes the card and shows Note deleted; Undo restores it', async () => {
    const { user, storage } = setup();
    await act_(user, 'Groceries', 'Delete');
    expect(cardTitles()).not.toContain('Groceries');
    expect(screen.getByText('Note deleted')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cardTitles()).toContain('Groceries');
    expect(screen.queryByText('Note deleted')).toBeNull();
    expect(storage.getItem(noteKey('n3'))).not.toBeNull();
  });

  it('purges a deleted note from storage 6 s after the delete', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, storage } = setup();
    await act_(user, 'Groceries', 'Delete');
    expect(storage.getItem(noteKey('n3'))).not.toBeNull();
    act(() => vi.advanceTimersByTime(6000));
    expect(storage.getItem(noteKey('n3'))).toBeNull();
    expect(indexIds(storage)).not.toContain('n3');
    expect(screen.queryByText('Note deleted')).toBeNull();
  });
});

describe('Home focus after delete', () => {
  it('a keyboard Delete leaves Undo focused, and Undo focuses the restored card', async () => {
    const { user } = setup();
    const card = screen.getByRole('heading', { name: 'Groceries' }).closest('.note-card-wrap') as HTMLElement;
    within(card).getByRole('button', { name: 'Note actions' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(card).getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('link', { name: /Groceries/ })).toHaveFocus();
  });

  it('moves focus to the screen heading when the undo window ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await act_(user, 'Groceries', 'Delete');
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole('heading', { level: 1, name: 'LiveNotes' })).toHaveFocus();
  });

  it('leaves focus alone when the window ends while the user is elsewhere', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await act_(user, 'Groceries', 'Delete');
    const search = screen.getByRole('searchbox', { name: 'Search notes' });
    await user.click(search);
    act(() => vi.advanceTimersByTime(6000));
    expect(search).toHaveFocus();
  });

  it('opening another note ends the undo window', async () => {
    const { user, storage } = setup();
    await act_(user, 'Groceries', 'Delete');
    act(() => navigate('#/note/n4'));
    await screen.findByText('read chapter 4');
    expect(storage.getItem(noteKey('n3'))).toBeNull();
    expect(indexIds(storage)).not.toContain('n3');
    act(() => navigate('#/'));
    await waitFor(() => expect(home()).not.toBeNull());
    expect(screen.queryByText('Note deleted')).toBeNull();
  });
});

describe('Home write failures', () => {
  it('alerts when a pin cannot be saved', async () => {
    const { user, storage } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await act_(user, 'Groceries', 'Pin');
    expect(alert).toHaveBeenCalledWith('Could not pin the note: storage is full or unavailable.');
    expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull();
  });
});

describe('Home states', () => {
  it('shows the hint card when the library holds only the sample note', () => {
    setup(memoryStorage());
    expect(screen.getByText('Tap + to start a note. Type @ for places, dates like Nov 3.')).toBeInTheDocument();
  });

  it('counts only active notes for the hint', () => {
    const storage = memoryStorage();
    const lib = createLibrary(storage, { today: () => TODAY });
    lib.setArchived(lib.create(GROCERIES).id, true);
    setup(storage);
    expect(screen.getByText(/Tap \+ to start a note/)).toBeInTheDocument();
  });

  it('hides the hint after a new note is written', async () => {
    const { user } = setup(memoryStorage());
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await waitFor(() => expect(openedId()).toBeTruthy());
    await waitFor(() => expect(home()).toBeNull());
    await user.keyboard('Weekend');
    act(() => navigate('#/'));
    await waitFor(() => expect(home()).not.toBeNull());
    expect(cardTitles()).toContain('Weekend');
    expect(screen.queryByText(/Tap \+ to start a note/)).toBeNull();
  });

  it('puts New note in the header on wide screens, with no floating button', () => {
    const query = (q: string) =>
      ({ matches: q === '(min-width: 640px)', media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: query });
    onTestFinished(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });
    setup();
    const buttons = screen.getAllByRole('button', { name: 'New note' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('header')).not.toBeNull();
    expect(home().querySelector('.fab')).toBeNull();
  });

  it('shows the New note button floating on phones', () => {
    setup();
    const button = screen.getByRole('button', { name: 'New note' });
    expect(button).toHaveClass('fab');
    expect(button.closest('header')).toBeNull();
  });

  it('hides the hint card once there are other notes', () => {
    setup();
    expect(screen.queryByText(/Tap \+ to start a note/)).toBeNull();
  });

  it('shows an empty state with a New note button when there are no notes', () => {
    setup(seed([]));
    expect(screen.getByRole('heading', { name: 'No notes yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New note' })).toHaveLength(1);
  });

  it('has one h1 and section heads at h2', () => {
    setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Next week' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Recent' })).toBeInTheDocument();
  });
});

describe('Home menu', () => {
  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  it('imports a valid file and opens it', async () => {
    const { user, storage } = setup();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Import note' }));
    expect(fileInput()).toHaveAttribute('accept', 'application/json,.json');
    const file = new File([JSON.stringify(doc('Imported plan', ['hello']))], 'n.json', { type: 'application/json' });
    await user.upload(fileInput(), file);
    await waitFor(() => expect(openedId()).toBeTruthy());
    expect(storage.getItem(noteKey(openedId()!))).toContain('Imported plan');
  });

  it('rejects an invalid file with an alert', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { user, storage } = setup();
    const before = storage.getItem(INDEX_KEY);
    const file = new File(['{"nope":true}'], 'bad.json', { type: 'application/json' });
    await user.upload(fileInput(), file);
    await waitFor(() => expect(alert).toHaveBeenCalledWith('That file is not a LiveNotes document.'));
    expect(location.hash).toBe('#/');
    expect(storage.getItem(INDEX_KEY)).toBe(before);
  });

  it('adds the sample note and opens it', async () => {
    const { user, storage } = setup();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add sample note' }));
    await waitFor(() => expect(openedId()).toBeTruthy());
    expect(storage.getItem(noteKey(openedId()!))).toContain('Portugal road trip (sample)');
    expect(indexIds(storage)).toHaveLength(5);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: 'More' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
