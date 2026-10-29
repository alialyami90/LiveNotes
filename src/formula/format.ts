import { MODES, type Mode } from '../syntax/phrases';
import type { Value } from './values';

export const TRAVEL_ICON = Object.fromEntries(MODES.map((m) => [m.mode, m.icon])) as Record<Mode, string>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const trimNumber = (n: number) => String(Math.round(n * 100) / 100);

export function formatDuration(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const totalMin = Math.round(Math.abs(seconds) / 60);
  const sign = seconds < 0 ? '-' : '';
  if (totalMin < 60) return `${sign}${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  return `${sign}${h}h ${String(totalMin % 60).padStart(2, '0')}m`;
}

export function formatDistance(meters: number): string {
  if (Math.abs(meters) < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return Math.abs(km) < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[m - 1]} ${d}`;
}

export function formatValue(v: Value): string {
  switch (v.kind) {
    case 'number':
      return trimNumber(v.value);
    case 'string':
      return v.value;
    case 'place':
      return v.place.name;
    case 'date':
      return formatDate(v.iso);
    case 'duration':
      return formatDuration(v.seconds);
    case 'distance':
      return formatDistance(v.meters);
    case 'speed':
      return `${Math.round(v.mps * 3.6)} km/h`;
    case 'weather':
      return `${v.icon} ${Math.round(v.high)}° / ${Math.round(v.low)}°`;
    case 'route':
      return `🚗 ${formatDuration(v.seconds)} · ${formatDistance(v.meters)}`;
    case 'travel': {
      // Transit has no time, and its "Directions ↗" link is added by the chip.
      const time = v.seconds === undefined ? '' : `${v.estimated ? '≈ ' : ''}${formatDuration(v.seconds)} · `;
      return `${TRAVEL_ICON[v.mode]} ${time}${formatDistance(v.meters)}`;
    }
    case 'error':
      return `⚠ ${v.message}`;
  }
}
