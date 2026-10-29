import { describe, expect, it } from 'vitest';
import type { Place } from '../model/types';
import { haversine } from './geo';
import { memoize } from './memo';
import { httpServices, TransientError } from './http';
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
      search: async () => [],
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

const OM = /geocoding-api\.open-meteo\.com/;
const PHOTON = /photon\.komoot\.io/;

type Route = { match: RegExp; respond: (url: string) => { status?: number; body?: unknown } | 'hang' | 'neterr' };

/** A fake fetch that routes by URL and records calls (and how many Photon calls overlapped). */
function fakeFetch(routes: Route[]) {
  const urls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    const route = routes.find((r) => r.match.test(url));
    const out = route ? route.respond(url) : { status: 404 };
    const counted = PHOTON.test(url);
    if (counted) inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      if (out === 'neterr') throw new TypeError('fetch failed');
      if (out === 'hang') {
        await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      const { status = 200, body = {} } = out as { status?: number; body?: unknown };
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    } finally {
      if (counted) inFlight--;
    }
  }) as unknown as typeof fetch;
  return { fn, urls, maxInFlight: () => maxInFlight };
}

const om = (...results: [string, number, number, string, string][]) => ({
  body: { results: results.map(([name, latitude, longitude, admin1, country]) => ({ name, latitude, longitude, admin1, country })) },
});
const photon = (...features: [string, number, number, string, string][]) => ({
  body: { features: features.map(([name, lat, lon, city, country]) => ({ geometry: { coordinates: [lon, lat] }, properties: { name, city, country } })) },
});
const noSleep = { sleep: async () => {}, photonGapMs: 0 };

describe('httpServices geocoding', () => {
  it('prefers Open-Meteo, which ranks towns by population (Lisbon, Portugal, not Lisbon, Iowa)', async () => {
    const f = fakeFetch([{ match: OM, respond: () => om(['Lisbon', 38.72, -9.14, 'Lisbon', 'Portugal']) }]);
    const p = await httpServices(f.fn, noSleep).geocode('lisbon');
    expect(p).toEqual({ name: 'Lisbon', lat: 38.72, lon: -9.14, label: 'Lisbon, Portugal' });
    expect(f.urls).toHaveLength(1);
    expect(f.urls[0]).toContain('name=lisbon&count=1&language=en');
  });

  it('falls back to Photon for landmarks, in English, biased to the nearby place', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: PHOTON, respond: () => photon(['Time Out Market Lisboa', 38.707, -9.1459, 'Lisboa', 'Portugal']) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('time out market', { name: 'Lisbon', lat: 38.72, lon: -9.14 });
    expect(p).toMatchObject({ name: 'Time Out Market Lisboa', lat: 38.707, lon: -9.1459 });
    const photonUrl = f.urls.find((u) => PHOTON.test(u))!;
    expect(photonUrl).toContain('q=time%20out%20market');
    expect(photonUrl).toContain('lang=en');
    expect(photonUrl).toContain('lat=38.72&lon=-9.14');
  });

  it('with a nearby place, a far-away town match loses to a close landmark', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Ribeira', 42.6, -8.99, 'Galicia', 'Spain']) },
      { match: PHOTON, respond: () => photon(['Ribeira', 41.1405, -8.6131, 'Porto', 'Portugal']) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('ribeira', { name: 'Porto', lat: 41.15, lon: -8.61 });
    expect(p).toMatchObject({ lat: 41.1405, label: 'Ribeira, Porto, Portugal' });
  });

  it('retries a 503 and then succeeds', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const f = fakeFetch([{ match: OM, respond: () => (++n < 3 ? { status: 503 } : om(['Porto', 41.15, -8.61, 'Porto', 'Portugal'])) }]);
    const p = await httpServices(f.fn, { sleep: async (ms) => { sleeps.push(ms); }, photonGapMs: 0 }).geocode('porto');
    expect(p?.name).toBe('Porto');
    expect(n).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it('says "unavailable" (TransientError), not "not found", when the services keep failing', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ status: 503 }) },
      { match: PHOTON, respond: () => 'neterr' },
    ]);
    await expect(httpServices(f.fn, noSleep).geocode('porto')).rejects.toBeInstanceOf(TransientError);
  });

  it('returns null only when every service answered with no results', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: PHOTON, respond: () => ({ body: { features: [] } }) },
    ]);
    expect(await httpServices(f.fn, noSleep).geocode('zzzz')).toBeNull();
  });

  it('gives up on a hung request after the timeout', async () => {
    const f = fakeFetch([{ match: OM, respond: () => 'hang' }, { match: PHOTON, respond: () => 'hang' }]);
    await expect(httpServices(f.fn, { ...noSleep, timeoutMs: 20 }).geocode('porto')).rejects.toBeInstanceOf(TransientError);
  });

  it('never has two Photon requests in flight at once', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: PHOTON, respond: () => photon(['X', 1, 2, 'Y', 'Z']) },
    ]);
    const s = httpServices(f.fn, noSleep);
    await Promise.all(['a', 'b', 'c', 'd'].map((q) => s.geocode(q)));
    const photonCalls = f.urls.filter((u) => PHOTON.test(u));
    expect(photonCalls).toHaveLength(4);
    expect(f.maxInFlight()).toBe(1);
  });
});

describe('httpServices search (autocomplete)', () => {
  it('merges nearby landmarks and ranked towns, without duplicates', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Lisbon', 38.72, -9.14, 'Lisbon', 'Portugal'], ['Lisbon', 41.92, -91.39, 'Iowa', 'United States']) },
      { match: PHOTON, respond: () => photon(['Lisbon', 38.7223, -9.1393, 'Lisbon', 'Portugal'], ['Lisbon Story Centre', 38.708, -9.136, 'Lisboa', 'Portugal']) },
    ]);
    const results = await httpServices(f.fn, noSleep).search('lisbon');
    expect(results.map((r) => r.label)).toEqual([
      'Lisbon, Portugal',
      'Lisbon, Iowa, United States',
      'Lisbon Story Centre, Lisboa, Portugal',
    ]);
  });

  it('still answers when one service is down', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Porto', 41.15, -8.61, 'Porto', 'Portugal']) },
      { match: PHOTON, respond: () => ({ status: 503 }) },
    ]);
    expect((await httpServices(f.fn, noSleep).search('porto')).map((r) => r.name)).toEqual(['Porto']);
  });

  it('puts nearby landmarks first when there is a nearby place', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Ribeira', 42.6, -8.99, 'Galicia', 'Spain']) },
      { match: PHOTON, respond: () => photon(['Ribeira', 41.1405, -8.6131, 'Porto', 'Portugal']) },
    ]);
    const results = await httpServices(f.fn, noSleep).search('ribeira', { name: 'Porto', lat: 41.15, lon: -8.61 });
    expect(results[0].label).toBe('Ribeira, Porto, Portugal');
  });
});

describe('httpServices weather and routes', () => {
  const LIS = { name: 'Lisbon', lat: 38.7223, lon: -9.1393 };
  const POR = { name: 'Porto', lat: 41.1579, lon: -8.6291 };

  it('weather maps WMO codes and daily highs/lows', async () => {
    const f = fakeFetch([{ match: /api\.open-meteo\.com\/v1\/forecast/, respond: () => ({ body: { daily: { weather_code: [61], temperature_2m_max: [18.2], temperature_2m_min: [11.9] } } }) }]);
    const w = await httpServices(f.fn, noSleep).weather(LIS, '2026-11-03');
    expect(w).toEqual({ code: 61, condition: 'Rain', icon: '🌧️', high: 18.2, low: 11.9 });
    expect(f.urls[0]).toContain('start_date=2026-11-03&end_date=2026-11-03');
  });

  it('route parses OSRM duration, distance and geometry as [lat, lon]', async () => {
    const f = fakeFetch([{ match: /router\.project-osrm\.org/, respond: () => ({ body: { code: 'Ok', routes: [{ duration: 11100, distance: 313400, geometry: { coordinates: [[-9.1, 38.7], [-8.6, 41.1]] } }] } }) }]);
    const r = await httpServices(f.fn, noSleep).route(LIS, POR);
    expect(r).toEqual({ seconds: 11100, meters: 313400, geometry: [[38.7, -9.1], [41.1, -8.6]] });
    expect(f.urls[0]).toContain('/route/v1/driving/-9.1393,38.7223;-8.6291,41.1579');
  });

  it('no route is a plain error; an unreachable service is transient', async () => {
    const noRoute = fakeFetch([{ match: /osrm/, respond: () => ({ body: { code: 'NoRoute' } }) }]);
    await expect(httpServices(noRoute.fn, noSleep).route(LIS, POR)).rejects.toThrow('no route found');
    const down = fakeFetch([{ match: /forecast/, respond: () => ({ status: 503 }) }]);
    await expect(httpServices(down.fn, noSleep).weather(LIS, '2026-11-03')).rejects.toThrow('weather unavailable');
  });
});
