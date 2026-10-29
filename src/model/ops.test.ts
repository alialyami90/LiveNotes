import { describe, expect, it } from 'vitest';
import type { Doc, OutlineNode } from './types';
import {
  deleteNode, indent, insertAfter, moveDown, moveUp, outdent, removeOrMerge, setPlace, setText, setTitle, setView, splitNode, toggleCollapse,
} from './ops';
import { ancestors, parentOf, subtree, visibleOrder } from './tree';

/** Builds a doc from a nested spec: [text, children?] tuples; ids are the texts. */
type Spec = [string, Spec[]?];
function build(spec: Spec[]): Doc {
  const nodes: Record<string, OutlineNode> = {};
  const add = ([text, kids = []]: Spec): string => {
    nodes[text] = { id: text, text, children: kids.map(add) };
    return text;
  };
  nodes.root = { id: 'root', text: '', children: spec.map(add) };
  return { version: 1, rootId: 'root', nodes, places: {} };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

const kids = (d: Doc, id: string) => d.nodes[id].children.map((c) => d.nodes[c].text);

describe('tree', () => {
  const d = build([['a', [['a1'], ['a2', [['a2x']]]]], ['b']]);
  it('finds parents and ancestors', () => {
    expect(parentOf(d, 'a2x')).toBe('a2');
    expect(parentOf(d, 'a')).toBe('root');
    expect(ancestors(d, 'a2x')).toEqual(['a2', 'a']);
  });
  it('lists subtree in pre-order', () => {
    expect(subtree(d, 'a')).toEqual(['a1', 'a2', 'a2x']);
  });
  it('skips collapsed children in visible order', () => {
    const c = { ...d, nodes: { ...d.nodes, a2: { ...d.nodes.a2, collapsed: true } } };
    expect(visibleOrder(c)).toEqual(['a', 'a1', 'a2', 'b']);
  });
});

describe('ops', () => {
  it('splitNode at caret 3 of "abcdef" makes "abc" + next sibling "def"', () => {
    const d = build([['abcdef'], ['z']]);
    const r = splitNode(d, 'abcdef', 3);
    const top = r.doc.nodes.root.children;
    expect(top).toHaveLength(3);
    expect(r.doc.nodes[top[0]].text).toBe('abc');
    expect(r.doc.nodes[top[1]].text).toBe('def');
    expect(r.focus).toEqual({ id: top[1], caret: 0 });
  });

  it('splitNode at caret 0 of a non-empty node inserts an empty sibling above and keeps the node intact', () => {
    const d = build([['p', [['c1'], ['c2']]]]);
    const r = splitNode(d, 'p', 0);
    const top = r.doc.nodes.root.children;
    expect(top).toHaveLength(2);
    expect(r.doc.nodes[top[0]].text).toBe('');
    expect(top[1]).toBe('p');
    expect(kids(r.doc, 'p')).toEqual(['c1', 'c2']);
    expect(r.focus).toEqual({ id: 'p', caret: 0 });
  });

  it('splitNode at end of an expanded parent inserts as first child', () => {
    const d = build([['p', [['c']]]]);
    const r = splitNode(d, 'p', 1);
    expect(r.doc.nodes.p.children).toHaveLength(2);
    expect(r.doc.nodes[r.doc.nodes.p.children[0]].text).toBe('');
  });

  it('insertAfter adds an empty sibling after the node', () => {
    const r = insertAfter(build([['a'], ['b']]), 'a');
    expect(kids(r.doc, 'root')).toEqual(['a', '', 'b']);
  });

  it('indent makes node last child of previous sibling; no-op for first child', () => {
    const d = build([['a', [['a1']]], ['b']]);
    expect(kids(indent(d, 'b').doc, 'a')).toEqual(['a1', 'b']);
    expect(indent(d, 'a').doc).toBe(d);
  });

  it('indent expands a collapsed new parent so the node stays visible', () => {
    const d = build([['a', [['a1']]], ['b']]);
    const c = { ...d, nodes: { ...d.nodes, a: { ...d.nodes.a, collapsed: true } } };
    expect(indent(c, 'b').doc.nodes.a.collapsed).toBe(false);
  });

  it('outdent moves node just after its parent; later siblings stay', () => {
    const d = build([['a', [['a1'], ['a2'], ['a3']]], ['b']]);
    const r = outdent(d, 'a2');
    expect(kids(r.doc, 'root')).toEqual(['a', 'a2', 'b']);
    expect(kids(r.doc, 'a')).toEqual(['a1', 'a3']);
    expect(outdent(d, 'a').doc).toBe(d);
  });

  it('removeOrMerge on empty node deletes it and focuses previous visible node at end', () => {
    const d = build([['ab', [['c']]], ['']]);
    const r = removeOrMerge(d, '');
    expect(r.doc.nodes['']).toBeUndefined();
    expect(kids(r.doc, 'root')).toEqual(['ab']);
    expect(r.focus).toEqual({ id: 'c', caret: 1 });
  });

  it('removeOrMerge merges text into previous visible node and re-parents children', () => {
    const d = build([['ab'], ['cd', [['x'], ['y']]]]);
    const r = removeOrMerge(d, 'cd');
    expect(r.doc.nodes.ab.text).toBe('abcd');
    expect(kids(r.doc, 'ab')).toEqual(['x', 'y']);
    expect(r.doc.nodes.cd).toBeUndefined();
    expect(r.focus).toEqual({ id: 'ab', caret: 2 });
  });

  it('removeOrMerge into a node that already has children keeps all children', () => {
    const d = build([['p', [['k']]], ['q', [['q1']]]]);
    // previous visible node of q is k (last visible descendant of p)
    const r = removeOrMerge(d, 'q');
    expect(r.doc.nodes.k.text).toBe('kq');
    expect(kids(r.doc, 'k')).toEqual(['q1']);
    expect(r.doc.nodes.p.children).toEqual(['k']);
  });

  it('removeOrMerge on the very first node is a no-op', () => {
    const d = build([['a'], ['b']]);
    expect(removeOrMerge(d, 'a').doc).toBe(d);
  });

  it('deleteNode removes the node and its subtree and focuses the previous visible row at its end', () => {
    const d = build([['ab'], ['c', [['c1', [['c1x']]]]], ['d']]);
    const r = deleteNode(d, 'c');
    expect(kids(r.doc, 'root')).toEqual(['ab', 'd']);
    expect(r.doc.nodes.c).toBeUndefined();
    expect(r.doc.nodes.c1).toBeUndefined();
    expect(r.doc.nodes.c1x).toBeUndefined();
    expect(r.focus).toEqual({ id: 'ab', caret: 2 });
  });

  it('deleteNode on the first row focuses the next row', () => {
    const r = deleteNode(build([['a'], ['b']]), 'a');
    expect(r.focus).toEqual({ id: 'b', caret: 0 });
  });

  it('deleteNode on the only row leaves one empty row so the outline stays editable', () => {
    const r = deleteNode(build([['a']]), 'a');
    const top = r.doc.nodes.root.children;
    expect(top).toHaveLength(1);
    expect(r.doc.nodes[top[0]].text).toBe('');
    expect(r.focus).toEqual({ id: top[0], caret: 0 });
  });

  it('moveUp / moveDown swap with siblings', () => {
    const d = build([['a'], ['b'], ['c']]);
    expect(kids(moveUp(d, 'b').doc, 'root')).toEqual(['b', 'a', 'c']);
    expect(kids(moveDown(d, 'b').doc, 'root')).toEqual(['a', 'c', 'b']);
    expect(moveUp(d, 'a').doc).toBe(d);
  });

  it('setText, toggleCollapse, setView, setPlace update fields', () => {
    const d = build([['a', [['b']]]]);
    expect(setText(d, 'a', 'hi').doc.nodes.a.text).toBe('hi');
    expect(toggleCollapse(d, 'a').doc.nodes.a.collapsed).toBe(true);
    expect(setView(d, 'a', 'map').doc.nodes.a.view).toBe('map');
    expect(setView(setView(d, 'a', 'map').doc, 'a', undefined).doc.nodes.a.view).toBeUndefined();
    const p = { name: 'Lisbon', lat: 38.7, lon: -9.1 };
    expect(setPlace(d, 'lisbon', p).doc.places.lisbon).toEqual(p);
  });

  it('setTitle returns a new doc with the title and leaves the old doc untouched', () => {
    const d = deepFreeze(build([['a']]));
    const r = setTitle(d, 'Weekend');
    expect(r.doc.title).toBe('Weekend');
    expect(r.doc).not.toBe(d);
    expect(r.doc.nodes).toBe(d.nodes);
    expect(d.title).toBeUndefined();
    expect(r.focus).toBeUndefined();
  });

  it('setTitle stores an empty title as an empty string', () => {
    const d = build([['a']]);
    expect(setTitle(setTitle(d, 'x').doc, '').doc.title).toBe('');
  });

  it('ops never mutate the input doc', () => {
    const d = deepFreeze(build([['a', [['a1']]], ['bc', [['b1']]], ['']]));
    expect(() => {
      splitNode(d, 'a', 0);
      insertAfter(d, 'a');
      indent(d, 'bc');
      outdent(d, 'a1');
      removeOrMerge(d, 'bc');
      removeOrMerge(d, '');
      moveUp(d, 'bc');
      moveDown(d, 'a');
      setText(d, 'a', 'x');
      toggleCollapse(d, 'a');
      setView(d, 'a', 'table');
      setPlace(d, 'k', { name: 'k', lat: 0, lon: 0 });
      deleteNode(d, 'bc');
      setTitle(d, 'Trip');
    }).not.toThrow();
  });
});
