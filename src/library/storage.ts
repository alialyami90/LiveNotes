import { isoDate, type ISODate } from '../context/resolve';
import { sampleDoc } from '../model/sample';
import { isDoc, parseImport } from '../model/storage';
import type { Doc } from '../model/types';
import { createLegacy } from './legacy';
import { emptyDoc, INDEX_KEY, noteKey, parse, storedNoteIds, validIndex } from './records';
import { summarizeNote } from './summarize';
import type { Library, NoteMeta } from './types';

export { INDEX_KEY, LEGACY_KEY, noteKey } from './records';
export type { Library, SaveOptions } from './types';

/** The undo toast lasts about 5 s; anything deleted longer ago than this is final. */
const UNDO_WINDOW_MS = 6000;
export const SAMPLE_TITLE = 'Portugal road trip (sample)';

/** The sample trip as a library note: dated around `today` and titled so it reads as example content. */
export const sampleNote = (today: ISODate): Doc => ({ ...sampleDoc(new Date(`${today}T12:00:00`)), title: SAMPLE_TITLE });

/** key/length are optional so a minimal injected storage still works (index rebuild is skipped). */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>;

interface Options {
  now?: () => number;
  today?: () => ISODate;
  newId?: () => string;
}

// Ids end up in `#/note/<id>`, so the fallback sticks to [0-9a-z].
const defaultId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const defaultToday = (): ISODate => {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

export function createLibrary(storage: Store, opts: Options = {}): Library {
  const now = opts.now ?? Date.now;
  const today = opts.today ?? defaultToday;
  const newId = opts.newId ?? defaultId;

  let metas: NoteMeta[] = [];
  /** Notes whose first write failed at construction; kept so the session still works. */
  const pending = new Map<string, Doc>();

  const get = (k: string): string | null => {
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  };
  const summarize = (doc: Doc) => summarizeNote(doc, today());
  const metaFor = (id: string, doc: Doc, t: number): NoteMeta => ({ id, createdAt: t, updatedAt: t, summary: summarize(doc) });

  /** A meta whose summary is malformed is recomputed from its note; with no readable note it is left out. */
  const repair = (m: NoteMeta): NoteMeta | null => {
    const doc = pending.get(m.id) ?? parse(get(noteKey(m.id)));
    return isDoc(doc) ? { ...m, summary: summarize(doc) } : null;
  };
  const readIndex = (raw: string | null) => validIndex(parse(raw), repair);

  /**
   * Another tab may have written the index since we last read it; every mutation
   * starts from the stored copy so it never clobbers that tab's metas.
   */
  const sync = () => {
    const stored = readIndex(get(INDEX_KEY));
    if (!stored) return;
    // A note held in memory is in no stored index yet; keep it, so the next index write stores it.
    const held = metas.filter((m) => pending.has(m.id) && !stored.some((s) => s.id === m.id));
    metas = [...stored, ...held];
  };

  /**
   * Memory changes only after the write succeeds, so a failed write leaves state consistent.
   * Notes held in memory are stored first, so the index never lists one whose key was never tried.
   */
  const writeIndex = (next: NoteMeta[]) => {
    const stored: string[] = [];
    for (const [id, doc] of pending) {
      if (!next.some((m) => m.id === id)) continue;
      try {
        storage.setItem(noteKey(id), JSON.stringify(doc));
        stored.push(id);
      } catch {
        // still held; the next launch restores it from the legacy key (legacy.adopt)
      }
    }
    storage.setItem(INDEX_KEY, JSON.stringify({ version: 1, notes: next }));
    metas = next;
    for (const id of stored) pending.delete(id);
    legacy.finish();
  };

  function scanNotes(): NoteMeta[] | null {
    const ids = storedNoteIds(storage);
    if (!ids) return null;
    const t = now();
    const out: NoteMeta[] = [];
    for (const id of ids) {
      const doc = parse(get(noteKey(id)));
      if (isDoc(doc)) out.push(metaFor(id, doc, t));
    }
    return out;
  }

  /** The stored index, or the rebuilt one when it is corrupt; null means there is nothing to load. */
  function loadMetas(): NoteMeta[] | null {
    const raw = get(INDEX_KEY);
    if (raw === null) return null;
    const valid = readIndex(raw);
    if (valid) return valid;
    const rebuilt = scanNotes();
    if (!rebuilt || rebuilt.length === 0) return null;
    try {
      writeIndex(rebuilt);
    } catch (e) {
      console.warn('LiveNotes: could not save the rebuilt index', e);
    }
    return rebuilt;
  }

  /** A note key with no index entry is a full-size copy that a later rebuild could resurface as a duplicate. */
  const discardOrphan = (id: string) => {
    try {
      storage.removeItem(noteKey(id));
    } catch {
      // best effort: the storage is already failing
    }
  };

  const legacy = createLegacy({
    setItem: (k, v) => storage.setItem(k, v),
    removeItem: (k) => storage.removeItem(k),
    get,
    pending,
    metas: () => metas,
    setMetas: (next) => void (metas = next),
    newMeta: (doc) => metaFor(newId(), doc, now()),
    writeIndex,
    discardOrphan,
    summarize,
    sample: () => sampleNote(today()),
  });

  const add = (doc: Doc): NoteMeta => {
    sync();
    const meta = metaFor(newId(), doc, now());
    storage.setItem(noteKey(meta.id), JSON.stringify(doc));
    try {
      writeIndex([...metas, meta]);
    } catch (e) {
      discardOrphan(meta.id);
      throw e;
    }
    return meta;
  };

  /** Index goes first: a failure then leaves an orphan note key, never a meta without a note. */
  const drop = (ids: string[]) => {
    sync();
    writeIndex(metas.filter((m) => !ids.includes(m.id)));
    for (const id of ids) {
      pending.delete(id);
      storage.removeItem(noteKey(id));
    }
  };

  function purgeStale() {
    const t = now();
    const stale = metas.filter((m) => m.deletedAt !== undefined && t - m.deletedAt > UNDO_WINDOW_MS).map((m) => m.id);
    if (stale.length === 0) return;
    try {
      drop(stale);
    } catch (e) {
      console.warn('LiveNotes: could not purge deleted notes', e);
      metas = metas.filter((m) => !stale.includes(m.id)); // retried on the next launch
    }
  }

  const patch = (id: string, fn: (m: NoteMeta) => NoteMeta) => {
    sync();
    if (!metas.some((m) => m.id === id)) return;
    writeIndex(metas.map((m) => (m.id === id ? fn(m) : m)));
  };

  const loaded = loadMetas();
  if (loaded) {
    metas = loaded;
    purgeStale();
    legacy.adopt();
  } else {
    legacy.migrate();
  }

  return {
    list: () => metas,
    read(id) {
      const mem = pending.get(id);
      if (mem) return mem;
      const doc = parse(get(noteKey(id)));
      return isDoc(doc) ? doc : null;
    },
    create: (doc) => add(doc ?? emptyDoc()),
    save(id, doc, { touch = true, writeDoc = true } = {}) {
      sync();
      const existing = metas.find((m) => m.id === id);
      const t = now();
      // A note purged by another tab while open is re-added rather than losing typed text.
      const meta: NoteMeta = {
        ...(existing ?? { id, createdAt: t, updatedAt: t }),
        ...(touch ? { updatedAt: t } : {}),
        summary: summarize(doc),
      };
      if (writeDoc) storage.setItem(noteKey(id), JSON.stringify(doc));
      pending.delete(id);
      writeIndex(existing ? metas.map((m) => (m.id === id ? meta : m)) : [...metas, meta]);
      return meta;
    },
    setPinned: (id, on) => patch(id, (m) => ({ ...m, pinned: on })),
    setArchived: (id, on) => patch(id, (m) => ({ ...m, archived: on })),
    softDelete: (id) => patch(id, (m) => ({ ...m, deletedAt: now() })),
    undoDelete: (id) =>
      patch(id, (m) => {
        const { deletedAt: _gone, ...rest } = m;
        return rest;
      }),
    purge(id) {
      sync();
      // Restored meanwhile (another tab's Undo): nothing to make final.
      if (metas.find((m) => m.id === id)?.deletedAt === undefined) return;
      drop([id]);
    },
    remove: (id) => drop([id]),
    importDoc(json) {
      const doc = parseImport(json);
      return doc ? add(doc) : null;
    },
    reload() {
      const next = loadMetas();
      if (next) metas = next;
    },
  };
}
