import { describe, expect, it } from 'vitest';
import type { Place } from '../model/types';
import { haversine } from './geo';
import { memoize } from './memo';
import { httpServices } from './http';
import type { Services } from './types';

const LISBON: Place = { name: 'Lisbon', lat: 38.7223, lon: -9.1393 };
const PORTO: Place = { name: 'Porto', lat: 41.1579, lon: -8.6291 };

describe('haversine', () => {
  it('Lisbon → Porto is about 274 km', () => {
    expect(haversine(LISBON, PORTO) / 1000).toBeCloseTo(274, -1);
  });
  it('same point is 0', () => {
    expect(haversine(LISBON, LISBON)).toBe(0);
  });
});

describe('memoize', () => {
  it('calls the underlying route once for identical calls, even in flight', async () => {
    let n = 0;
    const base: Services = {
      geocode: async () => null,
      weather: async () => ({ code: 0, condition: '', icon: '', high: 0, low: 0 }),
      route: async () => {
        n++;
        return { seconds: 1, meters: 1 };
      },
    };
    const m = memoize(base);
    await Promise.all([m.route(LISBON, PORTO), m.route(LISBON, PORTO)]);
    await m.route(LISBON, PORTO);
    expect(n).toBe(1);
  });

  it('forgets failures so a later call can retry', async () => {
    let n = 0;
    const base = {
      geocode: async () => {
        n++;
        if (n === 1) throw new Error('offline');
        return LISBON;
      },
    } as unknown as Services;
    const m = memoize(base);
    await expect(m.geocode('lisbon')).rejects.toThrow('offline');
    await expect(m.geocode('lisbon')).resolves.toEqual(LISBON);
  });
});

describe('httpServices', () => {
  const fakeFetch = (body: unknown, ok = true) => {
    const urls: string[] = [];
    const fn = (async (url: string) => {
      urls.push(url);
      return { ok, json: async () => body };
    }) as unknown as typeof fetch;
    return { fn, urls };
  };

  it('geocode parses a Photon feature', async () => {
    const f = fakeFetch({
      features: [{ geometry: { coordinates: [-9.2159, 38.6916] }, properties: { name: 'Torre de Belém', city: 'Lisbon', country: 'Portugal' } }],
    });
    const p = await httpServices(f.fn).geocode('belém tower');
    expect(p).toEqual({ name: 'Torre de Belém', lat: 38.6916, lon: -9.2159, label: 'Torre de Belém, Lisbon, Portugal' });
    expect(f.urls[0]).toContain('https://photon.komoot.io/api/?q=bel%C3%A9m%20tower&limit=1');
  });

  it('geocode returns null when nothing matches', async () => {
    expect(await httpServices(fakeFetch({ features: [] }).fn).geocode('zzz')).toBeNull();
  });

  it('weather maps WMO codes and daily highs/lows', async () => {
    const f = fakeFetch({ daily: { weather_code: [61], temperature_2m_max: [18.2], temperature_2m_min: [11.9] } });
    const w = await httpServices(f.fn).weather(LISBON, '2026-11-03');
    expect(w).toEqual({ code: 61, condition: 'Rain', icon: '🌧️', high: 18.2, low: 11.9 });
    expect(f.urls[0]).toContain('start_date=2026-11-03&end_date=2026-11-03');
  });

  it('route parses OSRM duration, distance and geometry as [lat, lon]', async () => {
    const f = fakeFetch({ code: 'Ok', routes: [{ duration: 11100, distance: 313400, geometry: { coordinates: [[-9.1, 38.7], [-8.6, 41.1]] } }] });
    const r = await httpServices(f.fn).route(LISBON, PORTO);
    expect(r).toEqual({ seconds: 11100, meters: 313400, geometry: [[38.7, -9.1], [41.1, -8.6]] });
    expect(f.urls[0]).toContain('/route/v1/driving/-9.1393,38.7223;-8.6291,41.1579');
  });

  it('a failed route request rejects with a readable message', async () => {
    await expect(httpServices(fakeFetch({ code: 'NoRoute' }).fn).route(LISBON, PORTO)).rejects.toThrow('no route found');
    await expect(httpServices(fakeFetch({}, false).fn).weather(LISBON, '2026-11-03')).rejects.toThrow('weather unavailable');
  });
});
