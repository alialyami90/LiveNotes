import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Doc, Focus, OpResult, Place } from '../model/types';
import { setPlace } from '../model/ops';
import { loadDoc, saveDoc } from '../model/storage';
import { resolveContexts, isoDate, type ISODate, type NodeContext } from '../context/resolve';
import type { Services } from '../services/types';
import { memoize } from '../services/memo';
import { httpServices } from '../services/http';

export type PlaceStatus = 'pending' | 'missing';

interface Store {
  doc: Doc;
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

const SAVE_DELAY_MS = 300;

interface Props {
  children: ReactNode;
  initialDoc?: Doc;
  services?: Services;
  /** null disables persistence (tests). */
  storage?: Storage | null;
  today?: ISODate;
}

export function DocProvider({ children, initialDoc, services: given, storage = window.localStorage, today = localToday() }: Props) {
  const [state, setState] = useState(() => ({
    doc: initialDoc ?? (storage ? loadDoc(storage) : loadDoc({ getItem: () => null })),
    focus: null as Focus | null,
  }));
  const [placeStatus, setPlaceStatus] = useState<Record<string, PlaceStatus>>({});
  const services = useMemo(() => given ?? memoize(httpServices()), [given]);

  const docRef = useRef(state.doc);
  docRef.current = state.doc;

  const apply = useCallback((op: (doc: Doc) => OpResult, focus?: Focus | null) => {
    setState((s) => {
      const r = op(s.doc);
      return { doc: r.doc, focus: focus !== undefined ? focus : (r.focus ?? s.focus) };
    });
  }, []);

  const setFocus = useCallback((update: Focus | null | ((f: Focus | null) => Focus | null)) => {
    setState((s) => ({ ...s, focus: typeof update === 'function' ? update(s.focus) : update }));
  }, []);

  const replaceDoc = useCallback((doc: Doc) => setState({ doc, focus: null }), []);

  const resolvePlace = useCallback(
    async (key: string): Promise<Place | null> => {
      const known = docRef.current.places[key];
      if (known) return known;
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

  const contexts = useMemo(() => resolveContexts(state.doc, today), [state.doc, today]);

  // Resolve mentions in rows the user isn't typing in, so half-typed names aren't geocoded.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const [id, ctx] of contexts) {
      if (id === state.focus?.id) continue;
      for (const key of ctx.ownPlaces) {
        if (state.doc.places[key] || requested.current.has(key)) continue;
        requested.current.add(key);
        void resolvePlace(key);
      }
    }
  }, [contexts, state.focus?.id, state.doc.places, resolvePlace]);

  useEffect(() => {
    if (!storage) return;
    const t = setTimeout(() => saveDoc(storage, state.doc), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.doc, storage]);

  const value: Store = {
    doc: state.doc,
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
