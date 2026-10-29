import type { MouseEvent } from 'react';
import type { NodeId } from '../model/types';
import { displayText, tokenize } from '../syntax/tokenize';
import { phraseSource } from '../formula/travel';
import { DateChip, FormulaChip, PlaceChip } from './Chips';
import { useStore } from './store';

interface Props {
  nodeId: NodeId;
  text: string;
  onActivate?: (e: MouseEvent) => void;
  /** Tables show formulas, and routes, in their own columns; weather stays inline (R5). */
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
          case 'text': // a route's mode word included: it reads as written
            return <span key={i}>{displayText(s.text)}</span>;
          case 'place':
            return <PlaceChip key={i} placeKey={s.key} name={s.name} />;
          case 'date':
            return <DateChip key={i} raw={s.raw} iso={ownDates[dateIndex++]} />;
          // A phrase is its synthetic formula (R6), so pending, errors and memoising match formulas.
          case 'weather':
            return <FormulaChip key={i} nodeId={nodeId} source={phraseSource(s)} />;
          case 'route':
            return hideFormulas ? null : <FormulaChip key={i} nodeId={nodeId} source={phraseSource(s)} />;
          case 'formula':
            return hideFormulas ? null : <FormulaChip key={i} nodeId={nodeId} source={s.source} />;
        }
      })}
    </div>
  );
}
