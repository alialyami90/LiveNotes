// Diagnostics against the real APIs. Skipped unless LIVE_SERVICES=1 (CI only; the sandbox has no access).
import { describe, expect, it } from 'vitest';
import { httpServices } from './http';
import { areaOf, inArea } from './geo';
import { kindOfPhoton, photonExtent } from './kinds';

const NAMES = [
  'lisbon', 'praça do comércio', 'time out market', 'belém tower', 'pastéis de belém',
  'miradouro da senhora do monte', 'porto', 'coimbra', 'vila nova de gaia', 'livraria lello',
  'sintra', 'cascais', 'pinhão', 'dammam', 'khobar', 'Time Out Market', 'Dammam',
];

async function probe(q: string) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`;
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { Referer: 'https://localhost/' } });
    const body = await res.text();
    let summary = body.slice(0, 160);
    try {
      const j = JSON.parse(body);
      const f = j.features?.[0];
      summary = f ? `${f.properties.name} | ${f.properties.city ?? ''} | ${f.properties.country ?? ''} | ${f.geometry.coordinates}` : `0 features`;
    } catch { /* not JSON */ }
    return `${res.status} ${Date.now() - t}ms  ${JSON.stringify(q)} → ${summary}`;
  } catch (e) {
    return `ERR ${JSON.stringify(q)} → ${(e as Error).message}`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function show(label: string, url: string) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { Referer: 'https://localhost/' } });
    const text = await res.text();
    let out = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      if (j.results) out = j.results.slice(0, 3).map((r: Record<string, unknown>) => `${r.name}/${r.admin1}/${r.country} pop=${r.population}`).join(' ; ') || '0 results';
      if (j.features) out = j.features.slice(0, 3).map((f: { properties: Record<string, string> }) => `${f.properties.name}/${f.properties.city ?? ''}/${f.properties.country}`).join(' ; ') || '0 features';
    } catch { /* not JSON */ }
    console.log(`[${label}] ${res.status} ${Date.now() - t}ms ${out}`);
  } catch (e) {
    console.log(`[${label}] ERR ${(e as Error).message}`);
  }
}

describe.skipIf(!process.env.LIVE_SERVICES)('live: open-meteo geocoding and paced photon', () => {
  it('open-meteo geocoding ranks by population', async () => {
    for (const q of ['lisbon', 'porto', 'dammam', 'khobar', 'sintra', 'time out market', 'belém tower', 'ribeira']) {
      await show(`om ${q}`, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=3&language=en&format=json`);
    }
  }, 60_000);

  it('photon paced at 1 request/second, english, biased', async () => {
    for (const q of ['lisbon', 'dammam', 'time out market', 'ribeira', 'livraria lello', 'vila nova de gaia']) {
      await show(`photon-en ${q}`, `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=3&lang=en`);
      await sleep(1000);
    }
    await show('photon-bias ribeira@porto', `https://photon.komoot.io/api/?q=ribeira&limit=3&lang=en&lat=41.15&lon=-8.61`);
  }, 90_000);
});

describe.skipIf(!process.env.LIVE_SERVICES)('live: the app\'s own httpServices', () => {
  const s = httpServices();
  it('geocode picks the right Lisbon and finds a landmark near it', async () => {
    // Diagnostic: since the kinds change, geocode('lisbon') has come back as Photon's Lisbon
    // district (38.995) instead of Open-Meteo's city (38.725). Log the app's exact request.
    // Open-Meteo is sometimes unreachable from CI runners (connect timeouts), so this never fails the test.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const raw = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=lisbon&count=1&language=en&format=json', { signal: AbortSignal.timeout(8000) });
        console.log(`[om-app lisbon #${attempt}]`, raw.status, (await raw.text()).slice(0, 400));
      } catch (e) {
        console.log(`[om-app lisbon #${attempt}] ERR`, (e as Error).message, String((e as { cause?: unknown }).cause ?? ''));
      }
    }
    const lisbon = await s.geocode('lisbon');
    console.log('[app] lisbon', JSON.stringify(lisbon));
    expect(lisbon?.label).toContain('Portugal');
    const market = await s.geocode('time out market', lisbon!);
    console.log('[app] time out market near lisbon', JSON.stringify(market));
    expect(market && Math.abs(market.lat - 38.707) < 0.05).toBe(true);
    const dammam = await s.geocode('dammam');
    console.log('[app] dammam', JSON.stringify(dammam));
    expect(dammam?.label).toContain('Saudi Arabia');
  }, 60_000);

  it('a far city under a parent city is not swapped for a local street', async () => {
    const riyadh = await s.geocode('riyadh');
    const dammam = await s.geocode('dammam', riyadh!);
    console.log('[app] dammam near riyadh', JSON.stringify(dammam));
    expect(dammam?.label).toContain('Saudi Arabia');
    expect(Math.abs(dammam!.lat - 26.43) < 0.3 && Math.abs(dammam!.lon - 50.1) < 0.3).toBe(true);
    const porto = await s.geocode('porto', (await s.geocode('lisbon'))!);
    console.log('[app] porto near lisbon', JSON.stringify(porto));
    expect(Math.abs(porto!.lat - 41.15) < 0.2).toBe(true);
  }, 60_000);

  it('search returns candidates for the picker', async () => {
    const results = await s.search('khobar');
    console.log('[app] search khobar', results.map((r) => r.label).join(' ; '));
    expect(results.length).toBeGreaterThan(0);
  }, 60_000);

  it('area search: "airport" under Barcelona lists an aerodrome among the inside rows', async () => {
    const barcelona = (await s.geocode('barcelona'))!;
    console.log('[app] barcelona', JSON.stringify(barcelona));
    const results = await s.search('airport', barcelona);
    console.log(
      '[app] search airport near barcelona',
      results.map((r) => `${r.name} (${r.kind}${r.elsewhere ? ', elsewhere' : ''}) ${r.lat},${r.lon}`).join(' ; '),
    );
    // Inside rows are ordered by distance from the city centre, not relevance: an "Aeroport"
    // metro stop or an airport hotel can come before the aerodrome itself.
    const inside = results.filter((r) => !r.elsewhere);
    const box = areaOf(barcelona);
    expect(inside.some((r) => r.kind === 'airport' && inArea(r, box)), 'no in-area airport among the inside rows').toBe(true);
  }, 60_000);

  it('area search: "cafe" near Lisbon finds a place of kind cafe', async () => {
    const lisbon = (await s.geocode('lisbon'))!;
    const results = await s.search('cafe', lisbon);
    console.log('[app] search cafe near lisbon', results.map((r) => `${r.name} (${r.kind})`).join(' ; '));
    expect(results.some((r) => r.kind === 'cafe')).toBe(true);
  }, 60_000);

  it('a Photon city has a valid extent once reordered to [west, south, east, north]', async () => {
    // Photon throttles bursts (CLAUDE.md §5), and the tests above just used it: pause, retry once.
    const url = 'https://photon.komoot.io/api/?q=barcelona&limit=3&lang=en&osm_tag=place:city';
    const get = () => fetch(url, { headers: { Referer: 'https://localhost/' } });
    await sleep(1500);
    let res = await get();
    if (!res.ok) {
      console.log('[photon] barcelona first try', res.status);
      await sleep(3000);
      res = await get();
    }
    expect(res.ok, `photon answered ${res.status}`).toBe(true);
    const data = (await res.json()) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] };
    const city = data.features.find((f) => f.properties.extent);
    console.log('[photon] barcelona', res.status, JSON.stringify(city?.properties), city?.geometry.coordinates);
    const extent = photonExtent(city?.properties.extent);
    expect(extent).toBeDefined();
    const [west, south, east, north] = extent!;
    expect(west < east && south < north).toBe(true);
    const [lon, lat] = city!.geometry.coordinates;
    expect(inArea({ lat, lon }, extent!)).toBe(true);
    expect(kindOfPhoton(city!.properties.osm_key as string, city!.properties.osm_value as string)).toBe('city');
  }, 60_000);

  it('weather, route and map tiles answer', async () => {
    const lisbon = (await s.geocode('lisbon'))!;
    const porto = (await s.geocode('porto'))!;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const w = await s.weather(lisbon, tomorrow);
    console.log('[app] weather', JSON.stringify(w));
    const r = await s.route(lisbon, porto);
    console.log('[app] route', r.seconds, r.meters);
    expect(r.meters).toBeGreaterThan(250000);
    const tile = await fetch('https://tile.openstreetmap.org/5/15/12.png', { headers: { Referer: 'https://localhost/' } });
    console.log('[app] tile', tile.status, tile.headers.get('content-type'));
  }, 60_000);
});

describe.skipIf(!process.env.LIVE_SERVICES || !!process.env.SKIP_BURST)('live services', () => {
  it('photon: sequential', async () => {
    for (const q of NAMES) console.log('[seq]', await probe(q));
  }, 120_000);

  it('photon: burst (like first app load)', async () => {
    const out = await Promise.all(NAMES.map(probe));
    out.forEach((l) => console.log('[burst]', l));
  }, 120_000);

  it('httpServices end to end', async () => {
    const s = httpServices();
    const lisbon = await s.geocode('lisbon');
    const porto = await s.geocode('porto');
    console.log('[svc] geocode', JSON.stringify(lisbon), JSON.stringify(porto));
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    console.log('[svc] weather', JSON.stringify(await s.weather(lisbon!, tomorrow).catch((e) => String(e))));
    const r = await s.route(lisbon!, porto!).catch((e) => String(e));
    console.log('[svc] route', typeof r === 'string' ? r : JSON.stringify({ ...r, geometry: r.geometry?.length }));
    const tile = await fetch('https://tile.openstreetmap.org/5/15/12.png', { headers: { Referer: 'https://localhost/' } });
    console.log('[svc] tile', tile.status, tile.headers.get('content-type'));
  }, 120_000);
});
