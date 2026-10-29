/** Stored records: tolerant parsing and the shape checks home relies on. */
import type { Doc } from '../model/types';
import type { NoteMeta, NoteSummary } from './types';

export const emptyDoc = (): Doc => ({
  version: 1,
  rootId: 'root',
  nodes: { root: { id: 'root', text: '', children: ['b1'] }, b1: { id: 'b1', text: '', children: [] } },
  places: {},
});

export function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Exactly the fields home reads; one bad field would otherwise take the whole screen down. */
export function validSummary(v: unknown): v is NoteSummary {
  const s = v as Partial<Record<keyof NoteSummary, unknown>> | null | undefined;
  if (!s || typeof s !== 'object') return false;
  const place = (p: unknown) => {
    const q = p as { name?: unknown; lat?: unknown; lon?: unknown } | null;
    return !!q && isStr(q.name) && isNum(q.lat) && isNum(q.lon);
  };
  return (
    isStr(s.title) && isStr(s.preview) && isStr(s.searchText) &&
    (s.from === undefined || isStr(s.from)) && (s.to === undefined || isStr(s.to)) &&
    Array.isArray(s.places) && s.places.every(place) &&
    Array.isArray(s.placeNames) && s.placeNames.every(isStr)
  );
}

/**
 * A structurally bad index (null means rebuild it from the note keys). A meta whose summary
 * is malformed is passed to `repair`, which recomputes it or returns null to leave it out.
 */
export function validIndex(v: unknown, repair: (m: NoteMeta) => NoteMeta | null = () => null): NoteMeta[] | null {
  const idx = v as { version?: unknown; notes?: unknown } | null | undefined;
  if (!idx || idx.version !== 1 || !Array.isArray(idx.notes)) return null;
  const ok = idx.notes.every((m: Partial<NoteMeta> | null) =>
    !!m && typeof m.id === 'string' && typeof m.createdAt === 'number' && typeof m.updatedAt === 'number');
  if (!ok) return null;
  const out: NoteMeta[] = [];
  for (const m of idx.notes as NoteMeta[]) {
    const fixed = validSummary(m.summary) ? m : repair(m);
    if (fixed) out.push(fixed);
  }
  return out;
}
