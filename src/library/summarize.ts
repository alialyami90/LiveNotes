import { resolveContexts, type ISODate } from '../context/resolve';
import { subtree } from '../model/tree';
import type { Doc } from '../model/types';
import { plainText } from '../syntax/plain';
import { tokenize } from '../syntax/tokenize';
import { foldText } from './text';
import type { NoteSummary } from './types';

const MAX_PLACES = 8;
const PREVIEW_CHARS = 140;

/** Everything home needs from a note, so it never has to parse the notes themselves. */
export function summarizeNote(doc: Doc, today: ISODate): NoteSummary {
  const contexts = resolveContexts(doc, today);
  const order = subtree(doc, doc.rootId);

  const dates: ISODate[] = [];
  const places: NoteSummary['places'] = [];
  const placeNames: string[] = [];
  const seen = new Set<string>();
  const lines: { id: string; text: string }[] = [];

  for (const id of order) {
    const text = doc.nodes[id].text;
    dates.push(...(contexts.get(id)?.ownDates ?? []));
    for (const seg of tokenize(text)) {
      if (seg.kind !== 'place' || seen.has(seg.key)) continue;
      seen.add(seg.key);
      placeNames.push(seg.name);
      const p = doc.places[seg.key];
      if (p && places.length < MAX_PLACES) places.push({ name: p.name, lat: p.lat, lon: p.lon });
    }
    const plain = plainText(text);
    if (plain) lines.push({ id, text: plain });
  }

  // An explicit title is not a bullet, so every bullet is body text then.
  const firstTop = doc.nodes[doc.rootId].children[0];
  const title = doc.title?.trim() || (firstTop ? plainText(doc.nodes[firstTop].text) : '');
  const body = doc.title?.trim() ? lines : lines.filter((l) => l.id !== firstTop);

  const sorted = [...dates].sort();
  return {
    title,
    from: sorted[0],
    to: sorted.at(-1),
    places,
    placeNames,
    preview: body.map((l) => l.text).join(' ').slice(0, PREVIEW_CHARS).trim(),
    searchText: foldText([title, ...lines.map((l) => l.text), ...placeNames].join(' ')),
  };
}
