import type { Place } from '../model/types';
import type { Route, Weather } from '../formula/values';

/** Everything that touches the network; injected so the pure layers and tests never fetch. */
export interface Services {
  geocode(name: string): Promise<Place | null>;
  weather(place: Place, isoDate: string): Promise<Weather>;
  route(from: Place, to: Place): Promise<Route>;
}
