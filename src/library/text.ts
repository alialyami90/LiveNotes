/** Search folding: case, accents and whitespace never decide a match ("Évora" finds "evora"). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
