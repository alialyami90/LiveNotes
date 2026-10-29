import { parseDateAt } from './dates';
import type { Mode } from './phrases';

export type Segment =
  | { kind: 'text'; text: string; mode?: Mode } // mode: a recognised route's mode word
  | { kind: 'place'; key: string; name: string; raw: string }
  | { kind: 'date'; raw: string; month: number; day: number; year?: number }
  | { kind: 'formula'; source: string; raw: string }
  | { kind: 'weather'; raw: string }
  // Sits right after the destination place; zero-width so raw/text still round-trips.
  | { kind: 'route'; mode: Mode; fromKey?: string; toKey: string; raw: '' };

export function placeKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const WORD_RE = /[\p{L}\d_'’-]*[\p{L}\d]/uy;
const WORD_CHAR = /[\p{L}\d]/u;

/** Index just past the brace that closes the one at `start`, or -1 if unclosed. */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** `@Word` or `@[Multi Word]` at `i`; the mention must not follow a word char (emails). */
export function placeAt(text: string, i: number): { name: string; end: number } | null {
  if (text[i] !== '@' || (i > 0 && WORD_CHAR.test(text[i - 1]))) return null;
  if (text[i + 1] === '[') {
    const close = text.indexOf(']', i + 2);
    if (close === -1) return null;
    const name = text.slice(i + 2, close).trim();
    return name ? { name, end: close + 1 } : null;
  }
  WORD_RE.lastIndex = i + 1;
  const m = WORD_RE.exec(text);
  return m ? { name: m[0], end: i + 1 + m[0].length } : null;
}

/** Raw scan: places, dates and formulas only. `tokenize` adds phrase recognition on top. */
export function scan(text: string): Segment[] {
  const out: Segment[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && (text[i + 1] === '@' || text[i + 1] === '{')) {
      buf += ch + text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '{') {
      const end = matchBrace(text, i);
      if (end !== -1) {
        flush();
        const raw = text.slice(i, end);
        out.push({ kind: 'formula', source: raw.slice(1, -1), raw });
        i = end;
        continue;
      }
    } else if (ch === '@') {
      const p = placeAt(text, i);
      if (p) {
        flush();
        out.push({ kind: 'place', key: placeKey(p.name), name: p.name, raw: text.slice(i, p.end) });
        i = p.end;
        continue;
      }
    } else {
      const d = parseDateAt(text, i);
      if (d) {
        flush();
        const { len, ...date } = d;
        out.push({ kind: 'date', raw: text.slice(i, i + len), ...date });
        i += len;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}
