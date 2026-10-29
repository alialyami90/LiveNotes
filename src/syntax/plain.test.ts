import { describe, expect, it } from 'vitest';
import { plainText } from './plain';

describe('plainText', () => {
  it('folds place chips to their names', () => {
    expect(plainText('Visit @Porto and @[Time Out Market]')).toBe('Visit Porto and Time Out Market');
  });
  it('drops formulas', () => {
    expect(plainText('Lunch {weather()} at noon')).toBe('Lunch at noon');
  });
  it('keeps dates by default and drops them with dates:false', () => {
    expect(plainText('Nov 5 dinner')).toBe('Nov 5 dinner');
    expect(plainText('Nov 5 dinner', { dates: false })).toBe('dinner');
  });
  it('keeps an escaped mention literal without the backslash', () => {
    expect(plainText('mail \\@home')).toBe('mail @home');
  });
  it('strips leading punctuation and dashes', () => {
    expect(plainText('— : , · - hello')).toBe('hello');
    expect(plainText('Nov 5 — arrive', { dates: false })).toBe('arrive');
  });
  it('collapses whitespace', () => {
    expect(plainText('  a \n\t b   c  ')).toBe('a b c');
  });
});
