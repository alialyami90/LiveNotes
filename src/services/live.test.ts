// Diagnostics against the real APIs. Skipped unless LIVE_SERVICES=1 (CI only; the sandbox has no access).
import { describe, it } from 'vitest';
import { httpServices } from './http';

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

describe.skipIf(!process.env.LIVE_SERVICES)('live services', () => {
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
