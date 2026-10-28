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
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;

/** One top-down pass so inherited context (and the year for yearless dates) flows from ancestors. */
export function resolveContexts(doc: Doc, today: ISODate): Map<NodeId, NodeContext> {
  const out = new Map<NodeId, NodeContext>();
  const todayYear = Number(today.slice(0, 4));

  const visit = (id: NodeId, inherited: NodeContext, prevPlaceKey: string | undefined) => {
    const ownPlaces: string[] = [];
    const ownDates: ISODate[] = [];
    let year = inherited.date ? Number(inherited.date.slice(0, 4)) : todayYear;
    for (const seg of tokenize(doc.nodes[id].text)) {
      if (seg.kind === 'place') ownPlaces.push(seg.key);
      else if (seg.kind === 'date') {
        if (seg.year) year = seg.year;
        ownDates.push(isoDate(seg.year ?? year, seg.month, seg.day));
      }
    }
    const ctx: NodeContext = {
      placeKey: ownPlaces.at(-1) ?? inherited.placeKey,
      date: ownDates.at(-1) ?? inherited.date,
      ownPlaces,
      ownDates,
      prevPlaceKey,
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
