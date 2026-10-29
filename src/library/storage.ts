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
export const SAMPLE_TITLE = 'Portugal road trip (sample)';

/** The sample trip as a library note: dated around `today` and titled so it reads as example content. */
export const sampleNote = (today: ISODate): Doc => ({ ...sampleDoc(new Date(`${today}T12:00:00`)), title: SAMPLE_TITLE });

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
  /** Makes one soft delete final. Other soft-deleted notes may be another tab's, still in its undo window. */
  purge(id: string): void;
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
  /** The note made from the legacy doc, until it is stored; then the legacy key can go. */
  let legacyNoteId: string | null = null;

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
        // still held; the next launch restores it from the legacy key (adoptLegacy)
      }
    }
    storage.setItem(INDEX_KEY, JSON.stringify({ version: 1, notes: next }));
    metas = next;
    for (const id of stored) pending.delete(id);
    finishLegacy();
  };

  /** The legacy key is the only copy until its note is both stored and listed. */
  function finishLegacy() {
    if (legacyNoteId === null || pending.has(legacyNoteId) || !metas.some((m) => m.id === legacyNoteId)) return;
    legacyNoteId = null;
    removeLegacy();
  }

  const removeLegacy = () => {
    try {
      storage.removeItem(LEGACY_KEY);
    } catch (e) {
      console.warn('LiveNotes: could not remove the legacy note', e);
    }
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

  // An unreadable legacy value is left alone: it is the only copy there is.
  const readLegacy = (): Doc | null => {
    const legacy = parse(get(LEGACY_KEY));
    return isDoc(legacy) ? legacy : null;
  };

  /** Note key, then index, then (for the legacy doc) the legacy key. A failure keeps it in memory. */
  function storeAtLaunch(doc: Doc, fromLegacy: boolean) {
    const meta = metaFor(newId(), doc, now());
    if (fromLegacy) legacyNoteId = meta.id;
    try {
      storage.setItem(noteKey(meta.id), JSON.stringify(doc));
      writeIndex([...metas, meta]);
    } catch (e) {
      // The legacy key stays, so the next launch retries.
      console.warn('LiveNotes: could not save the migrated note', e);
      discardOrphan(meta.id);
      metas = [...metas, meta];
      pending.set(meta.id, doc);
    }
  }

  function migrate() {
    const legacyDoc = readLegacy();
    metas = [];
    storeAtLaunch(legacyDoc ?? sampleNote(today()), !!legacyDoc);
  }

  const storedJson = (id: string): string | null => {
    const raw = get(noteKey(id));
    return raw === null ? null : JSON.stringify(parse(raw));
  };

  /**
   * A legacy doc next to an index means an earlier migration did not finish (a failed write,
   * then a later save wrote the index). Whatever happened, the legacy doc must end up as a note.
   */
  function adoptLegacy() {
    const legacy = readLegacy();
    if (!legacy) return;
    const json = JSON.stringify(legacy);
    if (metas.some((m) => storedJson(m.id) === json)) return removeLegacy();
    // Listed but its key never written: the migrated note itself, so restore it under its id.
    const want = summarize(legacy).searchText;
    const lost = metas.find((m) => get(noteKey(m.id)) === null && m.summary.searchText === want);
    if (!lost) return storeAtLaunch(legacy, true);
    legacyNoteId = lost.id;
    try {
      storage.setItem(noteKey(lost.id), json);
    } catch (e) {
      console.warn('LiveNotes: could not restore the migrated note', e);
      pending.set(lost.id, legacy);
      return;
    }
    finishLegacy();
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
    adoptLegacy();
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
