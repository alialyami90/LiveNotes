import { describe, expect, it } from 'vitest';
import { activeMention, insertMention } from './mention';

describe('activeMention', () => {
  it('finds a single-word mention being typed at the caret', () => {
    expect(activeMention('Visit @Lis', 10)).toEqual({ start: 6, end: 10, query: 'Lis', bracket: false });
  });

  it('covers the whole word when the caret is in the middle', () => {
    expect(activeMention('Visit @Lisbon now', 9)).toEqual({ start: 6, end: 13, query: 'Lisbon', bracket: false });
  });

  it('finds a bracketed multi-word mention, open or closed', () => {
    expect(activeMention('Lunch @[Time Out', 16)).toEqual({ start: 6, end: 16, query: 'Time Out', bracket: true });
    expect(activeMention('Lunch @[Time Out] ok', 12)).toEqual({ start: 6, end: 17, query: 'Time Out', bracket: true });
  });

  it('works inside formulas', () => {
    expect(activeMention('{distance(@Por', 14)).toEqual({ start: 10, end: 14, query: 'Por', bracket: false });
  });

  it('a bare @ starts a mention with an empty query', () => {
    expect(activeMention('at @', 4)).toEqual({ start: 3, end: 4, query: '', bracket: false });
  });

  it('is null outside a mention, after a space, or in an email address', () => {
    expect(activeMention('Visit Lisbon', 12)).toBeNull();
    expect(activeMention('Visit @Lisbon now', 17)).toBeNull();
    expect(activeMention('mail a@b', 8)).toBeNull();
    expect(activeMention('@[Done] then', 12)).toBeNull();
  });
});

describe('insertMention', () => {
  it('uses @Name for single words and adds a space at the end of the text', () => {
    const m = activeMention('Visit @lis', 10)!;
    expect(insertMention('Visit @lis', m, 'Lisbon')).toEqual({ text: 'Visit @Lisbon ', caret: 14 });
  });

  it('uses @[Name] for names with spaces or punctuation and replaces the whole token', () => {
    const m = activeMention('Lunch @[time o] here', 10)!;
    expect(insertMention('Lunch @[time o] here', m, 'Time Out Market Lisboa')).toEqual({
      text: 'Lunch @[Time Out Market Lisboa] here',
      caret: 31,
    });
  });

  it('does not add a space before punctuation, e.g. inside a formula', () => {
    const text = '{distance(@Lis, @Porto)}';
    const m = activeMention(text, 14)!;
    expect(insertMention(text, m, 'Lisbon')).toEqual({ text: '{distance(@Lisbon, @Porto)}', caret: 17 });
  });

  it('strips characters that would break the mention syntax', () => {
    const m = activeMention('@x', 2)!;
    expect(insertMention('@x', m, 'Weird ] Name').text).toBe('@[Weird  Name] ');
  });
});
