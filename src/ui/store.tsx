import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Doc, Focus, OpResult, Place } from '../model/types';
import { loadDoc, safeStorage, STORAGE_KEY } from '../model/storage';
import { resolveContexts, isoDate, type ISODate, type NodeContext } from '../context/resolve';
import type { Services } from '../services/types';
import { memoize } from '../services/memo';
import { httpServices } from '../services/http';
import { usePersistence } from './usePersistence';
import { usePlaceLookups, type PlaceStatus } from './usePlaceLookups';

export type { PlaceStatus };

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

interface Props {
  children: ReactNode;
  initialDoc?: Doc;
  services?: Services;
  /** null disables persistence (tests, or browsers with site data blocked). */
  storage?: Storage | null;
  /** Where this document lives; the legacy single-document key by default. */
  storageKey?: string;
  /** Called after each successful save, e.g. to refresh the library's summary of this note. */
  onSaved?: (doc: Doc, previousRaw: string | null) => void;
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
  storageKey = STORAGE_KEY,
  onSaved,
  today = localToday(),
  retryDelaysMs = RETRY_DELAYS_MS,
}: Props) {
  const [state, setState] = useState<State>(() => ({
    doc: initialDoc ?? loadDoc(storage ?? { getItem: () => null }, storageKey),
    focus: null,
    frozen: null,
  }));
  const services = useMemo(() => given ?? memoize(httpServices()), [given]);

  const docRef = useRef(state.doc);
  docRef.current = state.doc;

  const apply = useCallback((op: (doc: Doc) => OpResult, focus?: Focus | null) => {
    setState((s) => {
      const r = op(s.doc);
      return next(s, r.doc, focus !== undefined ? focus : (r.focus ?? s.focus));
    });
  }, []);

  const setFocus = useCallback((update: Focus | null | ((f: Focus | null) => Focus | null)) => {
    setState((s) => next(s, s.doc, typeof update === 'function' ? update(s.focus) : update));
  }, []);

  const { frozen } = state;
  const viewDoc = useMemo(() => {
    const node = frozen && state.doc.nodes[frozen.id];
    if (!frozen || !node || node.text === frozen.text) return state.doc;
    return { ...state.doc, nodes: { ...state.doc.nodes, [frozen.id]: { ...node, text: frozen.text } } };
  }, [state.doc, frozen]);

  const contexts = useMemo(() => resolveContexts(viewDoc, today), [viewDoc, today]);
  const { placeStatus, resolvePlace, retryPlace, reset } = usePlaceLookups({
    services,
    apply,
    docRef,
    viewDoc,
    contexts,
    retryDelaysMs,
  });

  /** A new document may lack places this session already looked up, so lookups start over. */
  const load = useCallback(
    (doc: Doc, keepFocus: boolean) => {
      reset();
      setState((s) => next(s, doc, keepFocus && s.focus && doc.nodes[s.focus.id] ? s.focus : null));
    },
    [reset],
  );

  const replaceDoc = useCallback((doc: Doc) => load(doc, false), [load]);

  usePersistence(storage, storageKey, state.doc, (doc) => load(doc, true), onSaved);

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
