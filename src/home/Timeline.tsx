import type { ReactNode } from 'react';
import { dayNumber, type ISODate } from '../context/resolve';
import type { Bucket } from '../library/sections';
import type { NoteMeta } from '../library/types';
import { NoteCard } from './NoteCard';

const LABELS: Record<Bucket, string> = {
  today: 'Today',
  thisWeek: 'This week',
  nextWeek: 'Next week',
  later: 'Later',
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  upcoming: { bucket: Bucket; notes: NoteMeta[] }[];
  today: ISODate;
  menuFor(meta: NoteMeta): ReactNode;
}

/** One section per non-empty bucket, each a rail of dates (DESIGN.md "The rail"). */
export function Timeline({ upcoming, today, menuFor }: Props) {
  return (
    <>
      {upcoming.map(({ bucket, notes }) => (
        <section key={bucket} className="home-section" aria-labelledby={`bucket-${bucket}`}>
          <h2 className="section-head" id={`bucket-${bucket}`}>
            {LABELS[bucket]}
          </h2>
          <ol className="rail">
            {byDay(notes, today).map(({ day, notes: same }) => (
              <li key={day} className="rail__item">
                <Stamp iso={day} month={bucket === 'later'} today={day === today} />
                <div className="rail__cards">
                  {same.map((m) => (
                    <NoteCard key={m.id} meta={m} variant="timeline" today={today} menu={menuFor(m)} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

/** A plan already under way hangs off today, where it is happening now. */
const stampDay = (m: NoteMeta, today: ISODate): ISODate => {
  const from = m.summary.from ?? today;
  return from < today ? today : from;
};

/** Notes arrive sorted by start, so same-day notes are adjacent and share one stamp. */
function byDay(notes: NoteMeta[], today: ISODate): { day: ISODate; notes: NoteMeta[] }[] {
  const groups: { day: ISODate; notes: NoteMeta[] }[] = [];
  for (const m of notes) {
    const day = stampDay(m, today);
    const last = groups.at(-1);
    if (last?.day === day) last.notes.push(m);
    else groups.push({ day, notes: [m] });
  }
  return groups;
}

/** Decorative for screen readers: each card already says its range and how soon it is. */
function Stamp({ iso, month, today }: { iso: ISODate; month: boolean; today: boolean }) {
  const [, m, d] = iso.split('-').map(Number);
  // Day 0 (1970-01-01) was a Thursday, so +3 puts Monday at 0.
  const top = month ? MONTHS[m - 1] : WEEKDAYS[(dayNumber(iso) + 3) % 7];
  return (
    <div className={`stamp${month ? ' stamp--month' : ''}${today ? ' is-today' : ''}`} aria-hidden="true">
      <span className="stamp__weekday">{top}</span>
      <span className="stamp__day">{d}</span>
    </div>
  );
}
