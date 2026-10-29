import { useEffect, useRef, useState, type RefObject } from 'react';
import type { NodeId } from '../../model/types';
import type { ISODate } from '../../context/resolve';
import { useStore } from '../store';
import { setHovered, useHovered } from '../hover';
import { collectDates, plainText } from './collect';
import { formatDate } from '../../formula/format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86400000;
const MAX_WEEKS = 26;
const NARROW_PX = 520;

const toUTC = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const toISO = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);

/** Monday on or before `first` through the Sunday on or after `last`, capped. */
function weekSpan(first: ISODate, last: ISODate): ISODate[] {
  const start = toUTC(first) - ((new Date(toUTC(first)).getUTCDay() + 6) % 7) * DAY_MS;
  const end = toUTC(last) + ((7 - new Date(toUTC(last)).getUTCDay()) % 7) * DAY_MS;
  const days: ISODate[] = [];
  for (let t = start; t <= end && days.length < MAX_WEEKS * 7; t += DAY_MS) days.push(toISO(t));
  return days;
}

function title(first: ISODate, last: ISODate): string {
  const [fy, fm] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  if (fy !== ly) return `${MONTHS[fm - 1]} ${fy} – ${MONTHS[lm - 1]} ${ly}`;
  if (fm !== lm) return `${MONTHS[fm - 1]} – ${MONTHS[lm - 1]} ${fy}`;
  return `${MONTHS[fm - 1]} ${fy}`;
}

/** True at or below NARROW_PX. Without ResizeObserver (jsdom) it stays wide. */
function useNarrow(ref: RefObject<HTMLElement | null>, force?: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= NARROW_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return force ?? narrow;
}

/** Only the weeks the plan spans, so a four-day trip isn't lost in a month grid. */
export function CalendarView({ id, forceNarrow }: { id: NodeId; forceNarrow?: boolean }) {
  const { viewDoc: doc, contexts, setFocus } = useStore();
  const hovered = useHovered();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root, forceNarrow);
  const byDate = collectDates(doc, contexts, id);
  const dates = [...byDate.keys()];
  if (dates.length === 0) {
    return (
      <div ref={root}>
        <div className="view-empty">No dates under this bullet yet — mention one like “Nov 3”.</div>
      </div>
    );
  }
  const entry = (nodeId: NodeId) => {
    const text = doc.nodes[nodeId].text;
    const label = plainText(text, { dates: false }) || plainText(text);
    return (
      <button
        type="button"
        key={nodeId}
        className={`entry${hovered === nodeId ? ' is-hovered' : ''}`}
        title={label}
        onMouseEnter={() => setHovered(nodeId)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => setFocus({ id: nodeId, caret: text.length })}
      >
        {label}
      </button>
    );
  };
  const first = dates[0];
  const last = dates[dates.length - 1];

  // `root` has no padding, so its width matches the view's, as the old container query did.
  return (
    <div ref={root}>
      <div className="calendar">
        <h4>{title(first, last)}</h4>
        <div className="month-grid">
          {DOW.map((d) => (
            <div className="dow" key={d}>
              {d}
            </div>
          ))}
          {weekSpan(first, last).map((iso) => {
            const entries = byDate.get(iso) ?? [];
            const [, m, d] = iso.split('-').map(Number);
            const outside = iso < first || iso > last;
            return (
              <div className={`day${entries.length ? ' has-entries' : ''}${outside ? ' is-outside' : ''}`} key={iso}>
                <span className="day-num">{d === 1 ? `${MONTHS[m - 1].slice(0, 3)} 1` : d}</span>
                {narrow
                  ? entries.map((n) => <span className="dot" aria-hidden="true" key={n} />)
                  : entries.map(entry)}
              </div>
            );
          })}
        </div>
        {/* Narrow screens read the plan as a list; the grid above shrinks to dots.
            Rendered only then, so the same entries never appear twice to a screen reader. */}
        {narrow && (
          <ol className="agenda">
            {dates.map((iso) => (
              <li key={iso}>
                <span className="agenda-date">{formatDate(iso)}</span>
                <div className="agenda-entries">{byDate.get(iso)!.map(entry)}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
