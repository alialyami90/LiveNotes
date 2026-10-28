import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Doc, Focus, OpResult, Place } from '../model/types';
import { setPlace } from '../model/ops';
import { loadDoc, parseImport, safeStorage, STORAGE_KEY } from '../model/storage';
import { resolveContexts, isoDate, type ISODate, type NodeContext } from '../context/resolve';
import type { Services } from '../services/types';
import { memoize } from '../services/memo';
import { httpServices } from '../services/http';

export type PlaceStatus = 'pending' | 'missing';

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
}

export function DocProvider({ children, initialDoc, services: given, storage = safeStorage(), today = localToday() }: Props) {
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

  /** A new document may lack places this session already looked up, so lookups start over. */
  const load = useCallback((doc: Doc, keepFocus: boolean) => {
    requested.current.clear();
    setPlaceStatus({});
    setState((s) => next(s, doc, keepFocus && s.focus && doc.nodes[s.focus.id] ? s.focus : null));
  }, []);

  const replaceDoc = useCallback((doc: Doc) => load(doc, false), [load]);

  const inFlight = useRef(new Map<string, Promise<Place | null>>());

  const lookUp = useCallback(
    async (key: string): Promise<Place | null> => {
      setPlaceStatus((s) => (s[key] === 'pending' ? s : { ...s, [key]: 'pending' }));
      let place: Place | null = null;
      try {
        place = await services.geocode(key);
      } catch {
        place = null;
      }
      if (place) {
        const found = place;
        apply((d) => (d.places[key] ? { doc: d } : setPlace(d, key, found)));
      }
      setPlaceStatus((s) => {
        const { [key]: _done, ...rest } = s;
        return place ? rest : { ...rest, [key]: 'missing' };
      });
      return place;
    },
    [services, apply],
  );

  /** One lookup per key at a time, whether a mention or a formula asks first. */
  const resolvePlace = useCallback(
    (key: string): Promise<Place | null> => {
      const known = docRef.current.places[key];
      if (known) return Promise.resolve(known);
      let pending = inFlight.current.get(key);
      if (!pending) {
        pending = lookUp(key).finally(() => inFlight.current.delete(key));
        inFlight.current.set(key, pending);
      }
      return pending;
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

  useEffect(() => {
    for (const ctx of contexts.values()) {
      for (const key of ctx.ownPlaces) {
        if (viewDoc.places[key] || requested.current.has(key)) continue;
        requested.current.add(key);
        void resolvePlace(key);
      }
    }
  }, [contexts, viewDoc.places, resolvePlace]);

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
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
