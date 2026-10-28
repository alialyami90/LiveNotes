import { describe, expect, it } from 'vitest';
import type { Doc, OutlineNode } from '../model/types';
import { resolveContexts } from './resolve';

type Spec = [string, string, Spec[]?]; // [id, text, children]
function build(spec: Spec[]): Doc {
  const nodes: Record<string, OutlineNode> = {};
  const add = ([id, text, kids = []]: Spec): string => {
    nodes[id] = { id, text, children: kids.map(add) };
    return id;
  };
  nodes.root = { id: 'root', text: '', children: spec.map(add) };
  return { version: 1, rootId: 'root', nodes, places: {} };
}

const TODAY = '2026-10-28';

describe('resolveContexts', () => {
  const doc = build([
    ['trip', 'Trip', [
      ['d1', 'Nov 3 2026 arrive @Lisbon', [
        ['lunch', 'Lunch at @[Time Out Market]'],
        ['walk', 'Walk around'],
      ]],
      ['d2', 'Nov 5 drive to @Porto', [['first', 'first thing']]],
    ]],
    ['nye', 'Dec 30 2026 party', [['jan', 'Jan 2 recover']]],
    ['bare', 'Nov 9 errands'],
  ]);
  const ctx = resolveContexts(doc, TODAY);

  it('records own mentions', () => {
    expect(ctx.get('d1')).toMatchObject({ ownPlaces: ['lisbon'], ownDates: ['2026-11-03'] });
  });

  it('a child with no mentions inherits place and date', () => {
    expect(ctx.get('walk')).toMatchObject({ placeKey: 'lisbon', date: '2026-11-03', ownPlaces: [], ownDates: [] });
  });

  it("a node's own last place overrides the inherited one", () => {
    expect(ctx.get('lunch')!.placeKey).toBe('time out market');
    expect(ctx.get('lunch')!.date).toBe('2026-11-03');
  });

  it('a yearless date takes the year of the nearest dated ancestor', () => {
    expect(ctx.get('jan')!.date).toBe('2026-01-02');
  });

  it('a yearless date with no dated ancestor takes today\'s year', () => {
    expect(ctx.get('bare')!.date).toBe('2026-11-09');
  });

  it('yearless dates under a dated parent get the parent year', () => {
    // d2 "Nov 5" has no year; d2's ancestors are undated, so today's year applies.
    expect(ctx.get('d2')!.date).toBe('2026-11-05');
  });

  it("prevPlaceKey is the previous sibling's effective place", () => {
    expect(ctx.get('walk')!.prevPlaceKey).toBe('time out market');
    expect(ctx.get('d2')!.prevPlaceKey).toBe('lisbon');
  });

  it("prevPlaceKey of a first child is the parent's place", () => {
    expect(ctx.get('lunch')!.prevPlaceKey).toBe('lisbon');
    expect(ctx.get('first')!.prevPlaceKey).toBe('porto');
  });

  it('prevPlaceKey is undefined when nothing precedes it', () => {
    expect(ctx.get('trip')!.prevPlaceKey).toBeUndefined();
  });

  it('ignores mentions inside formulas', () => {
    const d = build([['f', '{distance(@Lisbon, @Porto)}']]);
    expect(resolveContexts(d, TODAY).get('f')!.ownPlaces).toEqual([]);
  });
});
