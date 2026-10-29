import type { ReactNode } from 'react';
import type { ISODate } from '../context/resolve';
import { relativeDays } from '../library/sections';
import type { NoteMeta } from '../library/types';
import { editedAgo, formatRange } from './format';
import './home.css';
import { RouteSketch } from './RouteSketch';

interface Props {
  meta: NoteMeta;
  variant: 'timeline' | 'recent';
  today: ISODate;
  now?: number;
  /** Rendered beside the link: a button nested in an anchor is invalid and unreachable by keyboard. */
  menu?: ReactNode;
}

export function NoteCard({ meta, variant, today, now = Date.now(), menu }: Props) {
  const s = meta.summary;
  const range = formatRange(s.from, s.to, today);
  // A start with no end is a single day.
  const relative = s.from ? relativeDays(s.from, s.to ?? s.from, today) : '';

  return (
    <div className={`note-card-wrap note-card-wrap--${variant}`}>
      <a className={`note-card note-card--${variant}`} href={`#/note/${meta.id}`}>
        <div className="note-card__body">
          <h3 className="note-card__title">{s.title || 'Untitled'}</h3>
          {variant === 'timeline' ? (
            <>
              {(range || relative) && (
                <p className="note-card__meta">
                  {range && <span className="note-card__range">{range}</span>}
                  {relative && <span className="note-card__relative">{relative}</span>}
                </p>
              )}
              {s.placeNames.length > 0 && (
                <p className="note-card__places">{s.placeNames.slice(0, 3).join(' · ')}</p>
              )}
            </>
          ) : (
            <>
              <p className="note-card__meta">
                <span className="note-card__edited">{editedAgo(meta.updatedAt, now)}</span>
                {range && <span className="note-card__range note-card__range--quiet">{range}</span>}
              </p>
              {s.places.length === 0 && s.preview && <p className="note-card__preview">{s.preview}</p>}
            </>
          )}
        </div>
        {s.places.length > 0 && (
          <div className="note-card__sketch">
            <RouteSketch places={s.places} />
          </div>
        )}
      </a>
      {menu && <div className="note-card__menu">{menu}</div>}
    </div>
  );
}
