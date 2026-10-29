/**
 * Notes made at launch: the first-launch note (the old single document, else the sample) and
 * the adoption of a legacy document an earlier launch could not finish migrating.
 */
import { isDoc } from '../model/storage';
import type { Doc } from '../model/types';
import { LEGACY_KEY, noteKey, parse } from './records';
import type { NoteMeta, NoteSummary } from './types';

export interface LegacyContext {
  /** Raw storage writes; these throw on quota or blocked storage. */
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Never throws: an unreadable key reads as null. */
  get(key: string): string | null;
  /** Notes whose first write failed, held so the session still works. */
  pending: Map<string, Doc>;
  metas(): NoteMeta[];
  setMetas(next: NoteMeta[]): void;
  /** A fresh meta (new id, now) for `doc`. */
  newMeta(doc: Doc): NoteMeta;
  writeIndex(next: NoteMeta[]): void;
  discardOrphan(id: string): void;
  summarize(doc: Doc): NoteSummary;
  sample(): Doc;
}

export interface Legacy {
  /** First launch (no index): the legacy document, else the sample, becomes the first note. */
  migrate(): void;
  /** A launch with an index: a legacy document still present must end up as a note. */
  adopt(): void;
  /** After each index write: once the legacy note is stored and listed, the legacy key goes. */
  finish(): void;
}

export function createLegacy(ctx: LegacyContext): Legacy {
  /** The note made from the legacy doc, until it is stored; then the legacy key can go. */
  let legacyNoteId: string | null = null;

  const removeLegacy = () => {
    try {
      ctx.removeItem(LEGACY_KEY);
    } catch (e) {
      console.warn('LiveNotes: could not remove the legacy note', e);
    }
  };

  // An unreadable legacy value is left alone: it is the only copy there is.
  const readLegacy = (): Doc | null => {
    const legacy = parse(ctx.get(LEGACY_KEY));
    return isDoc(legacy) ? legacy : null;
  };

  /** Note key, then index (whose write calls finish(), removing the legacy key). A failure holds it in memory. */
  function storeAtLaunch(doc: Doc, fromLegacy: boolean) {
    const meta = ctx.newMeta(doc);
    if (fromLegacy) legacyNoteId = meta.id;
    try {
      ctx.setItem(noteKey(meta.id), JSON.stringify(doc));
      ctx.writeIndex([...ctx.metas(), meta]);
    } catch (e) {
      // The legacy key stays, so the next launch retries.
      console.warn('LiveNotes: could not save the migrated note', e);
      ctx.discardOrphan(meta.id);
      ctx.setMetas([...ctx.metas(), meta]);
      ctx.pending.set(meta.id, doc);
    }
  }

  const storedJson = (id: string): string | null => {
    const raw = ctx.get(noteKey(id));
    return raw === null ? null : JSON.stringify(parse(raw));
  };

  function finish() {
    if (legacyNoteId === null || ctx.pending.has(legacyNoteId) || !ctx.metas().some((m) => m.id === legacyNoteId)) return;
    legacyNoteId = null;
    removeLegacy();
  }

  return {
    migrate() {
      const legacyDoc = readLegacy();
      ctx.setMetas([]);
      storeAtLaunch(legacyDoc ?? ctx.sample(), !!legacyDoc);
    },

    adopt() {
      const legacy = readLegacy();
      if (!legacy) return;
      const json = JSON.stringify(legacy);
      if (ctx.metas().some((m) => storedJson(m.id) === json)) return removeLegacy();
      // Listed but its key never written: the migrated note itself, so restore it under its id.
      const want = ctx.summarize(legacy).searchText;
      const lost = ctx.metas().find((m) => ctx.get(noteKey(m.id)) === null && m.summary.searchText === want);
      if (!lost) return storeAtLaunch(legacy, true);
      legacyNoteId = lost.id;
      try {
        ctx.setItem(noteKey(lost.id), json);
      } catch (e) {
        console.warn('LiveNotes: could not restore the migrated note', e);
        ctx.pending.set(lost.id, legacy);
        return;
      }
      finish();
    },

    finish,
  };
}
