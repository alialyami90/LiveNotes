/**
 * Notes made at launch: the first-launch note (the old single document, else the sample) and
 * the adoption of a legacy document an earlier launch could not finish migrating.
 *
 * The note made from the legacy document carries `legacy: true` in the index. That marker,
 * not its content, ties the note to `livenotes:doc:v1`: the note may have been edited since,
 * and once it is deleted the legacy key must go with it, or the next launch would bring it back.
 */
import { isDoc } from '../model/storage';
import type { Doc } from '../model/types';
import { LEGACY_KEY, noteKey, parse } from './records';
import type { NoteMeta } from './types';

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
  sample(): Doc;
}

export interface Legacy {
  /** First launch (no index): the legacy document, else the sample, becomes the first note. */
  migrate(): void;
  /** A launch with an index: a legacy document still present must end up as a note. */
  adopt(): void;
  /** After each index write: once the adopted note is stored and listed, the legacy key goes. */
  finish(): void;
  /** After metas are dropped, or would have been (a failed purge): an adopted one retires the key. */
  dropped(gone: NoteMeta[]): void;
}

export function createLegacy(ctx: LegacyContext): Legacy {
  /** The legacy key still holds the only stored copy of the adopted note. */
  let open = false;
  /** Its note was deleted this launch: never adopt the key again, even if removing it failed. */
  let retired = false;

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
    const meta: NoteMeta = { ...ctx.newMeta(doc), ...(fromLegacy ? { legacy: true as const } : {}) };
    if (fromLegacy) open = true;
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

  return {
    migrate() {
      const legacyDoc = readLegacy();
      ctx.setMetas([]);
      storeAtLaunch(legacyDoc ?? ctx.sample(), !!legacyDoc);
    },

    adopt() {
      if (retired) return;
      const doc = readLegacy();
      if (!doc) return;
      const adopted = ctx.metas().find((m) => m.legacy);
      if (!adopted) return storeAtLaunch(doc, true);
      // Its note key exists: the note holds the data (perhaps edited since), so the key is stale.
      if (ctx.get(noteKey(adopted.id)) !== null) return removeLegacy();
      // Listed but never stored (a failed write, then a later index write): restore it in place.
      try {
        ctx.setItem(noteKey(adopted.id), JSON.stringify(doc));
      } catch (e) {
        console.warn('LiveNotes: could not restore the migrated note', e);
        ctx.pending.set(adopted.id, doc);
        open = true;
        return;
      }
      removeLegacy();
    },

    finish() {
      if (!open) return;
      const adopted = ctx.metas().find((m) => m.legacy);
      if (!adopted || ctx.pending.has(adopted.id)) return;
      open = false;
      removeLegacy();
    },

    dropped(gone) {
      if (!gone.some((m) => m.legacy)) return;
      open = false;
      retired = true;
      removeLegacy();
    },
  };
}
