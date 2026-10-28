import { describe, expect, it } from 'vitest';
import { parseDateAt } from './dates';

describe('parseDateAt', () => {
  it.each([
    ['Nov 3', { len: 5, month: 11, day: 3 }],
    ['3 Nov', { len: 5, month: 11, day: 3 }],
    ['November 3, 2026', { len: 16, month: 11, day: 3, year: 2026 }],
    ['Nov 3 2026', { len: 10, month: 11, day: 3, year: 2026 }],
    ['2026-11-03', { len: 10, month: 11, day: 3, year: 2026 }],
    ['sept 21', { len: 7, month: 9, day: 21 }],
  ])('parses %s', (text, expected) => {
    expect(parseDateAt(text, 0)).toEqual(expected);
  });

  it.each(['Nova', '3 Novels', 'May', 'Nov 32', '2026-13-01', 'Monday'])('rejects %s', (text) => {
    expect(parseDateAt(text, 0)).toBeNull();
  });

  it('does not start mid-word', () => {
    expect(parseDateAt('xNov 3', 1)).toBeNull();
    expect(parseDateAt('a3 Nov', 1)).toBeNull();
  });

  it('stops before trailing punctuation', () => {
    expect(parseDateAt('Nov 3, then', 0)).toEqual({ len: 5, month: 11, day: 3 });
  });
});
