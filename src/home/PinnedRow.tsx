import type { ISODate } from '../context/resolve';
import type { NoteMeta } from '../library/types';
import { formatRange } from './format';
import './home.css';

export function PinnedRow({ metas, today }: { metas: NoteMeta[]; today: ISODate }) {
  if (metas.length === 0) return null;
  return (
    <section className="pinned-row" aria-labelledby="pinned-row-label">
      <h2 className="pinned-row__label" id="pinned-row-label">
        Pinned
      </h2>
      <ul className="pinned-row__list">
        {metas.map((m) => {
          const range = formatRange(m.summary.from, m.summary.to, today);
          return (
            <li key={m.id}>
              <a className="pinned-chip" href={`#/note/${m.id}`}>
                <span className="pinned-chip__title">{m.summary.title || 'Untitled'}</span>
                {range && <span className="pinned-chip__date">{range}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
