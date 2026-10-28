export type NodeId = string;
export type ViewKind = 'map' | 'calendar' | 'table';

export interface OutlineNode {
  id: NodeId;
  /** Raw source, including @mentions and {formulas}. */
  text: string;
  children: NodeId[];
  collapsed?: boolean;
  /** A view renders this node's subtree beneath it. */
  view?: ViewKind;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
  label?: string;
}

export interface Doc {
  version: 1;
  /** Invisible root; its children are the top-level bullets. */
  rootId: NodeId;
  nodes: Record<NodeId, OutlineNode>;
  /** Geocode results keyed by normalized mention name, kept in the doc so they survive reloads. */
  places: Record<string, Place>;
}

export interface Focus {
  id: NodeId;
  caret: number;
}

export interface OpResult {
  doc: Doc;
  focus?: Focus;
}
