import type { Doc } from '../model/types';

/** Nothing worth keeping: no title and no text in any bullet. A title alone keeps the note. */
export function isBlankDoc(doc: Doc): boolean {
  if (doc.title?.trim()) return false;
  return Object.values(doc.nodes).every((n) => !n.text.trim());
}
