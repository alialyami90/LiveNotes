import type { Doc, NodeId, OpResult, OutlineNode, Place, ViewKind } from './types';
import { parentOf, subtree, visibleOrder } from './tree';

const newId = (): NodeId => crypto.randomUUID();

function withNodes(doc: Doc, changed: OutlineNode[], removed: NodeId[] = []): Doc {
  const nodes = { ...doc.nodes };
  for (const n of changed) nodes[n.id] = n;
  for (const id of removed) delete nodes[id];
  return { ...doc, nodes };
}

function patch(doc: Doc, id: NodeId, fields: Partial<OutlineNode>): Doc {
  return withNodes(doc, [{ ...doc.nodes[id], ...fields }]);
}

function insertChild(parent: OutlineNode, child: NodeId, index: number): OutlineNode {
  const children = [...parent.children];
  children.splice(index, 0, child);
  return { ...parent, children };
}

function removeChild(parent: OutlineNode, child: NodeId): OutlineNode {
  return { ...parent, children: parent.children.filter((c) => c !== child) };
}

export function insertAfter(doc: Doc, id: NodeId, text = ''): OpResult {
  const parentId = parentOf(doc, id);
  if (!parentId) return { doc };
  const parent = doc.nodes[parentId];
  const node: OutlineNode = { id: newId(), text, children: [] };
  const updated = insertChild(parent, node.id, parent.children.indexOf(id) + 1);
  return { doc: withNodes(doc, [updated, node]), focus: { id: node.id, caret: 0 } };
}

/**
 * Enter: text after the caret moves to a new node. At the very start, an empty
 * node goes above instead, so the node keeps its children and context. An
 * expanded parent split at its end gets a new first child.
 */
export function splitNode(doc: Doc, id: NodeId, caret: number): OpResult {
  const node = doc.nodes[id];
  if (caret === 0 && node.text !== '') {
    const parentId = parentOf(doc, id);
    if (!parentId) return { doc };
    const parent = doc.nodes[parentId];
    const blank: OutlineNode = { id: newId(), text: '', children: [] };
    const updated = insertChild(parent, blank.id, parent.children.indexOf(id));
    return { doc: withNodes(doc, [updated, blank]), focus: { id, caret: 0 } };
  }
  const before = node.text.slice(0, caret);
  const after = node.text.slice(caret);
  if (after === '' && node.children.length > 0 && !node.collapsed) {
    const child: OutlineNode = { id: newId(), text: '', children: [] };
    return { doc: withNodes(doc, [insertChild(node, child.id, 0), child]), focus: { id: child.id, caret: 0 } };
  }
  const r = insertAfter(patch(doc, id, { text: before }), id, after);
  return r;
}

export function indent(doc: Doc, id: NodeId): OpResult {
  const parentId = parentOf(doc, id);
  if (!parentId) return { doc };
  const parent = doc.nodes[parentId];
  const idx = parent.children.indexOf(id);
  if (idx === 0) return { doc };
  const prev = doc.nodes[parent.children[idx - 1]];
  const newParent = { ...insertChild(prev, id, prev.children.length), collapsed: false };
  return { doc: withNodes(doc, [removeChild(parent, id), newParent]) };
}

export function outdent(doc: Doc, id: NodeId): OpResult {
  const parentId = parentOf(doc, id);
  if (!parentId || parentId === doc.rootId) return { doc };
  const grandId = parentOf(doc, parentId)!;
  const grand = doc.nodes[grandId];
  const moved = insertChild(grand, id, grand.children.indexOf(parentId) + 1);
  return { doc: withNodes(doc, [removeChild(doc.nodes[parentId], id), moved]) };
}

/**
 * Backspace at the start of a node: an empty node is deleted; otherwise its
 * text is appended to the previous visible node, which also adopts its children.
 */
export function removeOrMerge(doc: Doc, id: NodeId): OpResult {
  const order = visibleOrder(doc);
  const idx = order.indexOf(id);
  if (idx <= 0) return { doc };
  const prev = doc.nodes[order[idx - 1]];
  const node = doc.nodes[id];
  const parentId = parentOf(doc, id)!;
  // prev may be the parent itself; read it from the updated parent in that case.
  const parent = removeChild(doc.nodes[parentId], id);
  const base = prev.id === parentId ? parent : prev;
  const merged: OutlineNode = {
    ...base,
    text: base.text + node.text,
    children: [...base.children, ...node.children],
    collapsed: node.children.length > 0 ? false : base.collapsed,
  };
  const changed = prev.id === parentId ? [merged] : [parent, merged];
  return { doc: withNodes(doc, changed, [id]), focus: { id: prev.id, caret: prev.text.length } };
}

/** Removes a node with its subtree. The outline never ends up with no rows to type in. */
export function deleteNode(doc: Doc, id: NodeId): OpResult {
  const parentId = parentOf(doc, id);
  if (!parentId) return { doc };
  const order = visibleOrder(doc);
  const removed = [id, ...subtree(doc, id)];
  const after = order.slice(order.indexOf(id) + 1).find((n) => !removed.includes(n));
  const before = order.slice(0, order.indexOf(id)).at(-1);
  const parent = removeChild(doc.nodes[parentId], id);
  const next = withNodes(doc, [parent], removed);
  if (before) return { doc: next, focus: { id: before, caret: doc.nodes[before].text.length } };
  if (after) return { doc: next, focus: { id: after, caret: 0 } };
  const blank: OutlineNode = { id: newId(), text: '', children: [] };
  return {
    doc: withNodes(next, [{ ...next.nodes[parentId], children: [blank.id] }, blank]),
    focus: { id: blank.id, caret: 0 },
  };
}

function swap(doc: Doc, id: NodeId, delta: -1 | 1): OpResult {
  const parentId = parentOf(doc, id);
  if (!parentId) return { doc };
  const parent = doc.nodes[parentId];
  const idx = parent.children.indexOf(id);
  const target = idx + delta;
  if (target < 0 || target >= parent.children.length) return { doc };
  const children = [...parent.children];
  [children[idx], children[target]] = [children[target], children[idx]];
  return { doc: withNodes(doc, [{ ...parent, children }]) };
}

export const moveUp = (doc: Doc, id: NodeId) => swap(doc, id, -1);
export const moveDown = (doc: Doc, id: NodeId) => swap(doc, id, 1);

export function setText(doc: Doc, id: NodeId, text: string): OpResult {
  return { doc: patch(doc, id, { text }) };
}

export function toggleCollapse(doc: Doc, id: NodeId): OpResult {
  return { doc: patch(doc, id, { collapsed: !doc.nodes[id].collapsed }) };
}

export function setView(doc: Doc, id: NodeId, view: ViewKind | undefined): OpResult {
  const { view: _old, ...rest } = doc.nodes[id];
  return { doc: withNodes(doc, [view ? { ...rest, view } : rest]) };
}

export function setPlace(doc: Doc, key: string, place: Place): OpResult {
  return { doc: { ...doc, places: { ...doc.places, [key]: place } } };
}
