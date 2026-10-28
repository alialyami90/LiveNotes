import type { NodeId } from '../../model/types';
import { tokenize } from '../../syntax/tokenize';
import { parse } from '../../formula/parser';
import { formatDate } from '../../formula/format';
import { useStore } from '../store';
import { setHovered, useHovered } from '../hover';
import { FormulaChip } from '../Chips';
import { RichText } from '../RichText';

const formulasOf = (text: string) =>
  tokenize(text).flatMap((s) => (s.kind === 'formula' ? [s.source] : []));

/** Column header: the function a column's first formula calls, else a generic label. */
function header(sources: (string | undefined)[], index: number): string {
  for (const src of sources) {
    if (!src) continue;
    const ast = parse(src);
    if (!('error' in ast) && ast.t === 'call') return ast.name;
    if (!('error' in ast) && ast.t === 'prop' && ast.e.t === 'call') return `${ast.e.name}.${ast.name}`;
  }
  return `ƒ${index + 1}`;
}

export function TableView({ id }: { id: NodeId }) {
  const { doc, contexts } = useStore();
  const hovered = useHovered();
  const rows = doc.nodes[id].children;
  if (rows.length === 0) return <div className="view-empty">Add bullets under this one to fill the table.</div>;

  const formulas = rows.map((r) => formulasOf(doc.nodes[r].text));
  const columns = Math.max(0, ...formulas.map((f) => f.length));

  return (
    <div className="table-view">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Place</th>
            <th>Date</th>
            {Array.from({ length: columns }, (_, c) => (
              <th key={c}>{header(formulas.map((f) => f[c]), c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((rowId, r) => {
            const ctx = contexts.get(rowId);
            const placeKey = ctx?.ownPlaces.at(-1);
            const place = placeKey ? doc.places[placeKey] : undefined;
            const date = ctx?.ownDates.at(-1);
            return (
              <tr
                key={rowId}
                className={hovered === rowId ? 'is-hovered' : undefined}
                onMouseEnter={() => setHovered(rowId)}
                onMouseLeave={() => setHovered(null)}
              >
                <td>
                  <RichText nodeId={rowId} text={doc.nodes[rowId].text} hideFormulas />
                </td>
                <td>{place ? place.name : ''}</td>
                <td>{date ? formatDate(date) : ''}</td>
                {Array.from({ length: columns }, (_, c) => (
                  <td key={c}>{formulas[r][c] !== undefined && <FormulaChip nodeId={rowId} source={formulas[r][c]} />}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
