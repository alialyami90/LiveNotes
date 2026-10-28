export interface DateMatch {
  len: number;
  month: number; // 1-12
  day: number;
  year?: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH = '([A-Za-z]+)';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const ISO_RE = /(\d{4})-(\d{2})-(\d{2})(?!\d)/y;
const MONTH_DAY_RE = new RegExp(`${MONTH} ${DAY}(?:,? (\\d{4}))?(?![\\p{L}\\d])`, 'yu');
const DAY_MONTH_RE = new RegExp(`${DAY} ${MONTH}(?: (\\d{4}))?(?![\\p{L}\\d])`, 'yu');
const WORD_CHAR = /[\p{L}\d]/u;

function valid(month: number | undefined, day: number, year?: number): month is number {
  if (!month || month > 12 || day < 1) return false;
  // Feb 29 is allowed without a year; the leap year 2000 makes that the default.
  const max = new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
  return day <= max;
}

function build(len: number, month: number, day: number, year?: string): DateMatch {
  return year ? { len, month, day, year: Number(year) } : { len, month, day };
}

/** Recognizes a date starting exactly at `i`, or returns null. */
export function parseDateAt(text: string, i: number): DateMatch | null {
  if (i > 0 && WORD_CHAR.test(text[i - 1])) return null;

  ISO_RE.lastIndex = i;
  let m = ISO_RE.exec(text);
  if (m) {
    const [all, y, mo, d] = m;
    return valid(Number(mo), Number(d), Number(y)) ? build(all.length, Number(mo), Number(d), y) : null;
  }

  MONTH_DAY_RE.lastIndex = i;
  m = MONTH_DAY_RE.exec(text);
  if (m) {
    const [all, name, d, y] = m;
    const month = MONTHS[name.toLowerCase()];
    if (valid(month, Number(d), y ? Number(y) : undefined)) return build(all.length, month, Number(d), y);
  }

  DAY_MONTH_RE.lastIndex = i;
  m = DAY_MONTH_RE.exec(text);
  if (m) {
    const [all, d, name, y] = m;
    const month = MONTHS[name.toLowerCase()];
    if (valid(month, Number(d), y ? Number(y) : undefined)) return build(all.length, month, Number(d), y);
  }
  return null;
}
