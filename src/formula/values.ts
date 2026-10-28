import type { Place } from '../model/types';
import type { ISODate } from '../context/resolve';

export interface Weather {
  code: number;
  condition: string;
  icon: string;
  high: number;
  low: number;
}

export interface Route {
  seconds: number;
  meters: number;
  /** [lat, lon] pairs, for drawing on a map. */
  geometry?: [number, number][];
}

export type Value =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'place'; place: Place }
  | { kind: 'date'; iso: ISODate }
  | { kind: 'duration'; seconds: number }
  | { kind: 'distance'; meters: number }
  | { kind: 'speed'; mps: number }
  | ({ kind: 'weather' } & Weather)
  | ({ kind: 'route' } & Route)
  | { kind: 'error'; message: string };

export const err = (message: string): Value => ({ kind: 'error', message });
