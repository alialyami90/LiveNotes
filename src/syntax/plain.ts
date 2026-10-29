import { displayText, tokenize } from './tokenize';

/** Readable text for compact places like calendar cells; a calendar already shows the date. */
export function plainText(text: string, { dates = true } = {}): string {
  return tokenize(text)
    .map((s) => {
      if (s.kind === 'text') return displayText(s.text);
      if (s.kind === 'place') return s.name;
      if (s.kind === 'date') return dates ? s.raw : '';
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[\s—–\-:,·]+/, '')
    .trim();
}
