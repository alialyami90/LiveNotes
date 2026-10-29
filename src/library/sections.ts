import type { ISODate } from '../context/resolve';
import { foldText } from './text';
import type { NoteMeta } from './types';

export type Bucket = 'today' | 'thisWeek' | 'nextWeek' | 'later';

export interface HomeSections {
  pinned: NoteMeta[];
  upcoming: { bucket: Bucket; notes: NoteMeta[] }[];
  recent: NoteMeta[];
  archivedCount: number;
  /** Set only for a non-empty query; the other lists are then empty. */
  results?: NoteMeta[];
}

const BUCKETS: Bucket[] = ['today', 'thisWeek', 'nextWeek', 'later'];

const dayNumber = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
// Day 0 (1970-01-01) was a Thursday, so +3 puts Monday at 0 and Sunday at 6.
const sundayOnOrAfter = (n: number) => n + (6 - ((n + 3) % 7));

const live = (m: NoteMeta) => !m.deletedAt;
const byUpdated = (a: NoteMeta, b: NoteMeta) => b.updatedAt - a.updatedAt;

/** A note is upcoming while its last date is still ahead; `null` means it belongs in recent. */
function bucketFor(m: NoteMeta, today: ISODate): Bucket | null {
  const { from, to } = m.summary;
  if (!from) return null;
  const now = dayNumber(today);
  if (dayNumber(to ?? from) < now) return null;
  const start = dayNumber(from);
  if (start <= now) return 'today'; // starts today, or an ongoing plan
  const thisSunday = sundayOnOrAfter(now);
  if (start <= thisSunday) return 'thisWeek';
  return start <= thisSunday + 7 ? 'nextWeek' : 'later';
}

export function homeSections(metas: NoteMeta[], today: ISODate, query = ''): HomeSections {
  const alive = metas.filter(live);
  const archivedCount = alive.filter((m) => m.archived).length;
  const active = alive.filter((m) => !m.archived);

  const words = foldText(query).split(' ').filter(Boolean);
  if (words.length > 0) {
    const results = active
      .filter((m) => {
        const hay = foldText([m.summary.searchText, m.summary.title, ...m.summary.placeNames].join(' '));
        return words.every((w) => hay.includes(w));
      })
      .sort(byUpdated);
    return { pinned: [], upcoming: [], recent: [], archivedCount, results };
  }

  const pinned = active.filter((m) => m.pinned).sort(byUpdated);
  const rest = active.filter((m) => !m.pinned);

  const grouped = new Map<Bucket, NoteMeta[]>();
  const recent: NoteMeta[] = [];
  for (const m of rest) {
    const bucket = bucketFor(m, today);
    if (!bucket) recent.push(m);
    else grouped.set(bucket, [...(grouped.get(bucket) ?? []), m]);
  }

  const upcoming = BUCKETS.filter((b) => grouped.has(b)).map((bucket) => ({
    bucket,
    notes: grouped.get(bucket)!.sort((a, b) => a.summary.from!.localeCompare(b.summary.from!) || byUpdated(a, b)),
  }));
  return { pinned, upcoming, recent: recent.sort(byUpdated), archivedCount };
}

export function archivedNotes(metas: NoteMeta[]): NoteMeta[] {
  return metas.filter((m) => live(m) && m.archived).sort(byUpdated);
}

/**
 * "in 5 days" for a plan ahead, "ends in 3 days" for one under way. Past plans get ''
 * because home doesn't badge them.
 */
export function relativeDays(from: ISODate, to: ISODate, today: ISODate): string {
  const now = dayNumber(today);
  const start = dayNumber(from) - now;
  if (start > 0) return start === 1 ? 'tomorrow' : `in ${start} days`;
  const end = dayNumber(to) - now;
  if (end < 0) return '';
  if (start === 0) return 'today';
  return end === 0 ? 'ends today' : end === 1 ? 'ends tomorrow' : `ends in ${end} days`;
}
