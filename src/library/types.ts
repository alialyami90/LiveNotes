import type { ISODate } from '../context/resolve';

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
