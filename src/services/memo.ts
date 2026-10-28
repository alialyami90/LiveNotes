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
    geocode: wrap('geocode', (name: string) => services.geocode(name)),
    weather: wrap('weather', (p, iso) => services.weather(p, iso)),
    route: wrap('route', (a, b) => services.route(a, b)),
  };
}
