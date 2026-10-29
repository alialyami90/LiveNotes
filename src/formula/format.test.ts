import { describe, expect, it } from 'vitest';
import { formatValue } from './format';

describe('formatValue', () => {
  it.each([
    [{ kind: 'duration', seconds: 11100 }, '3h 05m'],
    [{ kind: 'duration', seconds: 2700 }, '45 min'],
    [{ kind: 'duration', seconds: 4 * 86400 }, '4 days'],
    [{ kind: 'duration', seconds: 86400 }, '1 day'],
    [{ kind: 'distance', meters: 313400 }, '313 km'],
    [{ kind: 'distance', meters: 2440 }, '2.4 km'],
    [{ kind: 'distance', meters: 850 }, '850 m'],
    [{ kind: 'speed', mps: 25 }, '90 km/h'],
    [{ kind: 'number', value: 4 }, '4'],
    [{ kind: 'number', value: 1 / 3 }, '0.33'],
    [{ kind: 'string', value: 'hi' }, 'hi'],
    [{ kind: 'date', iso: '2026-11-03' }, 'Tue, Nov 3'],
    [{ kind: 'place', place: { name: 'Lisbon', lat: 0, lon: 0 } }, 'Lisbon'],
    [{ kind: 'weather', code: 0, condition: 'Clear', icon: '☀️', high: 21.4, low: 13.6 }, '☀️ 21° / 14°'],
    [{ kind: 'route', seconds: 11100, meters: 313400 }, '🚗 3h 05m · 313 km'],
    [{ kind: 'travel', mode: 'drive', meters: 313400, seconds: 11100, estimated: false }, '🚗 3h 05m · 313 km'],
    [{ kind: 'travel', mode: 'walk', meters: 5800, seconds: 4200, estimated: true }, '🚶 ≈ 1h 10m · 5.8 km'],
    [{ kind: 'travel', mode: 'bike', meters: 6100, seconds: 1500, estimated: true }, '🚲 ≈ 25 min · 6.1 km'],
    [{ kind: 'travel', mode: 'transit', meters: 313400, estimated: false, directionsUrl: 'https://x' }, '🚆 313 km'],
    [{ kind: 'travel', mode: 'fly', meters: 503000, estimated: false }, '✈ 503 km'],
    [{ kind: 'error', message: 'nope' }, '⚠ nope'],
  ] as const)('formats %j', (value, expected) => {
    expect(formatValue(value)).toBe(expected);
  });
});
