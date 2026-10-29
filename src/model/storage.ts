import type { Doc } from './types';
import { sampleDoc } from './sample';

export const STORAGE_KEY = 'livenotes:doc:v1';

/** Full structural check: a doc that parses but has a broken tree would crash every render. */
export function isDoc(v: unknown): v is Doc {
  if (!v || typeof v !== 'object') return false;
  const d = v as Doc;
  if (d.version !== 1 || typeof d.rootId !== 'string') return false;
  if (d.title !== undefined && typeof d.title !== 'string') return false;
  if (!d.places || typeof d.places !== 'object' || !d.nodes || typeof d.nodes !== 'object') return false;
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    const n = d.nodes[id];
    if (seen.has(id) || !n || n.id !== id || typeof n.text !== 'string' || !Array.isArray(n.children)) return false;
    seen.add(id);
    return n.children.every((c) => typeof c === 'string' && walk(c));
  };
  return walk(d.rootId);
}

/** localStorage throws when site data is blocked; run without persistence then. */
export function safeStorage(get: () => Storage = () => window.localStorage): Storage | null {
  try {
    return get();
  } catch {
    return null;
  }
}

/** Anything unreadable falls back to the sample rather than a blank screen. */
export function loadDoc(storage: Pick<Storage, 'getItem'>): Doc {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isDoc(parsed)) return parsed;
    }
  } catch {
    // fall through to the sample
  }
  return sampleDoc();
}

export function saveDoc(storage: Pick<Storage, 'setItem'>, doc: Doc): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

export function parseImport(json: string): Doc | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
