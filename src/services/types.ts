import type { Place } from '../model/types';
import type { Route, Weather } from '../formula/values';

/** A search result. `elsewhere` marks a row outside the parent place's area; it is never stored. */
export type Found = Place & { elsewhere?: true };

export interface SearchOptions {
  signal?: AbortSignal;
  /** Called with the whole merged list so far after each stage answers. */
  onUpdate?: (found: Found[]) => void;
}

/** Everything that touches the network; injected so the pure layers and tests never fetch. */
export interface Services {
  /**
   * Best single match for a mention. `near` (the surrounding bullet's place) narrows
   * landmark lookups to its area first. Resolves null only when every source answered
   * "no results"; rejects with TransientError when a source couldn't be reached.
   */
  geocode(name: string, near?: Place): Promise<Place | null>;
  /**
   * Candidates for the @-mention picker: with `near`, the rows inside its area first,
   * then the rows flagged `elsewhere`. `onUpdate` shows each stage as it arrives;
   * `signal` drops a search that is still queued once the user has typed on.
   */
  search(query: string, near?: Place, opts?: SearchOptions): Promise<Found[]>;
  weather(place: Place, isoDate: string): Promise<Weather>;
  route(from: Place, to: Place): Promise<Route>;
}
