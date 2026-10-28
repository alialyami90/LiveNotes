import type { NodeId, ViewKind } from '../model/types';
import { setView } from '../model/ops';
import { useStore } from './store';

export const VIEWS: { kind: ViewKind; label: string; icon: string }[] = [
  { kind: 'map', label: 'Map view', icon: '🗺️' },
  { kind: 'calendar', label: 'Calendar view', icon: '📅' },
  { kind: 'table', label: 'Table view', icon: '▦' },
];

/** Toggles for the views that render this node's subtree. */
export function NodeMenu({ id, current }: { id: NodeId; current?: ViewKind }) {
  const { apply } = useStore();
  return (
    <div className="node-menu">
      {VIEWS.map((v) => (
        <button
          key={v.kind}
          type="button"
          className="icon-btn"
          aria-label={v.label}
          title={v.label}
          aria-pressed={current === v.kind}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply((d) => setView(d, id, current === v.kind ? undefined : v.kind))}
        >
          {v.icon}
        </button>
      ))}
    </div>
  );
}
