import { describe, expect, it } from 'vitest';
import type { Place } from '../model/types';
import { areaOf, haversine, inArea, searchArea, type Box } from './geo';
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

const om = (...results: [string, number, number, string, string, number?, string?][]) => ({
  body: {
    results: results.map(([name, latitude, longitude, admin1, country, population, feature_code]) => ({
      name, latitude, longitude, admin1, country, population, feature_code,
    })),
  },
});
const photon = (...features: [string, number, number, string, string, string?, string?, number[]?][]) => ({
  body: {
    features: features.map(([name, lat, lon, city, country, osm_key = 'place', osm_value, extent]) => ({
      geometry: { coordinates: [lon, lat] },
      properties: { name, city, country, osm_key, osm_value, extent },
    })),
  },
});
const noSleep = { sleep: async () => {}, photonGapMs: 0 };

describe('httpServices geocoding', () => {
  it('prefers Open-Meteo, which ranks towns by population (Lisbon, Portugal, not Lisbon, Iowa)', async () => {
    const f = fakeFetch([{ match: OM, respond: () => om(['Lisbon', 38.72, -9.14, 'Lisbon', 'Portugal', 545923, 'PPLC']) }]);
    const p = await httpServices(f.fn, noSleep).geocode('lisbon');
    expect(p).toEqual({ name: 'Lisbon', lat: 38.72, lon: -9.14, label: 'Lisbon, Portugal', kind: 'city' });
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

describe('review fixes: geocode edge cases', () => {
  it('does not settle for a far-away namesake when Photon could not be reached', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Ribeira', 42.6, -8.99, 'Galicia', 'Spain']) },
      { match: PHOTON, respond: () => ({ status: 503 }) },
    ]);
    await expect(httpServices(f.fn, noSleep).geocode('ribeira', { name: 'Porto', lat: 41.15, lon: -8.61 })).rejects.toBeInstanceOf(TransientError);
  });

  it('a permanent Open-Meteo error still lets Photon answer', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ status: 400 }) },
      { match: PHOTON, respond: () => photon(['Corniche', 26.3, 50.22, 'Khobar', 'Saudi Arabia']) },
    ]);
    expect((await httpServices(f.fn, noSleep).geocode('corniche'))?.name).toBe('Corniche');
    expect((await httpServices(f.fn, noSleep).search('corniche')).map((p) => p.name)).toEqual(['Corniche']);
  });

  it('Photon retries wait at least the Photon spacing', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: PHOTON, respond: () => (++n < 2 ? { status: 503 } : photon(['X', 1, 2, 'Y', 'Z'])) },
    ]);
    await httpServices(f.fn, { sleep: async (ms) => { sleeps.push(ms); }, photonGapMs: 1500 }).geocode('x');
    expect(sleeps.every((ms) => ms >= 1500)).toBe(true);
  });
});

describe('place kinds and extents', () => {
  it('a Photon cafe keeps its kind and its extent, reordered to [west, south, east, north]', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: PHOTON, respond: () => photon(['Café A Brasileira', 38.71, -9.14, 'Lisboa', 'Portugal', 'amenity', 'cafe', [-9.141, 38.711, -9.139, 38.709]]) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('a brasileira');
    expect(p).toEqual({
      name: 'Café A Brasileira', lat: 38.71, lon: -9.14, label: 'Café A Brasileira, Lisboa, Portugal',
      kind: 'cafe', extent: [-9.141, 38.709, -9.139, 38.711],
    });
  });

  it('a Photon result without a valid extent has no extent field, but still a kind', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: PHOTON, respond: () => photon(['Somewhere', 1, 2, 'Y', 'Z', 'tourism', 'zoo', [1, 2]]) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('somewhere');
    expect(p).toEqual({ name: 'Somewhere', lat: 1, lon: 2, label: 'Somewhere, Y, Z', kind: 'street' });
    expect(p).not.toHaveProperty('extent');
  });

  it('an Open-Meteo capital is a city, and ranking hints never reach the stored place', async () => {
    const f = fakeFetch([{ match: OM, respond: () => om(['Lisbon', 38.72, -9.14, 'Lisbon', 'Portugal', 545923, 'PPLC']) }]);
    const p = await httpServices(f.fn, noSleep).geocode('lisbon');
    expect(p?.kind).toBe('city');
    expect(p).not.toHaveProperty('population');
    expect(p).not.toHaveProperty('street');
  });

  it('search results carry kinds too', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Porto', 41.15, -8.61, 'Porto', 'Portugal', 231962, 'PPLA']) },
      { match: PHOTON, respond: () => photon(['Livraria Lello', 41.146, -8.615, 'Porto', 'Portugal', 'shop', 'books']) },
    ]);
    const results = await httpServices(f.fn, noSleep).search('l');
    expect(results.map((r) => r.kind)).toEqual(['city', 'shop']);
  });

  it('a landmark such as a hospital beats a far-away namesake town (a street still does not)', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Santa Maria', 38.8, -9.38, 'Lisbon District', 'Portugal', 12000, 'PPL']) },
      { match: PHOTON, respond: () => photon(['Santa Maria', 41.15, -8.6, 'Porto', 'Portugal', 'amenity', 'hospital']) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('santa maria', { name: 'Porto', lat: 41.15, lon: -8.61 });
    expect(p).toMatchObject({ lat: 41.15, lon: -8.6, kind: 'street' });
  });
});

describe('far cities under a parent place (live finding: Dammam under Riyadh)', () => {
  const RIYADH = { name: 'Riyadh', lat: 24.69, lon: 46.72 };

  it('a major city beats a same-name local match near the parent', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Dammam', 26.43442, 50.10326, 'Eastern Province', 'Saudi Arabia', 1252523, 'PPLA']) },
      { match: PHOTON, respond: () => photon(['Dammam', 24.7764, 46.7305, 'Riyadh governorate', 'Saudi Arabia']) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('dammam', RIYADH);
    expect(p).toEqual({ name: 'Dammam', lat: 26.43442, lon: 50.10326, label: 'Dammam, Eastern Province, Saudi Arabia', kind: 'city' });
  });

  it('a street never beats a town', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Sintra', 38.8, -9.38, 'Lisbon District', 'Portugal', 26193]) },
      { match: PHOTON, respond: () => photon(['Sintra', 41.15, -8.6, 'Porto', 'Portugal', 'highway']) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('sintra', { name: 'Porto', lat: 41.15, lon: -8.61 });
    expect(p?.lat).toBe(38.8);
  });

  it('the picker lists the local match inside the area, then the major city under Elsewhere', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Dammam', 26.43442, 50.10326, 'Eastern Province', 'Saudi Arabia', 1252523, 'PPLA']) },
      { match: PHOTON, respond: () => photon(['Dammam', 24.7764, 46.7305, 'Riyadh governorate', 'Saudi Arabia']) },
    ]);
    const results = await httpServices(f.fn, noSleep).search('dammam', RIYADH);
    expect(results.map((r) => [r.label, r.elsewhere])).toEqual([
      ['Dammam, Riyadh governorate, Saudi Arabia', undefined],
      ['Dammam, Eastern Province, Saudi Arabia', true],
    ]);
  });
});

describe('review fixes: responsive search', () => {
  it('hands over town results before Photon answers', async () => {
    let releasePhoton: () => void = () => {};
    const photonGate = new Promise<void>((r) => { releasePhoton = r; });
    const fn = (async (url: string) => {
      if (PHOTON.test(url)) await photonGate;
      const body = OM.test(url) ? om(['Porto', 41.15, -8.61, 'Porto', 'Portugal']).body : { features: [] };
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch;
    const towns: string[][] = [];
    const done = httpServices(fn, noSleep).search('porto', undefined, { onUpdate: (p) => towns.push(p.map((x) => x.name)) });
    await new Promise((r) => setTimeout(r, 10));
    expect(towns).toEqual([['Porto']]);
    releasePhoton();
    expect((await done).map((p) => p.name)).toEqual(['Porto']);
  });

  it('skips a queued search that was cancelled before its turn', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: PHOTON, respond: () => photon(['X', 1, 2, 'Y', 'Z']) },
    ]);
    const s = httpServices(f.fn, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), photonGapMs: 30 });
    const first = s.search('aaa');
    const controller = new AbortController();
    const second = s.search('bbb', undefined, { signal: controller.signal });
    controller.abort();
    await first;
    await second.catch(() => undefined);
    expect(f.urls.filter((u) => PHOTON.test(u) && u.includes('q=bbb'))).toEqual([]);
  });

  it('a search typed by the user jumps ahead of background lookups', async () => {
    const order: string[] = [];
    const fn = (async (url: string) => {
      if (PHOTON.test(url)) order.push(new URL(url).searchParams.get('q')!);
      const body = OM.test(url) ? {} : photon(['X', 1, 2, 'Y', 'Z']).body;
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch;
    const s = httpServices(fn, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), photonGapMs: 20 });
    const background = ['bg1', 'bg2', 'bg3'].map((q) => s.geocode(q));
    await new Promise((r) => setTimeout(r, 5));
    const typed = s.search('typed');
    await Promise.all([...background, typed]);
    expect(order.indexOf('typed')).toBeLessThan(order.indexOf('bg3'));
    expect(order.indexOf('typed')).toBeLessThanOrEqual(1);
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
    expect(f.urls.some((u) => u.includes('bbox='))).toBe(false);
    expect(results.some((r) => 'elsewhere' in r)).toBe(false);
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

describe('the area around a parent place (areaOf, inArea)', () => {
  const BCN: Place = { name: 'Barcelona', lat: 41.3874, lon: 2.1686 };

  it('uses a valid extent as is', () => {
    expect(areaOf({ ...BCN, extent: [2.05, 41.32, 2.23, 41.47] })).toEqual([2.05, 41.32, 2.23, 41.47]);
  });

  const expectFallback = (box: Box) => {
    const [w, s, e, n] = box;
    expect(n - BCN.lat).toBeCloseTo(0.27, 2);
    expect(BCN.lat - s).toBeCloseTo(0.27, 2);
    // 30 km of longitude is wider in degrees away from the equator.
    expect(e - BCN.lon).toBeCloseTo(0.27 / Math.cos((BCN.lat * Math.PI) / 180), 2);
    expect(BCN.lon - w).toBeCloseTo(e - BCN.lon, 6);
  };

  it('falls back to a 30 km box without an extent', () => {
    expectFallback(areaOf(BCN));
  });

  it('falls back for a malformed extent (wrong length, non-finite, inverted) without crashing', () => {
    expectFallback(areaOf({ ...BCN, extent: [1, 2] as unknown as Box }));
    expectFallback(areaOf({ ...BCN, extent: [Number.NaN, 41, Number.POSITIVE_INFINITY, 42] }));
    expectFallback(areaOf({ ...BCN, extent: [2.23, 41.32, 2.05, 41.47] }));
    expectFallback(areaOf({ ...BCN, extent: ['a', 'b', 'c', 'd'] as unknown as Box }));
  });

  it('inArea is inclusive of the edges and excludes points outside', () => {
    const box: Box = [2.05, 41.32, 2.23, 41.47];
    expect(inArea({ lat: 41.39, lon: 2.17 }, box)).toBe(true);
    expect(inArea({ lat: 41.32, lon: 2.05 }, box)).toBe(true);
    expect(inArea({ lat: 41.5, lon: 2.17 }, box)).toBe(false);
    expect(inArea({ lat: 41.39, lon: 2.3 }, box)).toBe(false);
  });
});

describe('a region parent without an extent has no area (M3)', () => {
  const PORTUGAL: Place = { name: 'Portugal', lat: 39.6945, lon: -8.1302, kind: 'region' };
  const BBOX = /photon\.komoot\.io.*bbox=/;

  it('searchArea is undefined for such a region, and the area otherwise', () => {
    expect(searchArea(PORTUGAL)).toBeUndefined();
    expect(searchArea({ ...PORTUGAL, extent: [-9.5, 36.9, -6.2, 42.2] })).toEqual([-9.5, 36.9, -6.2, 42.2]);
    expect(searchArea({ ...PORTUGAL, kind: 'city' })).toEqual(areaOf({ ...PORTUGAL, kind: 'city' }));
  });

  it('search and geocode skip the bbox stage and the section split, as the biased search did', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Tomar', 39.6, -8.41, 'Santarém', 'Portugal', 20000, 'PPL']) },
      { match: PHOTON, respond: () => photon(['Tomar Castle', 39.6, -8.42, 'Tomar', 'Portugal', 'historic', 'castle']) },
    ]);
    const s = httpServices(f.fn, noSleep);
    const results = await s.search('tomar', PORTUGAL);
    expect(results.map((r) => [r.name, r.elsewhere])).toEqual([
      ['Tomar', undefined],
      ['Tomar Castle', undefined],
    ]);
    // Tomar is within 75 km of the region's centre, so it wins without the area stage.
    expect(await s.geocode('tomar', PORTUGAL)).toMatchObject({ name: 'Tomar' });
    expect(f.urls.filter((u) => BBOX.test(u))).toEqual([]);
  });

  it('a region with a valid extent still searches inside it', async () => {
    const f = fakeFetch([{ match: OM, respond: () => ({ body: {} }) }, { match: PHOTON, respond: () => photon() }]);
    await httpServices(f.fn, noSleep).search('x', { ...PORTUGAL, extent: [-9.5, 36.9, -6.2, 42.2] });
    expect(f.urls.filter((u) => BBOX.test(u))).toHaveLength(1);
  });
});

describe('searching inside the parent place first (spec §6)', () => {
  const BARCELONA: Place = { name: 'Barcelona', lat: 41.3874, lon: 2.1686 };
  const LISBON_NEAR: Place = { name: 'Lisbon', lat: 38.72, lon: -9.14 };
  const BBOX = /photon\.komoot\.io.*bbox=/;
  type OmRow = [string, number, number, string, string, number, string];
  type PhRow = [string, number, number, string, string, string, string];
  const AIRPORT_US: OmRow = ['Airport', 37.63, -120.98, 'California', 'United States', 1964, 'PPL'];
  const MADRID: OmRow = ['Madrid', 40.4165, -3.7026, 'Madrid', 'Spain', 3255944, 'PPLC'];
  const EL_PRAT: PhRow = ['Barcelona–El Prat Airport', 41.2974, 2.0833, 'El Prat de Llobregat', 'Spain', 'aeroway', 'aerodrome'];
  const GIRONA: PhRow = ['Girona–Costa Brava Airport', 41.901, 2.7606, "Vilobí d'Onyar", 'Spain', 'aeroway', 'aerodrome'];

  const airportRoutes = (): Route[] => [
    { match: OM, respond: () => om(AIRPORT_US, MADRID) },
    { match: BBOX, respond: () => photon(EL_PRAT) },
    { match: PHOTON, respond: () => photon(GIRONA) },
  ];

  it("asks Photon for the parent place's extent as bbox=west,south,east,north", async () => {
    const f = fakeFetch([{ match: OM, respond: () => ({ body: {} }) }, { match: PHOTON, respond: () => photon() }]);
    const s = httpServices(f.fn, noSleep);
    await s.search('x', { ...BARCELONA, extent: [2.05, 41.32, 2.23, 41.47] });
    const searchBbox = f.urls.filter((u) => BBOX.test(u));
    expect(searchBbox).toHaveLength(1);
    expect(searchBbox[0]).toContain('bbox=2.05,41.32,2.23,41.47');
    expect(searchBbox[0]).toContain('limit=8');
    f.urls.length = 0;
    await s.geocode('x', { ...BARCELONA, extent: [2.05, 41.32, 2.23, 41.47] });
    const geocodeBbox = f.urls.filter((u) => BBOX.test(u));
    expect(geocodeBbox).toHaveLength(1);
    expect(geocodeBbox[0]).toContain('bbox=2.05,41.32,2.23,41.47');
    expect(geocodeBbox[0]).toContain('limit=5');
  });

  it('"airport" under Barcelona lists El Prat first, then Madrid and the far town under Elsewhere', async () => {
    const f = fakeFetch(airportRoutes());
    const results = await httpServices(f.fn, noSleep).search('airport', BARCELONA);
    expect(results.map((r) => [r.name, r.elsewhere])).toEqual([
      ['Barcelona–El Prat Airport', undefined],
      ['Madrid', true],
      ['Airport', true],
      ['Girona–Costa Brava Airport', true],
    ]);
    expect(results[0]).not.toHaveProperty('elsewhere');
    expect(results[0].kind).toBe('airport');
    expect(results[1]).not.toHaveProperty('population');
  });

  it('inside the area, named places come nearest first and streets last', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      {
        match: BBOX,
        respond: () => photon(
          ['Far Café', 41.45, 2.21, 'Barcelona', 'Spain', 'amenity', 'cafe'],
          ['Carrer del Café', 41.3875, 2.1687, 'Barcelona', 'Spain', 'highway', 'residential'],
          ['Near Café', 41.39, 2.17, 'Barcelona', 'Spain', 'amenity', 'cafe'],
        ),
      },
      { match: PHOTON, respond: () => photon() },
    ]);
    const results = await httpServices(f.fn, noSleep).search('cafe', BARCELONA);
    expect(results.map((r) => r.name)).toEqual(['Near Café', 'Far Café', 'Carrer del Café']);
  });

  it('caps each section at 8 rows', async () => {
    const many = (prefix: string, lat: number, lon: number) =>
      Array.from({ length: 10 }, (_, i): PhRow => [`${prefix} ${i}`, lat + i * 0.001, lon, 'X', 'Spain', 'amenity', 'cafe']);
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: BBOX, respond: () => photon(...many('In', 41.39, 2.17)) },
      { match: PHOTON, respond: () => photon(...many('Out', 40.4, -3.7)) },
    ]);
    const results = await httpServices(f.fn, noSleep).search('cafe', BARCELONA);
    expect(results.filter((r) => !r.elsewhere)).toHaveLength(8);
    expect(results.filter((r) => r.elsewhere)).toHaveLength(8);
  });

  it('calls onUpdate after each stage; the last update is the resolved list', async () => {
    const f = fakeFetch(airportRoutes());
    const updates: unknown[][] = [];
    const results = await httpServices(f.fn, noSleep).search('airport', BARCELONA, { onUpdate: (found) => updates.push(found) });
    expect(updates).toHaveLength(3);
    expect(updates[updates.length - 1]).toEqual(results);
  });

  it('never calls onUpdate once the search is cancelled', async () => {
    const f = fakeFetch(airportRoutes());
    const s = httpServices(f.fn, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), photonGapMs: 30 });
    const first = s.search('aaa');
    const controller = new AbortController();
    const updates: unknown[][] = [];
    const second = s.search('airport', BARCELONA, { signal: controller.signal, onUpdate: (found) => updates.push(found) });
    controller.abort();
    await first;
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 20));
    expect(f.urls.some((u) => OM.test(u) && u.includes('name=airport'))).toBe(true);
    expect(updates).toEqual([]);
  });

  it('while Open-Meteo is down, geocode settles on no Photon answer (it might have been a major city)', async () => {
    let omCalls = 0;
    const f = fakeFetch([
      { match: OM, respond: () => { omCalls++; return { status: 503 }; } },
      { match: BBOX, respond: () => photon(['Madrid', 41.39, 2.17, 'Barcelona', 'Spain', 'amenity', 'bar']) },
      { match: PHOTON, respond: () => photon(['Madrid', 41.39, 2.17, 'Barcelona', 'Spain', 'amenity', 'bar']) },
    ]);
    await expect(httpServices(f.fn, noSleep).geocode('madrid', BARCELONA)).rejects.toBeInstanceOf(TransientError);
    expect(omCalls).toBe(3);
  });

  it('a nearby (not inside) town is not accepted while the area could not be searched', async () => {
    let bboxCalls = 0;
    const f = fakeFetch([
      { match: OM, respond: () => om(['Vilanova', 41.85, 2.17, 'Catalonia', 'Spain', 9000, 'PPL']) },
      { match: BBOX, respond: () => { bboxCalls++; return { status: 503 }; } },
      { match: PHOTON, respond: () => photon() },
    ]);
    await expect(httpServices(f.fn, noSleep).geocode('vilanova', BARCELONA)).rejects.toBeInstanceOf(TransientError);
    expect(bboxCalls).toBe(3);
  });

  it('a failing bbox stage still leaves the Elsewhere rows in search', async () => {
    let bboxCalls = 0;
    const f = fakeFetch([
      { match: OM, respond: () => om(AIRPORT_US, MADRID) },
      { match: BBOX, respond: () => { bboxCalls++; return { status: 503 }; } },
      { match: PHOTON, respond: () => photon(GIRONA) },
    ]);
    const results = await httpServices(f.fn, noSleep).search('airport', BARCELONA);
    expect(bboxCalls).toBe(3);
    expect(results.map((r) => [r.name, r.elsewhere])).toEqual([
      ['Madrid', true],
      ['Airport', true],
      ['Girona–Costa Brava Airport', true],
    ]);
  });

  it('I5: when the area stage failed, geocode accepts a worldwide result inside the area', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(AIRPORT_US) },
      { match: BBOX, respond: () => ({ status: 503 }) },
      { match: PHOTON, respond: () => photon(EL_PRAT) },
    ]);
    expect(await httpServices(f.fn, noSleep).geocode('airport', BARCELONA)).toMatchObject({ name: 'Barcelona–El Prat Airport', kind: 'airport' });
  });

  it('I5: when the area stage failed, a worldwide result outside the area is TransientError, not a stored guess', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(AIRPORT_US, MADRID) },
      { match: BBOX, respond: () => ({ status: 503 }) },
      { match: PHOTON, respond: () => photon(GIRONA) },
    ]);
    await expect(httpServices(f.fn, noSleep).geocode('airport', BARCELONA)).rejects.toBeInstanceOf(TransientError);
  });

  it('rejects with TransientError when every source failed', async () => {
    const f = fakeFetch([{ match: OM, respond: () => ({ status: 503 }) }, { match: PHOTON, respond: () => ({ status: 503 }) }]);
    const s = httpServices(f.fn, noSleep);
    await expect(s.search('airport', BARCELONA)).rejects.toBeInstanceOf(TransientError);
    await expect(s.geocode('airport', BARCELONA)).rejects.toBeInstanceOf(TransientError);
  });

  it('a far namesake town is not accepted while the area could not be searched', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(AIRPORT_US) },
      { match: BBOX, respond: () => ({ status: 503 }) },
      { match: PHOTON, respond: () => photon() },
    ]);
    await expect(httpServices(f.fn, noSleep).geocode('airport', BARCELONA)).rejects.toBeInstanceOf(TransientError);
  });

  it('geocode: "airport" under Barcelona is El Prat, not a town called Airport', async () => {
    const f = fakeFetch(airportRoutes());
    const p = await httpServices(f.fn, noSleep).geocode('airport', BARCELONA);
    expect(p).toEqual({
      name: 'Barcelona–El Prat Airport', lat: 41.2974, lon: 2.0833,
      label: 'Barcelona–El Prat Airport, El Prat de Llobregat, Spain', kind: 'airport',
    });
    expect(f.urls.filter((u) => PHOTON.test(u) && !BBOX.test(u))).toEqual([]);
  });

  it('geocode: the bbox stage skips streets and keeps looking', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: BBOX, respond: () => photon(["Carrer de l'Aeroport", 41.38, 2.16, 'Barcelona', 'Spain', 'highway'], EL_PRAT) },
    ]);
    expect((await httpServices(f.fn, noSleep).geocode('airport', BARCELONA))?.name).toBe('Barcelona–El Prat Airport');
  });

  it('geocode: "madrid" under Barcelona is the major city, without asking Photon', async () => {
    const f = fakeFetch([{ match: OM, respond: () => om(MADRID) }, ...airportRoutes().slice(1)]);
    expect((await httpServices(f.fn, noSleep).geocode('madrid', BARCELONA))?.name).toBe('Madrid');
    expect(f.urls.filter((u) => PHOTON.test(u))).toEqual([]);
  });

  it('geocode: a town inside the area is taken from Open-Meteo without asking Photon', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Sintra', 38.8, -9.38, 'Lisbon District', 'Portugal', 26193, 'PPL']) },
      { match: PHOTON, respond: () => photon(['Sintra', 38.79, -9.39, 'Sintra', 'Portugal', 'amenity', 'cafe']) },
    ]);
    expect(await httpServices(f.fn, noSleep).geocode('sintra', LISBON_NEAR)).toMatchObject({ name: 'Sintra', lat: 38.8, kind: 'city' });
    expect(f.urls.filter((u) => PHOTON.test(u))).toEqual([]);
  });

  // Sitges itself sits about 35 km from Barcelona, just outside the 30 km box.
  const SITGES_TOWN: OmRow = ['Sitges', 41.2353, 1.78, 'Catalonia', 'Spain', 29000, 'PPL'];

  it('I4: @Sitges under Barcelona is the town 35 km away, not an in-area restaurant named Sitges', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(SITGES_TOWN) },
      { match: BBOX, respond: () => photon(['Sitges', 41.39, 2.17, 'Barcelona', 'Spain', 'amenity', 'restaurant']) },
      { match: PHOTON, respond: () => photon(['Sitges', 41.39, 2.17, 'Barcelona', 'Spain', 'amenity', 'restaurant']) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('sitges', BARCELONA);
    expect(p).toMatchObject({ name: 'Sitges', lat: 41.2353, lon: 1.78, kind: 'city' });
  });

  it('I4: @airport under Barcelona is still El Prat (the Open-Meteo "Airport" is far away)', async () => {
    const f = fakeFetch(airportRoutes());
    expect(await httpServices(f.fn, noSleep).geocode('airport', BARCELONA)).toMatchObject({ name: 'Barcelona–El Prat Airport' });
  });

  it('I4: an in-area school (icon kind street) is not taken by the area step, even with no town match', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => ({ body: {} }) },
      { match: BBOX, respond: () => photon(['Sitges', 41.39, 2.17, 'Barcelona', 'Spain', 'amenity', 'school']) },
      { match: PHOTON, respond: () => photon(['Sitges', 41.2353, 1.8117, 'Sitges', 'Spain', 'place', 'town']) },
    ]);
    const p = await httpServices(f.fn, noSleep).geocode('sitges', BARCELONA);
    expect(p).toMatchObject({ name: 'Sitges', lat: 41.2353, kind: 'city' });
    expect(f.urls.filter((u) => PHOTON.test(u) && !BBOX.test(u))).toHaveLength(1);
  });

  it('drops a same-name place within 2 km that both Open-Meteo and the bbox return', async () => {
    const f = fakeFetch([
      { match: OM, respond: () => om(['Sintra', 38.8, -9.38, 'Lisbon District', 'Portugal', 26193, 'PPL']) },
      { match: BBOX, respond: () => photon(['Sintra', 38.801, -9.381, 'Sintra', 'Portugal', 'place', 'town']) },
      { match: PHOTON, respond: () => photon() },
    ]);
    const results = await httpServices(f.fn, noSleep).search('sintra', LISBON_NEAR);
    expect(results.map((r) => r.name)).toEqual(['Sintra']);
  });

  it('a cancelled search skips both of its queued Photon calls', async () => {
    const f = fakeFetch([{ match: OM, respond: () => ({ body: {} }) }, { match: PHOTON, respond: () => photon(['X', 1, 2, 'Y', 'Z']) }]);
    const s = httpServices(f.fn, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), photonGapMs: 30 });
    const first = s.search('aaa');
    const controller = new AbortController();
    const second = s.search('bbb', BARCELONA, { signal: controller.signal });
    controller.abort();
    await first;
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.urls.filter((u) => PHOTON.test(u) && u.includes('q=bbb'))).toEqual([]);
  });
});
