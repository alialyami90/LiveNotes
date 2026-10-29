import type { ReactNode } from 'react';
import { dayNumber, type ISODate } from '../context/resolve';
import type { NoteMeta } from '../library/types';
import { NoteCard } from './NoteCard';

interface Props {
  notes: NoteMeta[];
  today: ISODate;
  menuFor(meta: NoteMeta): ReactNode;
}

/** Recent-style cards; one that is still ahead (a search result) keeps its timeline look so the date leads. */
export function CardList({ notes, today, menuFor }: Props) {
  return (
    <ul className="card-list">
      {notes.map((m) => (
        <li key={m.id}>
          <NoteCard meta={m} variant={isAhead(m, today) ? 'timeline' : 'recent'} today={today} menu={menuFor(m)} />
        </li>
      ))}
    </ul>
  );
}

const isAhead = (m: NoteMeta, today: ISODate) => {
  const end = m.summary.to ?? m.summary.from;
  return !!end && dayNumber(end) >= dayNumber(today);
};
