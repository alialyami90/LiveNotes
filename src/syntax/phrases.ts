import { tokenize, type Segment } from './tokenize';

// phrases.ts and tokenize.ts import each other. That is safe because every
// use of the other module's exports happens inside a function body, never
// while a module is still being evaluated.

export type Mode = 'drive' | 'walk' | 'transit' | 'bike' | 'fly';

/** Popup order; `word` is what the popup inserts. */
export const MODES: readonly { mode: Mode; word: string; label: string; icon: string }[] = [
  { mode: 'drive', word: 'drive', label: 'Drive', icon: '🚗' },
  { mode: 'walk', word: 'walk', label: 'Walk', icon: '🚶' },
  { mode: 'transit', word: 'transit', label: 'Public transport', icon: '🚆' },
  { mode: 'bike', word: 'bike', label: 'Bike', icon: '🚲' },
  { mode: 'fly', word: 'fly', label: 'Fly', icon: '✈' },
];

const MODE_WORDS: Record<Mode, string[]> = {
  drive: ['drive', 'driving', 'car', 'taxi'],
  walk: ['walk', 'walking'],
  transit: ['transit', 'train', 'bus', 'metro', 'tram'],
  bike: ['bike', 'cycle', 'cycling'],
  fly: ['fly', 'flight'],
};

const BY_WORD = new Map<string, Mode>(
  (Object.entries(MODE_WORDS) as [Mode, string[]][]).flatMap(([mode, words]) => words.map((w) => [w, mode] as const)),
);

export function modeOf(word: string): Mode | undefined {
  return BY_WORD.get(word.toLowerCase());
}

const MODE_ALT = [...BY_WORD.keys()].sort((a, b) => b.length - a.length).join('|');
const WEATHER_ALT = 'weather|forecast';
// A phrase word is a whole word and not escaped with a backslash.
const BEFORE = String.raw`(?<![\p{L}\d_\\])`;
const AFTER = String.raw`(?![\p{L}\d])`;
// R3: whitespace inside a phrase never crosses a line break.
const WS = String.raw`[^\S\n]+`;

/** A backslash directly before a phrase word; `displayText` hides it like `\@`. */
export const PHRASE_ESCAPE = new RegExp(String.raw`\\(?=(?:${MODE_ALT}|${WEATHER_ALT})${AFTER})`, 'giu');

const WEATHER_RE = new RegExp(`${BEFORE}(?:${WEATHER_ALT})${AFTER}`, 'giu');
const MODE_TO_END = new RegExp(`${BEFORE}(${MODE_ALT})${WS}to${WS}$`, 'iu');
const MODE_FROM_END = new RegExp(`${BEFORE}(${MODE_ALT})${WS}from${WS}$`, 'iu');
const TO_ONLY = new RegExp(`^${WS}to${WS}$`, 'iu');
const TO_END = new RegExp(`${BEFORE}to${WS}$`, 'iu');
const FROM_END = new RegExp(`${BEFORE}from${WS}$`, 'iu');

function pushText(out: Segment[], text: string): void {
  let last = 0;
  for (const m of text.matchAll(WEATHER_RE)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'weather', raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
}

/**
 * The tokenizer's post-pass: weather words become segments, and a mode word
 * followed by `to @X` / `from @X to @Y` is marked, with a zero-width `route`
 * segment placed right after the destination.
 */
export function recognizePhrases(segs: Segment[]): Segment[] {
  const modeWords = new Map<number, { start: number; len: number; mode: Mode }>();
  const routes = new Map<number, Segment>();

  segs.forEach((dest, i) => {
    const prev = segs[i - 1];
    if (dest.kind !== 'place' || prev?.kind !== 'text') return;
    const fromPlace = segs[i - 2];
    const fromText = segs[i - 3];

    let head: { index: number; len: number; mode: Mode } | undefined;
    let textIdx = i - 1;
    let fromKey: string | undefined;
    const direct = MODE_TO_END.exec(prev.text);
    if (direct) {
      head = { index: direct.index, len: direct[1].length, mode: modeOf(direct[1])! };
    } else if (TO_ONLY.test(prev.text) && fromPlace?.kind === 'place' && fromText?.kind === 'text') {
      const from = MODE_FROM_END.exec(fromText.text);
      if (from) {
        head = { index: from.index, len: from[1].length, mode: modeOf(from[1])! };
        textIdx = i - 3;
        fromKey = fromPlace.key;
      }
    }
    if (!head) return;

    modeWords.set(textIdx, { start: head.index, len: head.len, mode: head.mode });
    routes.set(i, { kind: 'route', mode: head.mode, ...(fromKey ? { fromKey } : {}), toKey: dest.key, raw: '' });
  });

  const out: Segment[] = [];
  segs.forEach((s, i) => {
    const word = modeWords.get(i);
    if (s.kind !== 'text') out.push(s);
    else if (!word) pushText(out, s.text);
    else {
      const end = word.start + word.len;
      pushText(out, s.text.slice(0, word.start));
      out.push({ kind: 'text', text: s.text.slice(word.start, end), mode: word.mode });
      pushText(out, s.text.slice(end));
    }
    const route = routes.get(i);
    if (route) out.push(route);
  });
  return out;
}

const TRAILING = /^[\s\p{P}]$/u;
const WORD_CHAR = /[\p{L}\d]/u;
const WORD_BEFORE = /([\p{L}\d]+)[^\S\n]+$/u;
const NOT_A_ROUTE = new Set(['next', 'close', 'near']);

/**
 * Where a mode word belongs if `text` (up to `caret`) just completed
 * "to <place>" or "from <place> to <place>" without one, else null.
 */
export function routeWithoutMode(text: string, caret: number): { at: number } | null {
  const head = text.slice(0, caret);
  const segs = tokenize(head);
  const starts: number[] = [];
  let pos = 0;
  for (const s of segs) {
    starts.push(pos);
    pos += s.kind === 'text' ? s.text.length : s.raw.length;
  }

  let pi = segs.length - 1;
  const last = segs[pi];
  if (last?.kind === 'text' && TRAILING.test(last.text)) pi--;
  else if (last?.kind === 'place' && WORD_CHAR.test(text[caret] ?? '')) return null; // caret is inside the name
  if (segs[pi]?.kind !== 'place') return null;

  const prev = segs[pi - 1];
  if (prev?.kind !== 'text') return null;

  let at: number;
  let fromForm = false;
  const fromPlace = segs[pi - 2];
  const fromText = segs[pi - 3];
  const from =
    TO_ONLY.test(prev.text) && fromPlace?.kind === 'place' && fromText?.kind === 'text'
      ? FROM_END.exec(fromText.text)
      : null;
  if (from) {
    at = starts[pi - 3] + from.index;
    fromForm = true;
  } else {
    const to = TO_END.exec(prev.text);
    if (!to) return null;
    at = starts[pi - 1] + to.index;
  }

  const word = WORD_BEFORE.exec(head.slice(0, at))?.[1].toLowerCase();
  if (word && (modeOf(word) || (!fromForm && NOT_A_ROUTE.has(word)))) return null;
  return { at };
}

export function insertModeWord(
  text: string,
  at: number,
  mode: Mode,
  caret: number,
): { text: string; caret: number } {
  const word = MODES.find((m) => m.mode === mode)!.word + ' ';
  return { text: text.slice(0, at) + word + text.slice(at), caret: caret >= at ? caret + word.length : caret };
}
