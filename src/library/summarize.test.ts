import { describe, expect, it } from 'vitest';
import type { Doc, OutlineNode, Place } from '../model/types';
import { foldText } from './text';
import { summarizeNote } from './summarize';

type Spec = [string, string, Spec[]?]; // [id, text, children]
function build(spec: Spec[], extra: Partial<Doc> = {}): Doc {
  const nodes: Record<string, OutlineNode> = {};
  const add = ([id, text, kids = []]: Spec): string => {
    nodes[id] = { id, text, children: kids.map(add) };
    return id;
  };
  nodes.root = { id: 'root', text: '', children: spec.map(add) };
  return { version: 1, rootId: 'root', nodes, places: {}, ...extra };
}

const TODAY = '2026-10-28';
const at = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });

describe('foldText', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(foldText('  Évora \n  São   Bento ')).toBe('evora sao bento');
  });
});

describe('summarizeNote', () => {
  it('prefers doc.title', () => {
    const doc = build([['a', 'First bullet']], { title: 'My trip' });
    expect(summarizeNote(doc, TODAY).title).toBe('My trip');
  });

  it('falls back to the first top-level bullet as plain text', () => {
    const doc = build([['a', 'Trip to @Lisbon {weather()}'], ['b', 'Second']]);
    expect(summarizeNote(doc, TODAY).title).toBe('Trip to Lisbon');
  });

  it('is empty for an empty note', () => {
    expect(summarizeNote(build([]), TODAY).title).toBe('');
  });

  it('takes from/to from own dates anywhere in the tree', () => {
    const doc = build([
      ['a', 'Trip', [
        ['b', 'Nov 3 arrive'],
        ['c', 'Cities', [['d', 'Nov 5 leave']]],
      ]],
    ]);
    const s = summarizeNote(doc, TODAY);
    expect(s.from).toBe('2026-11-03');
    expect(s.to).toBe('2026-11-05');
  });

  it('has no from/to without dates', () => {
    const s = summarizeNote(build([['a', 'No dates']]), TODAY);
    expect(s.from).toBeUndefined();
    expect(s.to).toBeUndefined();
  });

  it('lists resolved places in document order, de-duplicated', () => {
    const doc = build(
      [['a', 'Trip', [['b', '@Porto then @Lisbon'], ['c', 'back to @porto'], ['d', '@Nowhere']]]],
      { places: { porto: at('Porto', 41.1, -8.6), lisbon: at('Lisbon', 38.7, -9.1) } },
    );
    expect(summarizeNote(doc, TODAY).places).toEqual([
      { name: 'Porto', lat: 41.1, lon: -8.6 },
      { name: 'Lisbon', lat: 38.7, lon: -9.1 },
    ]);
  });

  it('caps places at 8', () => {
    const names = Array.from({ length: 10 }, (_, i) => `City${i}`);
    const doc = build([['a', names.map((n) => `@${n}`).join(' ')]], {
      places: Object.fromEntries(names.map((n, i) => [n.toLowerCase(), at(n, i, i)])),
    });
    const s = summarizeNote(doc, TODAY);
    expect(s.places).toHaveLength(8);
    expect(s.places[7].name).toBe('City7');
    expect(s.placeNames).toHaveLength(10);
  });

  it('placeNames includes unresolved names as written', () => {
    const doc = build([['a', 'Go to @Lisbon and @[Time Out Market]']], {
      places: { lisbon: at('Lisbon', 38.7, -9.1) },
    });
    const s = summarizeNote(doc, TODAY);
    expect(s.placeNames).toEqual(['Lisbon', 'Time Out Market']);
    expect(s.places.map((p) => p.name)).toEqual(['Lisbon']);
  });

  it('preview excludes the title line, is plain text, and is at most 140 chars', () => {
    const doc = build([
      ['a', 'Title line', [
        ['b', 'Eat at @[Time Out] {weather()}'],
        ['c', 'x'.repeat(300)],
      ]],
    ]);
    const { preview } = summarizeNote(doc, TODAY);
    expect(preview.startsWith('Eat at Time Out')).toBe(true);
    expect(preview).not.toContain('Title line');
    expect(preview).not.toContain('{');
    expect(preview.length).toBeLessThanOrEqual(140);
  });

  it('preview keeps every bullet when doc.title is the title', () => {
    const doc = build([['a', 'First'], ['b', 'Second']], { title: 'Named' });
    expect(summarizeNote(doc, TODAY).preview).toBe('First Second');
  });

  it('cuts the preview by code points, never inside an emoji', () => {
    const doc = build([['a', 'Title', [['b', 'x'.repeat(139) + '😀' + 'tail']]]]);
    const { preview } = summarizeNote(doc, TODAY);
    expect(Array.from(preview)).toHaveLength(140);
    expect(preview.endsWith('😀')).toBe(true);
    expect(preview).not.toMatch(/[\ud800-\udbff]$/);
  });

  it('treats a whitespace-only doc.title like no title', () => {
    const doc = build([['a', 'Fallback', [['b', 'body']]]], { title: '   ' });
    const s = summarizeNote(doc, TODAY);
    expect(s.title).toBe('Fallback');
    expect(s.preview).toBe('body');
  });

  it('handles an empty first bullet', () => {
    const doc = build([['a', ''], ['b', 'Second']]);
    const s = summarizeNote(doc, TODAY);
    expect(s.title).toBe('');
    expect(s.preview).toBe('Second');
  });

  it('searchText is folded title + text + places', () => {
    const doc = build([['a', 'Weekend', [['b', 'Visit @Évora']]]], { title: 'São Trip' });
    const { searchText } = summarizeNote(doc, TODAY);
    expect(searchText).toContain(foldText('Évora'));
    expect(searchText).toContain('evora');
    expect(searchText).toContain('sao trip');
    expect(searchText).toContain('weekend');
  });
});
