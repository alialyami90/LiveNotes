/** The `@` mention the caret is in, for the place picker. `end` covers the whole token. */
export interface ActiveMention {
  start: number;
  end: number;
  query: string;
  bracket: boolean;
}

const WORD = /^[\p{L}\d_'’-]*/u;
const WORD_ONLY = /^[\p{L}\d_'’-]*$/u;
const WORD_CHAR = /[\p{L}\d]/u;

export function activeMention(text: string, caret: number): ActiveMention | null {
  const start = text.lastIndexOf('@', caret - 1);
  if (start < 0 || (start > 0 && (WORD_CHAR.test(text[start - 1]) || text[start - 1] === '\\'))) return null;

  if (text[start + 1] === '[') {
    const typed = text.slice(start + 2, caret);
    if (typed.includes(']')) return null;
    const close = text.indexOf(']', caret);
    const closed = close >= 0 && !text.slice(caret, close).includes('@');
    const end = closed ? close + 1 : caret;
    return { start, end, query: text.slice(start + 2, closed ? close : caret), bracket: true };
  }

  const typed = text.slice(start + 1, caret);
  if (!WORD_ONLY.test(typed)) return null;
  const end = caret + (WORD.exec(text.slice(caret))?.[0].length ?? 0);
  return { start, end, query: text.slice(start + 1, end), bracket: false };
}

/** Replaces the mention with the picked name; returns the new text and where the caret goes. */
export function insertMention(text: string, m: ActiveMention, name: string): { text: string; caret: number } {
  const clean = name.replace(/[[\]]/g, '').trim();
  // Same rule as the tokenizer's @Word, so the inserted mention reads back as this name.
  const token = /^[\p{L}\d_'’-]*[\p{L}\d]$/u.test(clean) ? `@${clean}` : `@[${clean}]`;
  const after = text.slice(m.end);
  const spacer = after === '' || /^[\p{L}\d]/u.test(after) ? ' ' : '';
  const replaced = text.slice(0, m.start) + token + spacer;
  return { text: replaced + after, caret: replaced.length };
}
