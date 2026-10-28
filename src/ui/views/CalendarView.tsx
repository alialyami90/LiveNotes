import type { NodeId } from '../../model/types';
import type { ISODate } from '../../context/resolve';
import { useStore } from '../store';
import { setHovered, useHovered } from '../hover';
import { collectDates, plainText } from './collect';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86400000;
const MAX_WEEKS = 26;

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

/** Only the weeks the plan spans, so a four-day trip isn't lost in a month grid. */
export function CalendarView({ id }: { id: NodeId }) {
  const { doc, contexts, setFocus } = useStore();
  const hovered = useHovered();
  const byDate = collectDates(doc, contexts, id);
  const dates = [...byDate.keys()];
  if (dates.length === 0) {
    return <div className="view-empty">No dates under this bullet yet — mention one like “Nov 3”.</div>;
  }
  const first = dates[0];
  const last = dates[dates.length - 1];

  return (
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
              {entries.map((nodeId) => {
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
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
