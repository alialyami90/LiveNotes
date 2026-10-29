import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Doc, Focus, OpResult, Place } from '../model/types';
import { setPlace } from '../model/ops';
import { loadDoc, parseImport, safeStorage, STORAGE_KEY } from '../model/storage';
import { resolveContexts, isoDate, type ISODate, type NodeContext } from '../context/resolve';
import type { Services } from '../services/types';
import { memoize } from '../services/memo';
import { httpServices, TransientError } from '../services/http';

export type PlaceStatus = 'pending' | 'missing' | 'error';

interface Store {
  /** Live document; the focused row's editor reads from this. */
  doc: Doc;
  /**
   * The document as the rest of the page should see it: the focused row's text
   * is held at its value from when editing began, so half-typed mentions never
   * reach contexts, formulas, views or the geocoder.
   */
  viewDoc: Doc;
  focus: Focus | null;
  contexts: Map<string, NodeContext>;
  placeStatus: Record<string, PlaceStatus>;
  services: Services;
  today: ISODate;
  /** Applies a pure op; `focus` overrides the op's own focus (e.g. keep caret after indent). */
  apply(op: (doc: Doc) => OpResult, focus?: Focus | null): void;
  setFocus(update: Focus | null | ((f: Focus | null) => Focus | null)): void;
  replaceDoc(doc: Doc): void;
  resolvePlace(key: string): Promise<Place | null>;
  /** Try a place again now (tap on a "couldn't reach" chip). */
  retryPlace(key: string): void;
}

interface State {
  doc: Doc;
  focus: Focus | null;
  frozen: { id: string; text: string } | null;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore outside DocProvider');
  return s;
}

const localToday = (): ISODate => {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

/** Snapshot the newly focused row's text whenever focus moves to a different row. */
function next(s: State, doc: Doc, focus: Focus | null): State {
  if (focus?.id === s.focus?.id && s.frozen && doc.nodes[s.frozen.id]) return { doc, focus, frozen: s.frozen };
  return { doc, focus, frozen: focus && doc.nodes[focus.id] ? { id: focus.id, text: doc.nodes[focus.id].text } : null };
}

const SAVE_DELAY_MS = 300;

interface Props {
  children: ReactNode;
  initialDoc?: Doc;
  services?: Services;
  /** null disables persistence (tests, or browsers with site data blocked). */
  storage?: Storage | null;
  today?: ISODate;
  /** Backoff for places whose lookup failed because a service was unreachable; the last delay repeats. */
  retryDelaysMs?: number[];
}

const RETRY_DELAYS_MS = [3000, 10000, 30000, 60000, 180000];

export function DocProvider({
  children,
  initialDoc,
  services: given,
  storage = safeStorage(),
  today = localToday(),
  retryDelaysMs = RETRY_DELAYS_MS,
}: Props) {
  const [state, setState] = useState<State>(() => ({
    doc: initialDoc ?? loadDoc(storage ?? { getItem: () => null }),
    focus: null,
    frozen: null,
  }));
  const [placeStatus, setPlaceStatus] = useState<Record<string, PlaceStatus>>({});
  const services = useMemo(() => given ?? memoize(httpServices()), [given]);

  const docRef = useRef(state.doc);
  docRef.current = state.doc;
  const requested = useRef(new Set<string>());

  const apply = useCallback((op: (doc: Doc) => OpResult, focus?: Focus | null) => {
    setState((s) => {
      const r = op(s.doc);
      return next(s, r.doc, focus !== undefined ? focus : (r.focus ?? s.focus));
    });
  }, []);

  const setFocus = useCallback((update: Focus | null | ((f: Focus | null) => Focus | null)) => {
    setState((s) => next(s, s.doc, typeof update === 'function' ? update(s.focus) : update));
  }, []);


  const statusRef = useRef(placeStatus);
  statusRef.current = placeStatus;
  const attempts = useRef(new Map<string, number>());
  const waiters = useRef(new Map<string, ((p: Place | null) => void)[]>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [retryTick, setRetryTick] = useState(0);
  // Keys mentioned in the text; filled during render (below) so formulas, whose
  // effects run before ours, already know to wait for the biased mention lookup.
  const mentioned = useRef(new Set<string>());

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

  /**
   * A new document may lack places this session already looked up, so lookups
   * start over. Waiting formulas stay waiting; the new document's lookups settle them.
   */
  const load = useCallback(
    (doc: Doc, keepFocus: boolean) => {
      clearTimers();
      requested.current.clear();
      attempts.current.clear();
      setPlaceStatus({});
      setState((s) => next(s, doc, keepFocus && s.focus && doc.nodes[s.focus.id] ? s.focus : null));
    },
    [clearTimers],
  );

  const replaceDoc = useCallback((doc: Doc) => load(doc, false), [load]);

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
    [lookUp],
  );

  const { frozen } = state;
  const viewDoc = useMemo(() => {
    const node = frozen && state.doc.nodes[frozen.id];
    if (!frozen || !node || node.text === frozen.text) return state.doc;
    return { ...state.doc, nodes: { ...state.doc.nodes, [frozen.id]: { ...node, text: frozen.text } } };
  }, [state.doc, frozen]);

  const contexts = useMemo(() => resolveContexts(viewDoc, today), [viewDoc, today]);
  mentioned.current = useMemo(() => {
    const keys = new Set<string>();
    for (const ctx of contexts.values()) ctx.ownPlaces.forEach((k) => keys.add(k));
    return keys;
  }, [contexts]);

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

  // ---- persistence: debounced save, flush on hide, follow other tabs ----
  const lastWritten = useRef<string | null>(null);
  const dirty = useRef(false);
  const flush = useCallback(() => {
    if (!storage || !dirty.current) return;
    dirty.current = false;
    const json = JSON.stringify(docRef.current);
    if (json === lastWritten.current) return;
    try {
      storage.setItem(STORAGE_KEY, json);
      lastWritten.current = json;
    } catch (e) {
      console.warn('LiveNotes: could not save', e);
    }
  }, [storage]);

  useEffect(() => {
    if (!storage) return;
    dirty.current = true;
    const t = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.doc, storage, flush]);

  useEffect(() => {
    if (!storage) return;
    const onHide = () => flush();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || e.newValue === lastWritten.current) return;
      const doc = parseImport(e.newValue);
      if (!doc) return;
      lastWritten.current = e.newValue;
      dirty.current = false;
      load(doc, true);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
    };
  }, [storage, flush, load]);

  const value: Store = {
    doc: state.doc,
    viewDoc,
    focus: state.focus,
    contexts,
    placeStatus,
    services,
    today,
    apply,
    setFocus,
    replaceDoc,
    resolvePlace,
    retryPlace,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
