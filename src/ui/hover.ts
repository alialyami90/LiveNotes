import { useSyncExternalStore } from 'react';
import type { NodeId } from '../model/types';

// Linked hover across rows, map markers and calendar entries.
let hovered: NodeId | null = null;
const listeners = new Set<() => void>();

export function setHovered(id: NodeId | null): void {
  if (hovered === id) return;
  hovered = id;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Boolean selector so only the rows whose state flips re-render. */
export function useIsHovered(id: NodeId): boolean {
  return useSyncExternalStore(subscribe, () => hovered === id);
}

export function useHovered(): NodeId | null {
  return useSyncExternalStore(subscribe, () => hovered);
}
