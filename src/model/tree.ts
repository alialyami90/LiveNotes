import type { Doc, NodeId } from './types';

/** Parent links are derived, never stored, so they can't drift from `children`. */
export function parentIndex(doc: Doc): Map<NodeId, NodeId> {
  const index = new Map<NodeId, NodeId>();
  for (const node of Object.values(doc.nodes)) {
    for (const child of node.children) index.set(child, node.id);
  }
  return index;
}

export function parentOf(doc: Doc, id: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.children.includes(id)) return node.id;
  }
  return null;
}

/** Nearest first; excludes the invisible root. */
export function ancestors(doc: Doc, id: NodeId): NodeId[] {
  const parents = parentIndex(doc);
  const out: NodeId[] = [];
  let cur = parents.get(id);
  while (cur !== undefined && cur !== doc.rootId) {
    out.push(cur);
    cur = parents.get(cur);
  }
  return out;
}

/** Pre-order descendants of `id`, excluding `id` itself. */
export function subtree(doc: Doc, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const walk = (n: NodeId) => {
    for (const c of doc.nodes[n].children) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Depth-first order of rows the user can see (collapsed subtrees skipped). */
export function visibleOrder(doc: Doc): NodeId[] {
  const out: NodeId[] = [];
  const walk = (n: NodeId) => {
    for (const c of doc.nodes[n].children) {
      out.push(c);
      if (!doc.nodes[c].collapsed) walk(c);
    }
  };
  walk(doc.rootId);
  return out;
}
