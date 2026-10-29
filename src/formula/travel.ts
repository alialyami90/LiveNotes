import type { Place } from '../model/types';
import { haversine } from '../services/geo';
import type { Services } from '../services/types';
import type { Mode } from '../syntax/phrases';
import type { Segment } from '../syntax/tokenize';
import { err, type Value } from './values';

export const WALK_KMH = 4.8;
export const BIKE_KMH = 15;
export const MAX_ESTIMATE_KM = 100;

/** A plain link: no key and no API call. */
export function directionsUrl(from: Place, to: Place): string {
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&travelmode=transit`
  );
}

/**
 * Walk and bike reuse the driving route's distance because the free OSRM server only
 * routes cars; the result is flagged `estimated` so it is shown as ≈.
 */
export async function travel(mode: Mode, from: Place, to: Place, services: Services): Promise<Value> {
  if (mode === 'fly') return { kind: 'travel', mode, meters: haversine(from, to), estimated: false };

  const route = await services.route(from, to);
  switch (mode) {
    case 'drive':
      return { kind: 'travel', mode, meters: route.meters, seconds: route.seconds, estimated: false };
    case 'walk':
    case 'bike': {
      if (route.meters > MAX_ESTIMATE_KM * 1000) return err(mode === 'walk' ? 'too far to walk' : 'too far to cycle');
      const kmh = mode === 'walk' ? WALK_KMH : BIKE_KMH;
      return { kind: 'travel', mode, meters: route.meters, seconds: route.meters / (kmh / 3.6), estimated: true };
    }
    case 'transit':
      return { kind: 'travel', mode, meters: route.meters, estimated: false, directionsUrl: directionsUrl(from, to) };
  }
}

/**
 * The formula a phrase stands for (R6), so the existing engine evaluates it. Place keys are
 * already normalised, and `@[key]` re-parses to the same key (a key can't contain `]`).
 */
export function phraseSource(seg: Extract<Segment, { kind: 'weather' | 'route' }>): string {
  if (seg.kind === 'weather') return 'weather()';
  const from = seg.fromKey === undefined ? 'prev' : `@[${seg.fromKey}]`;
  return `travel(${JSON.stringify(seg.mode)}, ${from}, @[${seg.toKey}])`;
}
