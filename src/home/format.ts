import type { ISODate } from '../context/resolve';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parsed by hand: `new Date('2026-11-03')` is UTC midnight and would slip a day in western zones.
function parts(iso: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

/** "Nov 3–6", "Oct 30 – Nov 2", "Nov 3"; the year appears only when it isn't today's. */
export function formatRange(from: ISODate | undefined, to: ISODate | undefined, today: ISODate): string {
  if (!from) return '';
  const a = parts(from);
  const b = to ? parts(to) : a;
  const thisYear = parts(today).y;
  const single = a.y === b.y && a.m === b.m && a.d === b.d;
  const foreign = a.y !== thisYear || b.y !== thisYear;
  const sameYear = a.y === b.y;

  if (single) return `${MONTHS[a.m]} ${a.d}${foreign ? `, ${a.y}` : ''}`;
  if (sameYear && a.m === b.m) return `${MONTHS[a.m]} ${a.d}–${b.d}${foreign ? `, ${a.y}` : ''}`;
  // Across months: one trailing year when both ends share it, otherwise each end carries its own.
  const left = `${MONTHS[a.m]} ${a.d}${foreign && !sameYear ? `, ${a.y}` : ''}`;
  const right = `${MONTHS[b.m]} ${b.d}${foreign ? `, ${b.y}` : ''}`;
  return `${left} – ${right}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "edited 5m ago" … "edited Oct 12" once it is more than a week old. */
export function editedAgo(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt);
  if (diff < MINUTE) return 'edited just now';
  if (diff < HOUR) return `edited ${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `edited ${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'edited yesterday';
  if (diff <= 7 * DAY) return `edited ${Math.floor(diff / DAY)} days ago`;
  const then = new Date(updatedAt);
  const year = then.getFullYear() === new Date(now).getFullYear() ? '' : `, ${then.getFullYear()}`;
  return `edited ${MONTHS[then.getMonth()]} ${then.getDate()}${year}`;
}
