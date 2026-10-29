import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '../model/types';
import { sampleDoc } from '../model/sample';
import { isDoc, STORAGE_KEY } from '../model/storage';
import { createLibrary, INDEX_KEY, LEGACY_KEY, noteKey } from './storage';

afterEach(() => vi.restoreAllMocks());

/** In-memory Storage; `key`/`length` are included so index rebuild can be exercised. */
function memStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const doc = (title: string, text = 'hello'): Doc => ({
  version: 1,
  title,
  rootId: 'root',
  nodes: { root: { id: 'root', text: '', children: ['a'] }, a: { id: 'a', text: text, children: [] } },
  places: {},
});

function setup(store = memStore(), t = { now: 1_000_000 }) {
  let n = 0;
  const lib = createLibrary(store, { now: () => t.now, today: () => '2026-10-29', newId: () => `id${++n}` });
  return { store, lib, t };
}

describe('keys', () => {
  it('match the spec', () => {
    expect(INDEX_KEY).toBe('livenotes:index:v1');
    expect(LEGACY_KEY).toBe('livenotes:doc:v1');
    expect(LEGACY_KEY).toBe(STORAGE_KEY);
    expect(noteKey('x')).toBe('livenotes:note:x');
  });
});

describe('isDoc title', () => {
  it('rejects a non-string title', () => {
    expect(isDoc({ ...doc('x'), title: 5 })).toBe(false);
    expect(isDoc(doc('x'))).toBe(true);
    const { title: _t, ...untitled } = doc('x');
    expect(isDoc(untitled)).toBe(true);
  });
});

describe('migration and first launch', () => {
  it('migrates the legacy doc unchanged and removes the legacy key', () => {
    const legacy = doc('Old note');
    const { lib, store } = setup(memStore({ [LEGACY_KEY]: JSON.stringify(legacy) }));
    const [meta] = lib.list();
    expect(lib.list()).toHaveLength(1);
    expect(lib.read(meta.id)).toEqual(legacy);
    expect(meta.createdAt).toBe(1_000_000);
    expect(meta.updatedAt).toBe(1_000_000);
    expect(store.m.has(LEGACY_KEY)).toBe(false);
    expect(store.m.has(INDEX_KEY)).toBe(true);
  });

  it('keeps the legacy key when the index write fails, and still works in memory', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = doc('Old note');
    const store = memStore({ [LEGACY_KEY]: JSON.stringify(legacy) });
    const set = store.setItem;
    store.setItem = (k, v) => {
      if (k === INDEX_KEY) throw new Error('quota');
      set(k, v);
    };
    const { lib } = setup(store);
    expect(store.m.has(LEGACY_KEY)).toBe(true);
    expect(lib.list()).toHaveLength(1);
    expect(lib.read(lib.list()[0].id)).toEqual(legacy);
  });

  it('a failed migration leaves no orphan note key, and the next launch retries cleanly', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = doc('Old note');
    const store = memStore({ [LEGACY_KEY]: JSON.stringify(legacy) });
    const set = store.setItem;
    store.setItem = (k, v) => {
      if (k === INDEX_KEY) throw new Error('quota');
      set(k, v);
    };
    setup(store);
    expect([...store.m.keys()].filter((k) => k.startsWith('livenotes:note:'))).toEqual([]);
    store.setItem = set; // storage is healthy again
    const { lib } = setup(store);
    expect(lib.list()).toHaveLength(1);
    expect(lib.read(lib.list()[0].id)).toEqual(legacy);
    expect(store.m.has(LEGACY_KEY)).toBe(false);
    expect([...store.m.keys()].filter((k) => k.startsWith('livenotes:note:'))).toEqual([noteKey(lib.list()[0].id)]);
  });

  it('a failed migration followed by an index write in the same session still ends with the legacy note readable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = doc('Old note');
    const store = memStore({ [LEGACY_KEY]: JSON.stringify(legacy) });
    const set = store.setItem;
    store.setItem = () => {
      throw new Error('quota');
    };
    const { lib } = setup(store);
    store.setItem = set; // space freed later in the session
    lib.create(doc('Other'));
    const next = setup(store).lib;
    expect(store.m.has(LEGACY_KEY)).toBe(false);
    const titles = next.list().map((m) => next.read(m.id)?.title);
    expect(titles.sort()).toEqual(['Old note', 'Other']);
  });

  it("restores the legacy note under its listed id when only its note key never got written", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = doc('Old note');
    const store = memStore({ [LEGACY_KEY]: JSON.stringify(legacy) });
    const set = store.setItem;
    let indexOk = false;
    store.setItem = (k, v) => {
      if (k === noteKey('id1') || (k === INDEX_KEY && !indexOk)) throw new Error('quota');
      set(k, v);
    };
    const { lib } = setup(store);
    indexOk = true;
    lib.create(doc('Other')); // lists id1, whose key still cannot be written
    expect(store.m.get(INDEX_KEY)).toContain('id1');
    expect(store.m.has(noteKey('id1'))).toBe(false);
    store.setItem = set;
    const next = setup(store).lib;
    expect(next.list().map((m) => m.id).sort()).toEqual(['id1', 'id2']);
    expect(next.read('id1')).toEqual(legacy);
    expect(store.m.has(LEGACY_KEY)).toBe(false);
  });

  it('removes only the legacy key when a stored note already equals it', () => {
    const legacy = doc('Old note');
    const { lib, store } = setup(memStore({ [LEGACY_KEY]: JSON.stringify(legacy) }));
    expect(lib.list()).toHaveLength(1);
    store.m.set(LEGACY_KEY, JSON.stringify(legacy, null, 2)); // say its removal failed back then
    const next = setup(store).lib;
    expect(next.list()).toHaveLength(1);
    expect(store.m.has(LEGACY_KEY)).toBe(false);
    expect([...store.m.keys()].filter((k) => k.startsWith('livenotes:note:'))).toHaveLength(1);
  });

  it('migrates a legacy doc found beside an existing library as a new note', () => {
    const { lib, store } = setup();
    lib.create(doc('Existing'));
    store.m.set(LEGACY_KEY, JSON.stringify(doc('Left behind')));
    const next = setup(store).lib;
    expect(store.m.has(LEGACY_KEY)).toBe(false);
    expect(next.list().map((m) => m.summary.title)).toContain('Left behind');
    const meta = next.list().find((m) => m.summary.title === 'Left behind')!;
    expect(next.read(meta.id)?.title).toBe('Left behind');
  });

  it('saving the in-memory migrated note finishes the migration, so no older copy comes back', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore({ [LEGACY_KEY]: JSON.stringify(doc('Old note')) });
    const set = store.setItem;
    store.setItem = () => {
      throw new Error('quota');
    };
    const { lib } = setup(store);
    store.setItem = set;
    const id = lib.list()[0].id;
    lib.save(id, doc('Old note, edited'));
    expect(store.m.has(LEGACY_KEY)).toBe(false);
    const next = setup(store).lib;
    expect(next.list()).toHaveLength(1);
    expect(next.read(id)?.title).toBe('Old note, edited');
  });

  it('survives every write failing at construction (first launch)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore();
    store.setItem = () => {
      throw new Error('blocked');
    };
    const { lib } = setup(store);
    expect(lib.list()).toHaveLength(1);
    expect(lib.read(lib.list()[0].id)?.title).toBe('Portugal road trip (sample)');
  });

  it('first launch creates exactly one titled sample note', () => {
    const { lib, store } = setup();
    expect(lib.list()).toHaveLength(1);
    const [meta] = lib.list();
    expect(meta.summary.title).toBe('Portugal road trip (sample)');
    expect(lib.read(meta.id)?.title).toBe('Portugal road trip (sample)');
    expect(store.m.has(noteKey(meta.id))).toBe(true);
    // Reconstructing does not seed a second sample.
    expect(setup(store).lib.list()).toHaveLength(1);
  });

  it('an empty library stays empty (no re-seeding)', () => {
    const { lib, store } = setup();
    lib.remove(lib.list()[0].id);
    expect(setup(store).lib.list()).toHaveLength(0);
  });

  it('leaves an unreadable legacy value alone and seeds the sample', () => {
    const { lib, store } = setup(memStore({ [LEGACY_KEY]: '{broken' }));
    expect(lib.list()).toHaveLength(1);
    expect(lib.list()[0].summary.title).toBe('Portugal road trip (sample)');
    expect(store.m.get(LEGACY_KEY)).toBe('{broken');
  });
});

describe('index validation and rebuild', () => {
  it('rebuilds a corrupt index from note keys', () => {
    const { lib: a, store } = setup();
    const id = a.create(doc('Kept')).id;
    store.m.set(INDEX_KEY, '{garbage');
    const { lib } = setup(store, { now: 5_000_000 });
    const rebuilt = lib.list().find((m) => m.id === id);
    expect(rebuilt?.summary.title).toBe('Kept');
    expect(rebuilt?.updatedAt).toBe(5_000_000);
    expect(lib.list()).toHaveLength(2);
    expect(JSON.parse(store.m.get(INDEX_KEY)!).notes).toHaveLength(2);
  });

  it('rebuilds when a meta is malformed', () => {
    const { lib: a, store } = setup();
    const id = a.create(doc('Kept')).id;
    const idx = JSON.parse(store.m.get(INDEX_KEY)!);
    idx.notes[0].summary = null;
    store.m.set(INDEX_KEY, JSON.stringify(idx));
    expect(setup(store).lib.list().some((m) => m.id === id)).toBe(true);
  });

  it('treats a corrupt index as missing when storage cannot enumerate keys', () => {
    const store = memStore({ [INDEX_KEY]: 'nope' });
    const bare = { getItem: store.getItem, setItem: store.setItem, removeItem: store.removeItem };
    const lib = createLibrary(bare, { now: () => 1, today: () => '2026-10-29', newId: () => 'z' });
    expect(lib.list()).toHaveLength(1);
    expect(lib.list()[0].summary.title).toBe('Portugal road trip (sample)');
  });

  it('skips unreadable notes during rebuild', () => {
    const store = memStore({ [INDEX_KEY]: 'x', [noteKey('bad')]: '{nope', [noteKey('ok')]: JSON.stringify(doc('Fine')) });
    const { lib } = setup(store);
    expect(lib.list().map((m) => m.id)).toEqual(['ok']);
  });
});

describe('mutations', () => {
  it('create makes an empty untitled note with one empty bullet by default', () => {
    const { lib } = setup();
    const meta = lib.create();
    const d = lib.read(meta.id)!;
    expect(isDoc(d)).toBe(true);
    expect(d.title).toBeUndefined();
    expect(d.nodes[d.rootId].children).toHaveLength(1);
    expect(d.nodes[d.nodes[d.rootId].children[0]].text).toBe('');
  });

  it('save updates the summary title and updatedAt', () => {
    const { lib, t } = setup();
    const { id } = lib.create(doc('First'));
    t.now = 2_000_000;
    const meta = lib.save(id, doc('Second'));
    expect(meta.summary.title).toBe('Second');
    expect(meta.updatedAt).toBe(2_000_000);
    expect(lib.list().find((m) => m.id === id)?.summary.title).toBe('Second');
    expect(lib.read(id)?.title).toBe('Second');
  });

  it('save for an id whose meta is missing adds a fresh meta instead of dropping the edit', () => {
    const { lib, store, t } = setup();
    const { id } = lib.create(doc('First'));
    lib.remove(id);
    t.now = 3_000_000;
    const meta = lib.save(id, doc('Typed after purge'));
    expect(meta.createdAt).toBe(3_000_000);
    expect(lib.list().some((m) => m.id === id)).toBe(true);
    expect(setup(store).lib.read(id)?.title).toBe('Typed after purge');
  });

  it('pin and archive persist across a new library on the same storage', () => {
    const { lib, store } = setup();
    const { id } = lib.create(doc('P'));
    lib.setPinned(id, true);
    lib.setArchived(id, true);
    const again = setup(store).lib.list().find((m) => m.id === id)!;
    expect(again.pinned).toBe(true);
    expect(again.archived).toBe(true);
    lib.setPinned(id, false);
    expect(setup(store).lib.list().find((m) => m.id === id)!.pinned).toBeFalsy();
  });

  it('softDelete then undoDelete leaves the doc intact', () => {
    const { lib } = setup();
    const d = doc('Keep me');
    const { id } = lib.create(d);
    lib.softDelete(id);
    expect(lib.list().find((m) => m.id === id)?.deletedAt).toBe(1_000_000);
    lib.undoDelete(id);
    expect(lib.list().find((m) => m.id === id)?.deletedAt).toBeUndefined();
    expect(lib.read(id)).toEqual(d);
  });

  it('purge leaves a note that was restored meanwhile', () => {
    const { lib, store } = setup();
    const { id } = lib.create(doc('Back'));
    lib.softDelete(id);
    setup(store).lib.undoDelete(id);
    lib.purge(id);
    expect(lib.read(id)).not.toBeNull();
    expect(lib.list().some((m) => m.id === id)).toBe(true);
  });

  it('softDelete then purge removes the note key and meta, and only that one', () => {
    const { lib, store } = setup();
    const { id } = lib.create(doc('Bye'));
    const other = lib.create(doc('Stay')).id;
    const alsoDeleted = lib.create(doc('Another tab')).id;
    lib.softDelete(id);
    lib.softDelete(alsoDeleted);
    lib.purge(id);
    expect(lib.read(alsoDeleted)).not.toBeNull();
    expect(lib.list().some((m) => m.id === id)).toBe(false);
    expect(store.m.has(noteKey(id))).toBe(false);
    expect(lib.read(id)).toBeNull();
    expect(lib.read(other)).not.toBeNull();
  });

  it('remove deletes the key and meta immediately', () => {
    const { lib, store } = setup();
    const { id } = lib.create(doc('Gone'));
    lib.remove(id);
    expect(store.m.has(noteKey(id))).toBe(false);
    expect(lib.list().some((m) => m.id === id)).toBe(false);
  });

  it('read returns null for a missing or corrupt note', () => {
    const { lib, store } = setup();
    const { id } = lib.create(doc('X'));
    store.m.set(noteKey(id), '{bad');
    expect(lib.read(id)).toBeNull();
    expect(lib.read('nope')).toBeNull();
  });

  it('create removes its note key when the index write fails', () => {
    const { lib, store } = setup();
    const set = store.setItem;
    store.setItem = (k, v) => {
      if (k === INDEX_KEY) throw new Error('quota');
      set(k, v);
    };
    const before = store.m.size;
    expect(() => lib.create(doc('Nope'))).toThrow('quota');
    expect(store.m.size).toBe(before);
  });

  it('mutating methods throw write failures to the caller', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lib, store } = setup();
    const { id } = lib.create(doc('X'));
    store.setItem = () => {
      throw new Error('quota');
    };
    expect(() => lib.save(id, doc('Y'))).toThrow('quota');
    expect(() => lib.setPinned(id, true)).toThrow('quota');
    // State is unchanged by the failed write.
    expect(lib.list().find((m) => m.id === id)?.pinned).toBeFalsy();
  });
});

describe('purge on construction', () => {
  it('purges notes soft-deleted more than 6 s ago, keeps recent ones', () => {
    const { lib, store, t } = setup();
    const old = lib.create(doc('Old')).id;
    const recent = lib.create(doc('Recent')).id;
    lib.softDelete(old);
    t.now += 4_000;
    lib.softDelete(recent);
    t.now += 3_000; // old is 7 s deleted, recent 3 s
    const next = setup(store, t).lib;
    expect(next.list().some((m) => m.id === old)).toBe(false);
    expect(store.m.has(noteKey(old))).toBe(false);
    expect(next.list().find((m) => m.id === recent)?.deletedAt).toBeDefined();
    expect(store.m.has(noteKey(recent))).toBe(true);
  });

  it('boundary: exactly 6000 ms is kept, 6001 ms is purged', () => {
    const { lib, store, t } = setup();
    const id = lib.create(doc('Edge')).id;
    lib.softDelete(id);
    t.now += 6000;
    expect(setup(store, t).lib.list().some((m) => m.id === id)).toBe(true);
    t.now += 1;
    expect(setup(store, t).lib.list().some((m) => m.id === id)).toBe(false);
    expect(store.m.has(noteKey(id))).toBe(false);
  });

  it('still lists the remaining notes when purging fails at construction', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lib, store, t } = setup();
    const gone = lib.create(doc('Gone')).id;
    lib.softDelete(gone);
    t.now += 7000;
    store.setItem = () => {
      throw new Error('blocked');
    };
    const next = setup(store, t).lib;
    expect(next.list().some((m) => m.id === gone)).toBe(false);
  });
});

describe('importDoc', () => {
  it('rejects invalid JSON and invalid docs with null', () => {
    const { lib } = setup();
    const before = lib.list().length;
    expect(lib.importDoc('{nope')).toBeNull();
    expect(lib.importDoc(JSON.stringify({ version: 1 }))).toBeNull();
    expect(lib.list()).toHaveLength(before);
  });

  it('keeps an imported title in the summary', () => {
    const { lib } = setup();
    const meta = lib.importDoc(JSON.stringify(doc('Imported title')))!;
    expect(meta.summary.title).toBe('Imported title');
  });

  it('accepts a valid doc as a new note', () => {
    const { lib } = setup();
    const before = lib.list().length;
    const meta = lib.importDoc(JSON.stringify(sampleDoc()))!;
    expect(meta).not.toBeNull();
    expect(lib.list()).toHaveLength(before + 1);
    expect(lib.read(meta.id)).toEqual(sampleDoc());
  });
});

describe('reload', () => {
  it('picks up another instance writing the same storage', () => {
    const { lib, store } = setup();
    const other = createLibrary(store, { now: () => 1_000_000, today: () => '2026-10-29', newId: () => 'other-tab' });
    const { id } = other.create(doc('From another tab'));
    expect(lib.list().some((m) => m.id === id)).toBe(false);
    lib.reload();
    expect(lib.list().some((m) => m.id === id)).toBe(true);
  });
});

describe('save options', () => {
  it('touch: false recomputes the summary but keeps updatedAt', () => {
    const { lib, t } = setup();
    const { id } = lib.create(doc('Trip'));
    t.now += 5000;
    const meta = lib.save(id, doc('Trip renamed'), { touch: false });
    expect(meta.updatedAt).toBe(1_000_000);
    expect(meta.summary.title).toBe('Trip renamed');
  });

  it('writeDoc: false updates only the meta, leaving the note key alone', () => {
    const { lib, store } = setup();
    const { id } = lib.create(doc('Trip'));
    const setItem = vi.spyOn(store, 'setItem');
    lib.save(id, doc('Other'), { writeDoc: false });
    expect(setItem.mock.calls.map(([k]) => k)).toEqual([INDEX_KEY]);
    expect(lib.list().find((m) => m.id === id)?.summary.title).toBe('Other');
    expect(lib.read(id)?.title).toBe('Trip');
  });
});

describe('two tabs on one storage', () => {
  it('a stale instance never clobbers metas another instance wrote', () => {
    const store = memStore();
    const a = setup(store).lib;
    let n = 0;
    const b = createLibrary(store, { now: () => 1, today: () => '2026-10-29', newId: () => `b${++n}` });
    const fromA = a.create(doc('From A'));
    a.setPinned(fromA.id, true);
    const fromB = b.create(doc('From B')); // b has not reloaded since a's writes
    b.save(fromB.id, doc('From B, edited'));
    const fresh = () => createLibrary(store, { today: () => '2026-10-29' }).list();
    expect(fresh().find((m) => m.id === fromA.id)?.pinned).toBe(true);
    expect(fresh().map((m) => m.summary.title)).toEqual(expect.arrayContaining(['From A', 'From B, edited']));
    b.remove(fromB.id);
    expect(fresh().map((m) => m.id)).toContain(fromA.id);
    expect(fresh().map((m) => m.id)).not.toContain(fromB.id);
  });
});

describe('default newId', () => {
  it('produces distinct URL-hash-safe ids', () => {
    const lib = createLibrary(memStore(), {});
    const a = lib.create().id;
    const b = lib.create().id;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('falls back without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {});
    try {
      const lib = createLibrary(memStore(), {});
      const a = lib.create().id;
      const b = lib.create().id;
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
