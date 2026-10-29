import type { Place } from '../model/types';
import type { Services } from './types';

/**
 * Shares in-flight and completed calls so re-rendering never refetches.
 * Failures are evicted so a flaky network doesn't poison the session.
 */
export function memoize(services: Services): Services {
  const cache = new Map<string, Promise<unknown>>();
  const wrap = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      const key = `${name}:${JSON.stringify(args)}`;
      let hit = cache.get(key) as Promise<R> | undefined;
      if (!hit) {
        hit = fn(...args);
        cache.set(key, hit);
        hit.catch(() => cache.delete(key));
      }
      return hit;
    };
  return {
    geocode: wrap('geocode', (name: string, near?: Place) => services.geocode(name, near)),
    // Searches carry a signal and a callback, and the user's typing makes repeats rare.
    search: (query, near, opts) => services.search(query, near, opts),
    weather: wrap('weather', (p, iso) => services.weather(p, iso)),
    route: wrap('route', (a, b) => services.route(a, b)),
  };
}
