import type { NodeId, ViewKind } from '../../model/types';

export function ViewHost({ kind }: { id: NodeId; kind: ViewKind }) {
  return <div className="view" data-view={kind} />;
}
