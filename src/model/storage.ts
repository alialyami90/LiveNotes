import type { Doc } from './types';
import { sampleDoc } from './sample';

export const STORAGE_KEY = 'livenotes:doc:v1';

function isDoc(v: unknown): v is Doc {
  if (!v || typeof v !== 'object') return false;
  const d = v as Doc;
  return d.version === 1 && typeof d.rootId === 'string' && !!d.nodes?.[d.rootId] && typeof d.places === 'object';
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
