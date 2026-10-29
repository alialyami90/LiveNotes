import { useEffect, useState } from 'react';
import type { Place } from '../model/types';
import { haversine } from '../services/geo';
import type { Found } from '../services/types';
import { useStore } from './store';

export interface Suggestion {
  /** Never carries `elsewhere`: it is stored as-is when picked. */
  place: Place;
  saved: boolean;
  section: 'saved' | 'inside' | 'elsewhere';
}

const MIN_REMOTE_CHARS = 2;
const DEBOUNCE_MS = 250;
const SAME_PLACE_M = 2000;
const MAX_SAVED = 4;
const MAX_INSIDE = 8;
const MAX_ELSEWHERE = 8;

/** Splits the display flag off the place, so what gets stored never has it. */
function split({ elsewhere, ...place }: Found): { place: Place; elsewhere: boolean } {
  return { place, elsewhere: elsewhere === true };
}

/**
 * Suggestions for an @mention: places already in this document first (instant,
 * offline), then debounced web results biased to `near`: rows inside its area,
 * then the ones flagged `elsewhere`.
 */
export function usePlaceSearch(query: string | null, near?: Place): { items: Suggestion[]; loading: boolean } {
  const { doc, services } = useStore();
  const [remote, setRemote] = useState<Found[]>([]);
  const [loading, setLoading] = useState(false);
  const trimmed = query?.trim() ?? '';

  useEffect(() => {
    setRemote([]);
    if (query === null || trimmed.length < MIN_REMOTE_CHARS) {
      setLoading(false);
      return;
    }
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      services
        .search(trimmed, near, {
          signal: controller.signal,
          // Towns answer fast; show each stage while the queued landmark searches are still coming.
          onUpdate: (found) => live && setRemote(found),
        })
        .then(
          (items) => live && setRemote(items),
          () => undefined,
        )
        .finally(() => live && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [query === null, trimmed, near?.lat, near?.lon, services]);

  if (query === null) return { items: [], loading: false };
  const q = trimmed.toLowerCase();
  const saved: Suggestion[] = Object.entries(doc.places)
    .filter(([key]) => key.includes(q))
    .slice(0, MAX_SAVED)
    .map(([, place]) => ({ place, saved: true, section: 'saved' }));
  const fresh = remote
    .map(split)
    .filter(({ place }) => !saved.some((s) => haversine(s.place, place) < SAME_PLACE_M));
  // Without a parent place there is no "area", so nothing can be elsewhere.
  const isElsewhere = (r: { elsewhere: boolean }) => r.elsewhere && near !== undefined;
  const inside: Suggestion[] = fresh
    .filter((r) => !isElsewhere(r))
    .slice(0, MAX_INSIDE)
    .map(({ place }) => ({ place, saved: false, section: 'inside' }));
  const elsewhere: Suggestion[] = fresh
    .filter(isElsewhere)
    .slice(0, MAX_ELSEWHERE)
    .map(({ place }) => ({ place, saved: false, section: 'elsewhere' }));
  return { items: [...saved, ...inside, ...elsewhere], loading };
}
