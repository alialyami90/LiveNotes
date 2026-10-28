import { placeAt, placeKey } from '../syntax/tokenize';

export type Unit = 'km' | 'm' | 'h' | 'min' | 'd';
const UNITS = new Set<string>(['km', 'm', 'h', 'min', 'd']);

export type Token =
  | { t: 'num'; value: number; unit?: Unit }
  | { t: 'str'; value: string }
  | { t: 'place'; key: string; name: string }
  | { t: 'date'; iso: string }
  | { t: 'ident'; name: string }
  | { t: 'punct'; value: '(' | ')' | ',' | '.' | '+' | '-' | '*' | '/' }
  | { t: 'eof' };

const ISO = /\d{4}-\d{2}-\d{2}(?!\d)/y;
const NUM = /(\d+(?:\.\d+)?)([A-Za-z]*)/y;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

export function lex(src: string): Token[] | { error: string } {
  const out: Token[] = [];
  let i = 0;
  const at = (re: RegExp) => {
    re.lastIndex = i;
    return re.exec(src);
  };
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = at(ISO))) {
      out.push({ t: 'date', iso: m[0] });
      i += m[0].length;
    } else if ((m = at(NUM))) {
      const [all, num, unit] = m;
      if (unit && !UNITS.has(unit)) return { error: `unknown unit "${unit}"` };
      out.push(unit ? { t: 'num', value: Number(num), unit: unit as Unit } : { t: 'num', value: Number(num) });
      i += all.length;
    } else if ((m = at(IDENT))) {
      out.push({ t: 'ident', name: m[0].toLowerCase() });
      i += m[0].length;
    } else if (ch === '@') {
      const p = placeAt(src, i);
      if (!p) return { error: 'expected a place name after @' };
      out.push({ t: 'place', key: placeKey(p.name), name: p.name });
      i = p.end;
    } else if (ch === '"' || ch === "'") {
      const close = src.indexOf(ch, i + 1);
      if (close === -1) return { error: 'unclosed string' };
      out.push({ t: 'str', value: src.slice(i + 1, close) });
      i = close + 1;
    } else if ('(),.+-*/'.includes(ch)) {
      out.push({ t: 'punct', value: ch as '(' });
      i++;
    } else {
      return { error: `unexpected "${ch}"` };
    }
  }
  out.push({ t: 'eof' });
  return out;
}
