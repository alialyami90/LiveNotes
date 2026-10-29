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

/** What a place is, for its icon. Mapped from map data in services/kinds.ts. */
export type PlaceKind =
  | 'region' | 'city' | 'village' | 'neighbourhood'
  | 'restaurant' | 'cafe' | 'bar' | 'shop' | 'stay'
  | 'sight' | 'park' | 'beach' | 'nature'
  | 'airport' | 'station' | 'street';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  label?: string;
  /** Absent on places saved before kinds existed; those show the plain pin. */
  kind?: PlaceKind;
  /** [west, south, east, north], when the map data has one. */
  extent?: [number, number, number, number];
}

export interface Doc {
  version: 1;
  /** Optional note title; when absent the first top-level bullet stands in. */
  title?: string;
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
