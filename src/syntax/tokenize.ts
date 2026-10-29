import { PHRASE_ESCAPE, recognizePhrases } from './phrases';
import { scan, type Segment } from './scan';

export { placeAt, placeKey, type Segment } from './scan';

/** Text segments keep escapes so raw text round-trips; this is what readers see. */
export function displayText(text: string): string {
  return text.replace(/\\([@{])/g, '$1').replace(PHRASE_ESCAPE, '');
}

/** Splits node text into segments; concatenating every `raw`/`text` reproduces the input. */
export function tokenize(text: string): Segment[] {
  return recognizePhrases(scan(text));
}
