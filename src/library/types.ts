import type { ISODate } from '../context/resolve';
import type { Doc } from '../model/types';

export interface NoteSummary {
  /** Doc.title, else the first top-level bullet as plain text, else ''. */
  title: string;
  /** Earliest / latest own date anywhere in the note. */
  from?: ISODate;
  to?: ISODate;
  /** Resolved places, document order, max 8. */
  places: { name: string; lat: number; lon: number }[];
  /** As written, for search (includes unresolved). */
  placeNames: string[];
  /** First ~140 chars of plain text after the title line. */
  preview: string;
  /** Lowercased, accent-folded title + text + places. */
  searchText: string;
}

export interface NoteMeta {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  /** Epoch ms; a deleted note is kept only until it is purged. */
  deletedAt?: number;
  /** Recomputed on every save, so home never parses every note. */
  summary: NoteSummary;
}

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
