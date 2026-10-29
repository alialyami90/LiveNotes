import type { Place } from '../model/types';
import type { Route, Weather } from '../formula/values';

export interface SearchOptions {
  signal?: AbortSignal;
  onTowns?: (towns: Place[]) => void;
}

/** Everything that touches the network; injected so the pure layers and tests never fetch. */
export interface Services {
  /**
   * Best single match for a mention. `near` (the surrounding bullet's place) biases
   * landmark lookups. Resolves null only when every source answered "no results";
   * rejects with TransientError when a source couldn't be reached.
   */
  geocode(name: string, near?: Place): Promise<Place | null>;
  /**
   * Candidates for the @-mention picker. `onTowns` gets the fast town results
   * before slower landmark results arrive; `signal` drops a search that is still
   * queued once the user has typed on.
   */
  search(query: string, near?: Place, opts?: SearchOptions): Promise<Place[]>;
  weather(place: Place, isoDate: string): Promise<Weather>;
  route(from: Place, to: Place): Promise<Route>;
}
