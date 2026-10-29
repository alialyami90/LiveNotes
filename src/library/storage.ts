import { isoDate, type ISODate } from '../context/resolve';
import { sampleDoc } from '../model/sample';
import { isDoc, parseImport } from '../model/storage';
import type { Doc } from '../model/types';
import { emptyDoc, parse, validIndex } from './records';
import { summarizeNote } from './summarize';
import type { NoteMeta } from './types';

export const INDEX_KEY = 'livenotes:index:v1';
export const LEGACY_KEY = 'livenotes:doc:v1';
const NOTE_PREFIX = 'livenotes:note:';
export const noteKey = (id: string): string => NOTE_PREFIX + id;

/** The undo toast lasts about 5 s; anything deleted longer ago than this is final. */
const UNDO_WINDOW_MS = 6000;
const SAMPLE_TITLE = 'Portugal road trip (sample)';

/** key/length are optional so a minimal injected storage still works (index rebuild is skipped). */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>;

export interface Library {
  list(): NoteMeta[];
  read(id: string): Doc | null;
  create(doc?: Doc): NoteMeta;
  save(id: string, doc: Doc, opts?: SaveOptions): NoteMeta;
  setPinned(id: string, on: boolean): void;
  setArchived(id: string, on: boolean): void;
  softDelete(id: string): void;
  undoDelete(id: string): void;
  purgeDeleted(): void;
  remove(id: string): void;
  importDoc(json: string): NoteMeta | null;
  reload(): void;
}

export interface SaveOptions {
  /** false: the change is not the user's (e.g. a place-cache write), so updatedAt stays. Default true. */
  touch?: boolean;
  /** false: the caller already wrote the note key; only the meta is updated. Default true. */
  writeDoc?: boolean;
}

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

  /**
   * Another tab may have written the index since we last read it; every mutation
   * starts from the stored copy so it never clobbers that tab's metas.
   */
  const sync = () => {
    const stored = validIndex(parse(get(INDEX_KEY)));
    if (stored) metas = stored;
  };

  /** Memory changes only after the write succeeds, so a failed write leaves state consistent. */
  const writeIndex = (next: NoteMeta[]) => {
    storage.setItem(INDEX_KEY, JSON.stringify({ version: 1, notes: next }));
    metas = next;
  };

  function scanNotes(): NoteMeta[] | null {
    if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return null;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(NOTE_PREFIX)) keys.push(k);
    }
    const t = now();
    const out: NoteMeta[] = [];
    for (const k of keys) {
      const doc = parse(get(k));
      if (isDoc(doc)) out.push(metaFor(k.slice(NOTE_PREFIX.length), doc, t));
    }
    return out;
  }

  /** The stored index, or the rebuilt one when it is corrupt; null means there is nothing to load. */
  function loadMetas(): NoteMeta[] | null {
    const raw = get(INDEX_KEY);
    if (raw === null) return null;
    const valid = validIndex(parse(raw));
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

  function migrate() {
    const legacy = parse(get(LEGACY_KEY));
    const legacyDoc = isDoc(legacy) ? legacy : null;
    // An unreadable legacy value is left alone: it is the only copy there is.
    const doc = legacyDoc ?? { ...sampleDoc(new Date(`${today()}T12:00:00`)), title: SAMPLE_TITLE };
    const meta = metaFor(newId(), doc, now());
    metas = [meta];
    try {
      storage.setItem(noteKey(meta.id), JSON.stringify(doc));
      writeIndex(metas);
    } catch (e) {
      // Keep the legacy key so the next launch retries.
      console.warn('LiveNotes: could not save the migrated note', e);
      discardOrphan(meta.id);
      pending.set(meta.id, doc);
      return;
    }
    if (!legacyDoc) return;
    try {
      storage.removeItem(LEGACY_KEY);
    } catch (e) {
      console.warn('LiveNotes: could not remove the legacy note', e);
    }
  }

  /** A note key with no index entry is a full-size copy that a later rebuild could resurface as a duplicate. */
  const discardOrphan = (id: string) => {
    try {
      storage.removeItem(noteKey(id));
    } catch {
      // best effort: the storage is already failing
    }
  };

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
  } else {
    migrate();
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
    purgeDeleted: () => drop(metas.filter((m) => m.deletedAt !== undefined).map((m) => m.id)),
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
