import type { NodeId } from '../model/types';
import { formatValue } from '../formula/format';
import { useStore } from './store';
import { useFormula } from './useFormula';

export function PlaceChip({ placeKey, name }: { placeKey: string; name: string }) {
  const { doc, placeStatus } = useStore();
  const place = doc.places[placeKey];
  const s = placeStatus[placeKey];
  const status = place ? 'is-resolved' : s === 'missing' ? 'is-missing' : s === 'error' ? 'is-error' : 'is-pending';
  const title = place
    ? (place.label ?? place.name)
    : status === 'is-missing'
      ? 'Place not found — edit the mention and pick a suggestion'
      : status === 'is-error'
        ? 'Couldn’t reach the place service — retrying'
        : 'Looking up…';
  return (
    <span className={`chip chip-place ${status}`} title={title}>
      {name}
    </span>
  );
}

export function DateChip({ raw, iso }: { raw: string; iso?: string }) {
  return (
    <span className="chip chip-date" title={iso}>
      {raw}
    </span>
  );
}

export function FormulaChip({ nodeId, source }: { nodeId: NodeId; source: string }) {
  const state = useFormula(nodeId, source);
  if (state.status === 'pending') {
    return (
      <span className="chip chip-formula is-pending" title={`{${source}}`}>
        …
      </span>
    );
  }
  const { value } = state;
  const isError = value.kind === 'error';
  return (
    <span
      className={`chip chip-formula kind-${value.kind}${isError ? ' is-error' : ''}`}
      title={isError ? `{${source}}\n${value.message}` : `{${source}}`}
    >
      {formatValue(value)}
    </span>
  );
}
