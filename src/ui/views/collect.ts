import type { Doc, NodeId, Place } from '../../model/types';
import { subtree } from '../../model/tree';
import { tokenize } from '../../syntax/tokenize';
import type { ISODate, NodeContext } from '../../context/resolve';

/** Lives in syntax/ so the library can use it too; re-exported for the views. */
export { plainText } from '../../syntax/plain';

export interface MapStop {
  nodeId: NodeId;
  key: string;
  place: Place;
  /** 1-based visit order, shown on the marker. */
  index: number;
}

/** The view's own node first, then its subtree in document order. */
const scope = (doc: Doc, id: NodeId) => [id, ...subtree(doc, id)];

export function collectPlaces(doc: Doc, contexts: Map<NodeId, NodeContext>, id: NodeId): MapStop[] {
  const stops: MapStop[] = [];
  for (const nodeId of scope(doc, id)) {
    for (const key of new Set(contexts.get(nodeId)?.ownPlaces ?? [])) {
      const place = doc.places[key];
      if (place) stops.push({ nodeId, key, place, index: stops.length + 1 });
    }
  }
  return stops;
}

export function collectDates(doc: Doc, contexts: Map<NodeId, NodeContext>, id: NodeId): Map<ISODate, NodeId[]> {
  const byDate = new Map<ISODate, NodeId[]>();
  for (const nodeId of scope(doc, id)) {
    for (const iso of new Set(contexts.get(nodeId)?.ownDates ?? [])) {
      byDate.set(iso, [...(byDate.get(iso) ?? []), nodeId]);
    }
  }
  return new Map([...byDate].sort(([a], [b]) => a.localeCompare(b)));
}

export interface UnresolvedPlace {
  key: string;
  /** The mention as first written, so messages show "São Bento", not "são bento". */
  name: string;
}

/** Mentions under the view that have no coordinates yet (pending or not found). */
export function unresolvedPlaces(doc: Doc, contexts: Map<NodeId, NodeContext>, id: NodeId): UnresolvedPlace[] {
  const found = new Map<string, UnresolvedPlace>();
  for (const nodeId of scope(doc, id)) {
    const own = contexts.get(nodeId)?.ownPlaces ?? [];
    if (!own.some((key) => !doc.places[key] && !found.has(key))) continue;
    // Contexts only keep normalized keys; the tokenizer still has the spelling.
    for (const seg of tokenize(doc.nodes[nodeId].text)) {
      if (seg.kind === 'place' && !doc.places[seg.key] && !found.has(seg.key)) found.set(seg.key, { key: seg.key, name: seg.name });
    }
  }
  return [...found.values()];
}
