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

export function Timeline({ upcoming, today, menuFor }: Props) {
  if (upcoming.length === 0) return null;
  return (
    <div className="timeline" role="group" aria-label="Upcoming">
      {upcoming.map(({ bucket, notes }) => (
        <section key={bucket} className="timeline__bucket" aria-labelledby={`bucket-${bucket}`}>
          <h2 className="section-head" id={`bucket-${bucket}`}>
            {LABELS[bucket]}
          </h2>
          <ol className="timeline__list rail">
            {notes.map((m, i) => {
              const day = stampDay(m, today);
              // Notes on the same day share one stamp, so the rail reads as a calendar.
              const repeat = i > 0 && stampDay(notes[i - 1], today) === day;
              return (
                <li key={m.id} className="timeline__item">
                  <Stamp iso={day} month={bucket === 'later'} hidden={repeat} />
                  <NoteCard meta={m} variant="timeline" today={today} menu={menuFor(m)} />
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** A plan already under way hangs off today, where it is happening now. */
const stampDay = (m: NoteMeta, today: ISODate): ISODate => {
  const from = m.summary.from ?? today;
  return from < today ? today : from;
};

/** Decorative for screen readers: the card itself already says the range and how soon. */
function Stamp({ iso, month, hidden }: { iso: ISODate; month: boolean; hidden: boolean }) {
  const [, m, d] = iso.split('-').map(Number);
  const top = month ? MONTHS[m - 1] : WEEKDAYS[(dayNumber(iso) + 3) % 7];
  return (
    <time
      className={`stamp${month ? ' stamp--month' : ''}${hidden ? ' stamp--repeat' : ''}`}
      dateTime={iso}
      aria-hidden="true"
    >
      {!hidden && (
        <>
          <span className="stamp__weekday">{top}</span>
          <span className="stamp__day">{d}</span>
        </>
      )}
    </time>
  );
}
