import type { MouseEvent } from 'react';
import type { NodeId } from '../model/types';
import type { NodeContext } from '../context/resolve';
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

/**
 * I2: why a weather word has nothing to forecast, read from the same context the
 * evaluator sees. Ordinary prose ("Q4 sales forecast") then keeps its word rather
 * than turning into a red chip. Other failures ("no forecast yet") stay chips.
 */
function noForecast(ctx: NodeContext | undefined): string | null {
  if (!ctx?.placeKey) return 'No place here for a forecast';
  if (!ctx.date) return 'No date here for a forecast';
  return null;
}

export function RichText({ nodeId, text, onActivate, hideFormulas }: Props) {
  const { contexts } = useStore();
  const ctx = contexts.get(nodeId);
  const ownDates = ctx?.ownDates ?? [];
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
          case 'weather': {
            const why = noForecast(ctx);
            return why ? (
              <span key={i} title={why}>
                {s.raw}
              </span>
            ) : (
              <FormulaChip key={i} nodeId={nodeId} source={phraseSource(s)} />
            );
          }
          case 'route':
            return hideFormulas ? null : <FormulaChip key={i} nodeId={nodeId} source={phraseSource(s)} />;
          case 'formula':
            return hideFormulas ? null : <FormulaChip key={i} nodeId={nodeId} source={s.source} />;
        }
      })}
    </div>
  );
}
