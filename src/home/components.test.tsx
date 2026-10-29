import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteMeta } from '../library/types';
import { CardMenu } from './CardMenu';
import { editedAgo, formatRange } from './format';
import { NoteCard } from './NoteCard';
import { PinnedRow } from './PinnedRow';
import { RouteSketch } from './RouteSketch';
import { UndoBar } from './UndoBar';

const TODAY = '2026-10-28';

function meta(over: Partial<NoteMeta> = {}, summary: Partial<NoteMeta['summary']> = {}): NoteMeta {
  return {
    id: 'n1',
    createdAt: 0,
    updatedAt: 0,
    summary: {
      title: 'Lisbon trip',
      from: '2026-11-03',
      to: '2026-11-06',
      places: [
        { name: 'Lisbon', lat: 38.72, lon: -9.14 },
        { name: 'Porto', lat: 41.15, lon: -8.61 },
      ],
      placeNames: ['Lisbon', 'Porto', 'Faro', 'Évora'],
      preview: 'Pack light',
      searchText: 'lisbon trip',
      ...summary,
    },
    ...over,
  };
}

describe('formatRange', () => {
  it('collapses a range within one month', () => {
    expect(formatRange('2026-11-03', '2026-11-06', TODAY)).toBe('Nov 3–6');
  });
  it('spells out both months across a month boundary', () => {
    expect(formatRange('2026-10-30', '2026-11-02', TODAY)).toBe('Oct 30 – Nov 2');
  });
  it('shows a single day once', () => {
    expect(formatRange('2026-11-03', '2026-11-03', TODAY)).toBe('Nov 3');
    expect(formatRange('2026-11-03', undefined, TODAY)).toBe('Nov 3');
  });
  it('is empty without a start', () => {
    expect(formatRange(undefined, undefined, TODAY)).toBe('');
  });
  it('adds the year only when it differs from today', () => {
    expect(formatRange('2027-01-02', '2027-01-05', TODAY)).toBe('Jan 2–5, 2027');
    expect(formatRange('2026-12-30', '2027-01-02', TODAY)).toBe('Dec 30, 2026 – Jan 2, 2027');
    expect(formatRange('2027-02-03', '2027-02-03', TODAY)).toBe('Feb 3, 2027');
  });
});

describe('editedAgo', () => {
  const now = new Date(2026, 9, 28, 12, 0, 0).getTime();
  const ago = (ms: number) => editedAgo(now - ms, now);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  it('covers the recent ranges', () => {
    expect(ago(20_000)).toBe('edited just now');
    expect(ago(5 * MIN)).toBe('edited 5m ago');
    expect(ago(2 * HOUR)).toBe('edited 2h ago');
    expect(ago(30 * HOUR)).toBe('edited yesterday');
    expect(ago(3 * DAY)).toBe('edited 3 days ago');
  });
  it('falls back to a date beyond 7 days', () => {
    expect(editedAgo(new Date(2026, 9, 12, 9).getTime(), now)).toBe('edited Oct 12');
  });
  it('adds the year for another year', () => {
    expect(editedAgo(new Date(2025, 9, 12, 9).getTime(), now)).toBe('edited Oct 12, 2025');
  });
});

describe('RouteSketch', () => {
  it('lists the places in its label', () => {
    render(
      <RouteSketch
        places={[
          { lat: 38.7, lon: -9.1, name: 'Lisbon' },
          { lat: 41.1, lon: -8.6, name: 'Porto' },
          { lat: 37, lon: -8, name: 'Faro' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Route: Lisbon → Porto → Faro' })).toBeInTheDocument();
  });
  it('draws a dashed line, a filled start and a ringed end', () => {
    const { container } = render(
      <RouteSketch
        places={[
          { lat: 38.7, lon: -9.1, name: 'A' },
          { lat: 41.1, lon: -8.6, name: 'B' },
        ]}
      />,
    );
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(container.querySelector('.route-sketch__start')).not.toBeNull();
    expect(container.querySelector('.route-sketch__end')).not.toBeNull();
  });
  it('draws one place as a dot with a halo', () => {
    const { container } = render(<RouteSketch places={[{ lat: 38.7, lon: -9.1, name: 'Lisbon' }]} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelector('.route-sketch__halo')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Route: Lisbon' })).toBeInTheDocument();
  });
  it('renders nothing without places', () => {
    const { container } = render(<RouteSketch places={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('NoteCard', () => {
  it('links to the note and shows the timeline details', () => {
    render(<NoteCard meta={meta()} variant="timeline" today={TODAY} />);
    const link = screen.getByRole('link', { name: /Lisbon trip/ });
    expect(link).toHaveAttribute('href', '#/note/n1');
    expect(link).toHaveTextContent('Nov 3–6');
    expect(link).toHaveTextContent('in 6 days');
    expect(link).toHaveTextContent('Lisbon');
    expect(link).toHaveTextContent('Porto');
    expect(link).toHaveTextContent('Faro');
    expect(link).not.toHaveTextContent('Évora'); // only three place names
    expect(screen.getByRole('img', { name: 'Route: Lisbon → Porto' })).toBeInTheDocument();
  });
  it('shows Untitled for an empty title', () => {
    render(<NoteCard meta={meta({}, { title: '' })} variant="recent" today={TODAY} now={1000} />);
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });
  it('renders the preview and no svg for a note without places', () => {
    const { container } = render(
      <NoteCard
        meta={meta({}, { places: [], placeNames: [], from: undefined, to: undefined })}
        variant="recent"
        today={TODAY}
        now={1000}
      />,
    );
    expect(screen.getByText('Pack light')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('edited just now')).toBeInTheDocument();
  });
  it('shows the sketch instead of the preview in the recent variant when it has places', () => {
    render(<NoteCard meta={meta()} variant="recent" today={TODAY} now={1000} />);
    expect(screen.getByRole('img', { name: /Route:/ })).toBeInTheDocument();
    expect(screen.queryByText('Pack light')).toBeNull();
  });
  it('shows a past plan quietly, with no relative badge', () => {
    render(
      <NoteCard meta={meta({}, { from: '2026-09-03', to: '2026-09-06' })} variant="recent" today={TODAY} now={1000} />,
    );
    expect(screen.getByText('Sep 3–6')).toBeInTheDocument();
    expect(screen.queryByText(/in \d+ days|ago/)).toBeNull();
  });
  it('renders the menu beside the link, not inside it', () => {
    render(<NoteCard meta={meta()} variant="timeline" today={TODAY} menu={<button>Menu</button>} />);
    const link = screen.getByRole('link', { name: /Lisbon trip/ });
    expect(link).not.toContainElement(screen.getByRole('button', { name: 'Menu' }));
  });
});

describe('CardMenu', () => {
  function setup(m: NoteMeta = meta()) {
    const onPin = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(<CardMenu meta={m} onPin={onPin} onArchive={onArchive} onDelete={onDelete} />);
    return { onPin, onArchive, onDelete, trigger: screen.getByRole('button', { name: 'Note actions' }) };
  }

  it('is a closed menu button until opened', async () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Pin', 'Archive', 'Delete']);
  });

  it('flips its labels with the note state', async () => {
    const { trigger } = setup(meta({ pinned: true, archived: true }));
    await userEvent.click(trigger);
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Unpin', 'Unarchive', 'Delete']);
  });

  it('fires callbacks with the new state and closes after choosing', async () => {
    const { trigger, onPin, onArchive, onDelete } = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(onPin).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledWith(true);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('sends the opposite state when already pinned and archived', async () => {
    const { trigger, onPin, onArchive } = setup(meta({ pinned: true, archived: true }));
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
    expect(onPin).toHaveBeenCalledWith(false);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unarchive' }));
    expect(onArchive).toHaveBeenCalledWith(false);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside pointerdown', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not let clicks reach an enclosing link', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <a href="#/x" onClick={onClick}>
        <CardMenu meta={meta()} onPin={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} />
      </a>,
    );
    const trigger = container.querySelector('button')!;
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('PinnedRow', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<PinnedRow metas={[]} today={TODAY} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('lists chip links with an optional date', () => {
    const plain = meta({ id: 'n2' }, { title: 'Ideas', from: undefined, to: undefined });
    render(<PinnedRow metas={[meta(), plain]} today={TODAY} />);
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    const trip = screen.getByRole('link', { name: /Lisbon trip/ });
    expect(trip).toHaveAttribute('href', '#/note/n1');
    expect(trip).toHaveTextContent('Nov 3–6');
    expect(screen.getByRole('link', { name: 'Ideas' })).toHaveAttribute('href', '#/note/n2');
  });
});

describe('UndoBar', () => {
  afterEach(() => vi.useRealTimers());

  it('announces the delete and expires once after 6000 ms', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<UndoBar onUndo={vi.fn()} onExpire={onExpire} />);
    expect(screen.getByRole('status')).toHaveTextContent('Note deleted');
    act(() => void vi.advanceTimersByTime(5999));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('Undo cancels the expiry', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    const onExpire = vi.fn();
    render(<UndoBar onUndo={onUndo} onExpire={onExpire} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('clears the timer on unmount and survives a rerender', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { unmount, rerender } = render(<UndoBar onUndo={vi.fn()} onExpire={onExpire} ms={100} />);
    rerender(<UndoBar onUndo={vi.fn()} onExpire={onExpire} ms={100} />);
    act(() => void vi.advanceTimersByTime(99));
    unmount();
    act(() => void vi.advanceTimersByTime(1000));
    expect(onExpire).not.toHaveBeenCalled();
  });
});
