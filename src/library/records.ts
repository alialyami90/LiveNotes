/** Stored records: tolerant parsing and the shape checks home relies on. */
import type { Doc } from '../model/types';
import type { NoteMeta } from './types';

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

/** A structurally bad index would crash home, so check what home reads. */
export function validIndex(v: unknown): NoteMeta[] | null {
  const idx = v as { version?: unknown; notes?: unknown } | null | undefined;
  if (!idx || idx.version !== 1 || !Array.isArray(idx.notes)) return null;
  const ok = idx.notes.every((m: Partial<NoteMeta> | null) =>
    !!m && typeof m.id === 'string' && typeof m.createdAt === 'number' && typeof m.updatedAt === 'number' &&
    !!m.summary && typeof m.summary === 'object');
  return ok ? (idx.notes as NoteMeta[]) : null;
}
