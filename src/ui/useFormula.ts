import { useEffect, useState } from 'react';
import type { NodeId } from '../model/types';
import { parse } from '../formula/parser';
import { evaluate } from '../formula/evaluate';
import type { Value } from '../formula/values';
import { useStore } from './store';

export type FormulaState = { status: 'pending' } | { status: 'done'; value: Value };

export function useFormula(nodeId: NodeId, source: string): FormulaState {
  const { contexts, services, today, resolvePlace } = useStore();
  const ctx = contexts.get(nodeId);
  const hereKey = ctx?.placeKey;
  const prevKey = ctx?.prevPlaceKey;
  const date = ctx?.date;
  const [state, setState] = useState<FormulaState>({ status: 'pending' });

  useEffect(() => {
    const ast = parse(source);
    if ('error' in ast) {
      setState({ status: 'done', value: { kind: 'error', message: ast.error } });
      return;
    }
    let live = true;
    setState({ status: 'pending' });
    void evaluate(ast, { hereKey, prevKey, date, today, resolvePlace }, services).then((value) => {
      if (live) setState({ status: 'done', value });
    });
    return () => {
      live = false;
    };
  }, [source, hereKey, prevKey, date, today, services, resolvePlace]);

  return state;
}
