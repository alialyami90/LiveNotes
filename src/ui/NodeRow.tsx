import type { NodeId } from '../model/types';
import { toggleCollapse } from '../model/ops';
import { useStore } from './store';
import { setHovered, useIsHovered } from './hover';
import { NodeEditor } from './NodeEditor';
import { RichText } from './RichText';
import { NodeMenu } from './NodeMenu';
import { ViewHost } from './views/ViewHost';

export function NodeRow({ id }: { id: NodeId }) {
  const { doc, focus, apply, setFocus } = useStore();
  const node = doc.nodes[id];
  const hovered = useIsHovered(id);
  const focused = focus?.id === id;
  const hasChildren = node.children.length > 0;

  return (
    <li data-node-id={id} className={hovered ? 'is-hovered' : undefined}>
      <div className="row" onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)}>
        <button
          type="button"
          className={`bullet${hasChildren ? ' has-children' : ''}${node.collapsed ? ' is-collapsed' : ''}`}
          aria-label={node.collapsed ? 'Expand' : 'Collapse'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => hasChildren && apply((d) => toggleCollapse(d, id))}
        />
        <div className="content">
          {focused ? (
            <NodeEditor id={id} focus={focus} />
          ) : (
            <RichText nodeId={id} text={node.text} onActivate={() => setFocus({ id, caret: node.text.length })} />
          )}
        </div>
        <NodeMenu id={id} current={node.view} />
      </div>
      {node.view && <ViewHost id={id} kind={node.view} />}
      {hasChildren && !node.collapsed && (
        <ul>
          {node.children.map((c) => (
            <NodeRow key={c} id={c} />
          ))}
        </ul>
      )}
    </li>
  );
}
