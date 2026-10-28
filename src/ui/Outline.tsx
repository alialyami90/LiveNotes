import { insertAfter } from '../model/ops';
import { useStore } from './store';
import { NodeRow } from './NodeRow';

export function Outline() {
  const { doc, apply } = useStore();
  const top = doc.nodes[doc.rootId].children;
  const addFirst = () =>
    apply((d) => {
      const node = { id: crypto.randomUUID(), text: '', children: [] };
      const root = d.nodes[d.rootId];
      return {
        doc: { ...d, nodes: { ...d.nodes, [node.id]: node, [root.id]: { ...root, children: [node.id] } } },
        focus: { id: node.id, caret: 0 },
      };
    });
  return (
    <div className="outline">
      {top.length === 0 ? (
        <button type="button" className="empty" onClick={addFirst}>
          Start typing…
        </button>
      ) : (
        <ul className="root">
          {top.map((id) => (
            <NodeRow key={id} id={id} />
          ))}
        </ul>
      )}
      {top.length > 0 && (
        <button type="button" className="add-row" onClick={() => apply((d) => insertAfter(d, top[top.length - 1]))}>
          + Add bullet
        </button>
      )}
    </div>
  );
}
