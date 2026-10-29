import type { Doc, NodeId } from '../model/types';
import { tokenize } from '../syntax/tokenize';

/** `YYYY-MM-DD` */
export type ISODate = string;

export interface NodeContext {
  /** Effective place: last own mention, else inherited. */
  placeKey?: string;
  /** Effective date: last own mention, else inherited. */
  date?: ISODate;
  ownPlaces: string[];
  ownDates: ISODate[];
  /** Previous sibling's effective place, or the parent's for a first child. */
  prevPlaceKey?: string;
  /** The parent's effective place: biases lookups of this node's own mentions. */
  inheritedPlaceKey?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ROLLOVER_DAYS = 183;

/** Days since 1970-01-01 (UTC), so date arithmetic never touches time zones. */
export const dayNumber = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/**
 * Plans look forward: a yearless date that would land more than ~6 months
 * before its reference date (parent's date, else today) means next year,
 * so "Jan 2" under "Dec 30 2026" is 2027-01-02.
 */
function yearFor(month: number, day: number, reference: ISODate): number {
  const year = Number(reference.slice(0, 4));
  const candidate = isoDate(year, month, day);
  return dayNumber(candidate) < dayNumber(reference) - ROLLOVER_DAYS ? year + 1 : year;
}
export const isoDate = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;

/** One top-down pass so inherited context (and the year for yearless dates) flows from ancestors. */
export function resolveContexts(doc: Doc, today: ISODate): Map<NodeId, NodeContext> {
  const out = new Map<NodeId, NodeContext>();

  const visit = (id: NodeId, inherited: NodeContext, prevPlaceKey: string | undefined) => {
    const ownPlaces: string[] = [];
    const ownDates: ISODate[] = [];
    let reference = inherited.date ?? today;
    for (const seg of tokenize(doc.nodes[id].text)) {
      if (seg.kind === 'place') ownPlaces.push(seg.key);
      else if (seg.kind === 'date') {
        reference = isoDate(seg.year ?? yearFor(seg.month, seg.day, reference), seg.month, seg.day);
        ownDates.push(reference);
      }
    }
    const ctx: NodeContext = {
      placeKey: ownPlaces.at(-1) ?? inherited.placeKey,
      date: ownDates.at(-1) ?? inherited.date,
      ownPlaces,
      ownDates,
      prevPlaceKey,
      inheritedPlaceKey: inherited.placeKey,
    };
    out.set(id, ctx);
    visitChildren(id, ctx);
  };

  const visitChildren = (id: NodeId, ctx: NodeContext) => {
    let prev = ctx.placeKey;
    for (const child of doc.nodes[id].children) {
      visit(child, ctx, prev);
      prev = out.get(child)!.placeKey;
    }
  };

  visitChildren(doc.rootId, { ownPlaces: [], ownDates: [] });
  return out;
}
