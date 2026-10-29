import { useEffect, useState } from 'react';
import type { Place } from '../model/types';
import { haversine } from '../services/geo';
import { useStore } from './store';

export interface Suggestion {
  place: Place;
  saved: boolean;
}

const MIN_REMOTE_CHARS = 2;
const DEBOUNCE_MS = 250;
const SAME_PLACE_M = 2000;

/**
 * Suggestions for an @mention: places already in this document first (instant,
 * offline), then debounced web results biased to `near`.
 */
export function usePlaceSearch(query: string | null, near?: Place): { items: Suggestion[]; loading: boolean } {
  const { doc, services } = useStore();
  const [remote, setRemote] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const trimmed = query?.trim() ?? '';

  useEffect(() => {
    setRemote([]);
    if (query === null || trimmed.length < MIN_REMOTE_CHARS) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      services
        .search(trimmed, near)
        .then(
          (items) => live && setRemote(items),
          () => live && setRemote([]),
        )
        .finally(() => live && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query === null, trimmed, near?.lat, near?.lon, services]);

  if (query === null) return { items: [], loading: false };
  const q = trimmed.toLowerCase();
  const saved = Object.entries(doc.places)
    .filter(([key]) => key.includes(q))
    .slice(0, 4)
    .map(([, place]) => ({ place, saved: true }));
  const fresh = remote
    .filter((p) => !saved.some((s) => haversine(s.place, p) < SAME_PLACE_M))
    .map((place) => ({ place, saved: false }));
  return { items: [...saved, ...fresh].slice(0, 8), loading };
}
