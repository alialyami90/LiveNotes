import type { MouseEvent } from 'react';
import type { NodeId } from '../model/types';
import { displayText, tokenize } from '../syntax/tokenize';
import { DateChip, FormulaChip, PlaceChip } from './Chips';
import { useStore } from './store';

interface Props {
  nodeId: NodeId;
  text: string;
  onActivate?: (e: MouseEvent) => void;
  /** Tables show formulas in their own columns. */
  hideFormulas?: boolean;
}

export function RichText({ nodeId, text, onActivate, hideFormulas }: Props) {
  const { contexts } = useStore();
  const ownDates = contexts.get(nodeId)?.ownDates ?? [];
  let dateIndex = 0;
  const segments = tokenize(text);
  return (
    <div className="rich" onClick={onActivate}>
      {segments.length === 0 && <span className="placeholder">&nbsp;</span>}
      {segments.map((s, i) => {
        switch (s.kind) {
          case 'text':
            return <span key={i}>{displayText(s.text)}</span>;
          case 'place':
            return <PlaceChip key={i} placeKey={s.key} name={s.name} />;
          case 'date':
            return <DateChip key={i} raw={s.raw} iso={ownDates[dateIndex++]} />;
          // Tasks 5 and 6 turn these into chips; until then the word reads as written.
          case 'weather':
            return <span key={i}>{displayText(s.raw)}</span>;
          case 'route':
            return null;
          case 'formula':
            return hideFormulas ? null : <FormulaChip key={i} nodeId={nodeId} source={s.source} />;
        }
      })}
    </div>
  );
}
