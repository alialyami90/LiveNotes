import { describe, expect, it } from 'vitest';
import type { NoteMeta, NoteSummary } from './types';
import { archivedNotes, homeSections, relativeDays } from './sections';

const WED = '2026-10-28';
const SUN = '2026-11-01';

function meta(id: string, o: Partial<NoteMeta> & Partial<NoteSummary> = {}): NoteMeta {
  const { from, to, title, placeNames, searchText, ...rest } = o;
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
    summary: {
      title: title ?? id,
      from,
      to,
      places: [],
      placeNames: placeNames ?? [],
      preview: '',
      searchText: searchText ?? (title ?? id).toLowerCase(),
    },
  };
}

const bucketOf = (m: NoteMeta, today = WED) =>
  homeSections([m], today).upcoming.map((u) => u.bucket);

describe('homeSections buckets', () => {
  it('puts a plan ending on this Sunday in thisWeek', () => {
    expect(bucketOf(meta('a', { from: '2026-11-01', to: '2026-11-02' }))).toEqual(['thisWeek']);
  });
  it('puts a plan starting Monday in nextWeek', () => {
    expect(bucketOf(meta('a', { from: '2026-11-02', to: '2026-11-02' }))).toEqual(['nextWeek']);
  });
  it('puts later plans in later', () => {
    expect(bucketOf(meta('a', { from: '2026-11-10', to: '2026-11-10' }))).toEqual(['later']);
  });
  it('puts an ongoing plan in today', () => {
    expect(bucketOf(meta('a', { from: '2026-10-27', to: '2026-10-30' }))).toEqual(['today']);
  });
  it('puts a plan on today itself in today', () => {
    expect(bucketOf(meta('a', { from: WED, to: WED }))).toEqual(['today']);
  });
  it('treats the next Monday as nextWeek when today is Sunday', () => {
    expect(bucketOf(meta('a', { from: '2026-11-02', to: '2026-11-02' }), SUN)).toEqual(['nextWeek']);
  });
  it('puts the far edge of next week in nextWeek and the day after in later (Wednesday)', () => {
    expect(bucketOf(meta('a', { from: '2026-11-08', to: '2026-11-08' }))).toEqual(['nextWeek']);
    expect(bucketOf(meta('a', { from: '2026-11-09', to: '2026-11-09' }))).toEqual(['later']);
  });
  it('puts the far edge of next week in nextWeek and the day after in later (Sunday)', () => {
    expect(bucketOf(meta('a', { from: '2026-11-08', to: '2026-11-08' }), SUN)).toEqual(['nextWeek']);
    expect(bucketOf(meta('a', { from: '2026-11-09', to: '2026-11-09' }), SUN)).toEqual(['later']);
  });
  it('orders buckets today, thisWeek, nextWeek, later and omits empty ones', () => {
    const s = homeSections(
      [
        meta('later', { from: '2026-12-01', to: '2026-12-01' }),
        meta('today', { from: WED, to: WED }),
        meta('next', { from: '2026-11-03', to: '2026-11-03' }),
      ],
      WED,
    );
    expect(s.upcoming.map((u) => u.bucket)).toEqual(['today', 'nextWeek', 'later']);
  });
  it('sorts notes within a bucket by start date', () => {
    const s = homeSections(
      [
        meta('b', { from: '2026-12-09', to: '2026-12-09' }),
        meta('a', { from: '2026-12-01', to: '2026-12-01' }),
      ],
      WED,
    );
    expect(s.upcoming[0].notes.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('homeSections lists', () => {
  it('sends past plans and undated notes to recent', () => {
    const s = homeSections(
      [meta('past', { from: '2026-10-01', to: '2026-10-02' }), meta('plain')],
      WED,
    );
    expect(s.upcoming).toEqual([]);
    expect(s.recent.map((n) => n.id).sort()).toEqual(['past', 'plain']);
  });

  it('sorts recent by updatedAt descending', () => {
    const s = homeSections(
      [meta('old', { updatedAt: 1 }), meta('new', { updatedAt: 9 }), meta('mid', { updatedAt: 5 })],
      WED,
    );
    expect(s.recent.map((n) => n.id)).toEqual(['new', 'mid', 'old']);
  });

  it('shows pinned notes only in pinned', () => {
    const s = homeSections(
      [meta('p', { pinned: true, from: '2026-11-10', to: '2026-11-10' }), meta('q')],
      WED,
    );
    expect(s.pinned.map((n) => n.id)).toEqual(['p']);
    expect(s.upcoming).toEqual([]);
    expect(s.recent.map((n) => n.id)).toEqual(['q']);
  });

  it('excludes archived and deleted notes, even pinned ones', () => {
    const s = homeSections(
      [
        meta('arch', { archived: true }),
        meta('del', { deletedAt: 5 }),
        meta('archpin', { archived: true, pinned: true }),
        meta('ok'),
      ],
      WED,
    );
    expect(s.pinned).toEqual([]);
    expect(s.recent.map((n) => n.id)).toEqual(['ok']);
  });

  it('counts non-deleted archived notes', () => {
    const s = homeSections(
      [
        meta('a', { archived: true }),
        meta('b', { archived: true }),
        meta('c', { archived: true, deletedAt: 3 }),
        meta('d'),
      ],
      WED,
    );
    expect(s.archivedCount).toBe(2);
  });

  it('has no results without a query', () => {
    expect(homeSections([meta('a')], WED).results).toBeUndefined();
    expect(homeSections([meta('a')], WED, '   ').results).toBeUndefined();
  });

  it('with a query, fills results and empties the other lists', () => {
    const s = homeSections(
      [
        meta('trip', { placeNames: ['Lisbon'], pinned: true, from: '2026-11-10', to: '2026-11-10' }),
        meta('other'),
        meta('gone', { placeNames: ['Lisbon'], deletedAt: 1 }),
      ],
      WED,
      'lisb',
    );
    expect(s.results?.map((n) => n.id)).toEqual(['trip']);
    expect(s.pinned).toEqual([]);
    expect(s.upcoming).toEqual([]);
    expect(s.recent).toEqual([]);
  });

  it('orders results upcoming first (soonest first), then the rest by recency', () => {
    const notes = [
      meta('recent', { title: 'trip recent', updatedAt: 100, from: '2026-10-01', to: '2026-10-02' }),
      meta('undated', { title: 'trip undated', updatedAt: 90 }),
      meta('future', { title: 'trip future', updatedAt: 1, from: '2026-12-01', to: '2026-12-02' }),
      meta('ongoing', { title: 'trip ongoing', updatedAt: 2, from: '2026-10-27', to: '2026-10-30' }),
      meta('pinnedSoon', { title: 'trip pinnedSoon', updatedAt: 3, pinned: true, from: '2026-11-03', to: '2026-11-03' }),
    ];
    expect(homeSections(notes, WED, 'trip').results?.map((n) => n.id)).toEqual([
      'ongoing', 'pinnedSoon', 'future', 'recent', 'undated',
    ]);
  });
  it('matches accent-insensitively against searchText and requires every word', () => {
    const notes = [meta('e', { searchText: 'weekend in evora' }), meta('p', { searchText: 'weekend porto' })];
    expect(homeSections(notes, WED, 'Évora').results?.map((n) => n.id)).toEqual(['e']);
    expect(homeSections(notes, WED, 'weekend evo').results?.map((n) => n.id)).toEqual(['e']);
  });
});

describe('archivedNotes', () => {
  it('lists non-deleted archived notes by updatedAt descending', () => {
    const out = archivedNotes([
      meta('a', { archived: true, updatedAt: 2 }),
      meta('b', { archived: true, updatedAt: 8 }),
      meta('c', { archived: true, deletedAt: 1, updatedAt: 9 }),
      meta('d', { updatedAt: 10 }),
    ]);
    expect(out.map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('relativeDays', () => {
  it('says today', () => expect(relativeDays(WED, WED, WED)).toBe('today'));
  it('says today for a multi-day plan that starts today', () =>
    expect(relativeDays(WED, '2026-10-31', WED)).toBe('today'));
  it('says tomorrow', () => expect(relativeDays('2026-10-29', '2026-10-29', WED)).toBe('tomorrow'));
  it('says in N days', () => expect(relativeDays('2026-11-02', '2026-11-04', WED)).toBe('in 5 days'));
  it('says ends today for an ongoing plan', () =>
    expect(relativeDays('2026-10-27', WED, WED)).toBe('ends today'));
  it('says ends tomorrow', () =>
    expect(relativeDays('2026-10-27', '2026-10-29', WED)).toBe('ends tomorrow'));
  it('says ends in N days', () =>
    expect(relativeDays('2026-10-27', '2026-10-31', WED)).toBe('ends in 3 days'));
  it('crosses month and year boundaries', () =>
    expect(relativeDays('2027-01-02', '2027-01-02', '2026-12-30')).toBe('in 3 days'));
});
