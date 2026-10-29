import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Doc, OpResult, Place } from '../model/types';
import { setPlace } from '../model/ops';
import type { NodeContext } from '../context/resolve';
import type { Services } from '../services/types';
import { TransientError } from '../services/http';

export type PlaceStatus = 'pending' | 'missing' | 'error';

interface Args {
  services: Services;
  apply(op: (doc: Doc) => OpResult): void;
  /** The live document, read by formulas that ask for a place. */
  docRef: RefObject<Doc>;
  viewDoc: Doc;
  contexts: Map<string, NodeContext>;
  retryDelaysMs: number[];
}

export interface PlaceLookups {
  placeStatus: Record<string, PlaceStatus>;
  resolvePlace(key: string): Promise<Place | null>;
  retryPlace(key: string): void;
  /** Forget this session's lookups, for a replaced document. */
  reset(): void;
}

/** Geocodes the document's place mentions (CLAUDE.md §5): top-down, deduplicated, retried while unreachable. */
export function usePlaceLookups({ services, apply, docRef, viewDoc, contexts, retryDelaysMs }: Args): PlaceLookups {
  const [placeStatus, setPlaceStatus] = useState<Record<string, PlaceStatus>>({});
  const requested = useRef(new Set<string>());
  const statusRef = useRef(placeStatus);
  statusRef.current = placeStatus;
  const attempts = useRef(new Map<string, number>());
  const waiters = useRef(new Map<string, ((p: Place | null) => void)[]>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [retryTick, setRetryTick] = useState(0);
  // Keys mentioned in the text; filled during render so formulas, whose
  // effects run before ours, already know to wait for the biased mention lookup.
  const mentioned = useRef(new Set<string>());
  mentioned.current = useMemo(() => {
    const keys = new Set<string>();
    for (const ctx of contexts.values()) ctx.ownPlaces.forEach((k) => keys.add(k));
    return keys;
  }, [contexts]);

  const settle = useCallback((key: string, place: Place | null) => {
    waiters.current.get(key)?.forEach((resolve) => resolve(place));
    waiters.current.delete(key);
  }, []);

  const lookUpRef = useRef<(key: string, near?: Place) => Promise<void>>(async () => {});

  /** Mentions are re-requested by the effect; a place only formulas use is looked up here. */
  const retry = useCallback((key: string) => {
    requested.current.delete(key);
    if (!mentioned.current.has(key) && waiters.current.has(key)) void lookUpRef.current(key);
    setRetryTick((t) => t + 1);
  }, []);

  /**
   * One lookup per key. "Not found" only when the services answered with nothing;
   * an unreachable service is an "error" that keeps being retried (the last delay repeats).
   */
  const lookUp = useCallback(
    async (key: string, near?: Place) => {
      requested.current.add(key);
      setPlaceStatus((s) => ({ ...s, [key]: 'pending' }));
      try {
        const place = await services.geocode(key, near);
        attempts.current.delete(key);
        if (place) apply((d) => (d.places[key] ? { doc: d } : setPlace(d, key, place)));
        setPlaceStatus((s) => {
          const { [key]: _done, ...rest } = s;
          return place ? rest : { ...rest, [key]: 'missing' };
        });
        settle(key, place);
      } catch (e) {
        if (!(e instanceof TransientError)) {
          setPlaceStatus((s) => ({ ...s, [key]: 'missing' }));
          settle(key, null);
          return;
        }
        const n = attempts.current.get(key) ?? 0;
        attempts.current.set(key, n + 1);
        setPlaceStatus((s) => ({ ...s, [key]: 'error' }));
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          retry(key);
        }, retryDelaysMs[Math.min(n, retryDelaysMs.length - 1)]);
        timers.current.add(timer);
      }
    },
    [services, apply, settle, retry, retryDelaysMs],
  );
  lookUpRef.current = lookUp;

  const retryPlace = useCallback(
    (key: string) => {
      attempts.current.delete(key);
      retry(key);
    },
    [retry],
  );

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /** Waiting formulas stay waiting; the new document's lookups settle them. */
  const reset = useCallback(() => {
    clearTimers();
    requested.current.clear();
    attempts.current.clear();
    setPlaceStatus({});
  }, [clearTimers]);

  /**
   * For formulas. A key that is mentioned somewhere waits for that mention's
   * (context-biased) lookup instead of starting a second, unbiased one.
   */
  const resolvePlace = useCallback(
    (key: string): Promise<Place | null> => {
      const known = docRef.current.places[key];
      if (known) return Promise.resolve(known);
      if (statusRef.current[key] === 'missing') return Promise.resolve(null);
      const wait = new Promise<Place | null>((resolve) => {
        waiters.current.set(key, [...(waiters.current.get(key) ?? []), resolve]);
      });
      if (!mentioned.current.has(key) && !requested.current.has(key)) void lookUp(key);
      return wait;
    },
    [docRef, lookUp],
  );

  // Look up mentions top-down: a child waits for its parent's place so the lookup can be biased to it.
  useEffect(() => {
    for (const ctx of contexts.values()) {
      const parentKey = ctx.inheritedPlaceKey;
      const parent = parentKey ? viewDoc.places[parentKey] : undefined;
      const parentSettled = !parentKey || parent || placeStatus[parentKey] === 'missing' || placeStatus[parentKey] === 'error';
      for (const key of ctx.ownPlaces) {
        if (viewDoc.places[key] || requested.current.has(key)) continue;
        if (!parentSettled && parentKey !== key) continue;
        void lookUp(key, parentKey === key ? undefined : parent);
      }
    }
  }, [contexts, viewDoc.places, placeStatus, lookUp, retryTick]);

  // Coming back online, or back to the app, retries everything the services couldn't answer.
  useEffect(() => {
    const retryAll = () => {
      for (const [key, status] of Object.entries(statusRef.current)) if (status === 'error') retryPlace(key);
    };
    const onVisible = () => document.visibilityState === 'visible' && retryAll();
    window.addEventListener('online', retryAll);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', retryAll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [retryPlace]);

  return { placeStatus, resolvePlace, retryPlace, reset };
}
