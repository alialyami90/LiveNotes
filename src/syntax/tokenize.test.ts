import { describe, expect, it } from 'vitest';
import { displayText, placeKey, tokenize, type Segment } from './tokenize';

const raw = (s: Segment) => (s.kind === 'text' ? s.text : s.raw);

describe('tokenize', () => {
  it('finds single-word and bracketed place mentions; punctuation stays text', () => {
    const segs = tokenize('arrive @Lisbon, then @[Time Out Market]');
    expect(segs).toEqual([
      { kind: 'text', text: 'arrive ' },
      { kind: 'place', key: 'lisbon', name: 'Lisbon', raw: '@Lisbon' },
      { kind: 'text', text: ', then ' },
      { kind: 'place', key: 'time out market', name: 'Time Out Market', raw: '@[Time Out Market]' },
    ]);
  });

  it('keeps accented letters in single-word mentions', () => {
    expect(tokenize('@Évora!')[0]).toMatchObject({ kind: 'place', name: 'Évora' });
  });

  it('treats a lone @ or email-ish text as text', () => {
    expect(tokenize('me @ home').every((s) => s.kind === 'text')).toBe(true);
    expect(tokenize('a@b.com').every((s) => s.kind === 'text')).toBe(true);
  });

  it('finds dates', () => {
    const segs = tokenize('Nov 3 — arrive');
    expect(segs[0]).toEqual({ kind: 'date', raw: 'Nov 3', month: 11, day: 3 });
  });

  it('a formula hides dates inside its braces', () => {
    const segs = tokenize('{days(2026-11-03, 2026-11-07)} on Nov 3');
    expect(segs.map((s) => s.kind)).toEqual(['formula', 'text', 'date']);
    expect(segs[0]).toMatchObject({ source: 'days(2026-11-03, 2026-11-07)' });
  });

  it('nested braces stay in one formula', () => {
    expect(tokenize('{a{b}c}')).toEqual([{ kind: 'formula', source: 'a{b}c', raw: '{a{b}c}' }]);
  });

  it('an unclosed brace is plain text (user still typing)', () => {
    const segs = tokenize('{route(prev');
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
    expect(segs.map(raw).join('')).toBe('{route(prev');
  });

  it('an unclosed bracket mention is plain text', () => {
    expect(tokenize('@[Time Out').every((s) => s.kind === 'text')).toBe(true);
  });

  it.each([
    'Nov 3 — arrive @Lisbon {weather()}',
    'plain text only',
    '{unclosed @Porto Nov 4',
    '@[A] @B Nov 5, 2026 {x} tail',
    '',
    'email a@b.com on 2026-01-02',
  ])('round-trips %j', (text) => {
    expect(tokenize(text).map(raw).join('')).toBe(text);
  });

  it('a backslash escapes @ and { so they stay literal', () => {
    const segs = tokenize('type \\@Place or \\{braces}');
    expect(segs).toEqual([{ kind: 'text', text: 'type \\@Place or \\{braces}' }]);
  });

  it('merges adjacent text runs', () => {
    expect(tokenize('a @ b')).toEqual([{ kind: 'text', text: 'a @ b' }]);
  });
});

describe('displayText', () => {
  it('drops the escaping backslash for display', () => {
    expect(displayText('type \\@Place or \\{x}')).toBe('type @Place or {x}');
  });
});

describe('placeKey', () => {
  it('lowercases, trims and collapses spaces', () => {
    expect(placeKey('  Time   Out Market ')).toBe('time out market');
  });
});
