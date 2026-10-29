import type { Place } from '../model/types';
import type { Weather } from '../formula/values';
import type { Services } from './types';
import { haversine } from './geo';

/** The service couldn't be reached or is overloaded; worth retrying later. */
export class TransientError extends Error {}

/** WMO weather interpretation codes, grouped coarsely. */
function describeWeather(code: number): Pick<Weather, 'condition' | 'icon'> {
  if (code === 0) return { condition: 'Clear', icon: '☀️' };
  if (code <= 3) return { condition: 'Partly cloudy', icon: '⛅' };
  if (code === 45 || code === 48) return { condition: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 67) return { condition: 'Rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { condition: 'Snow', icon: '🌨️' };
  if (code >= 80 && code <= 86) return { condition: 'Showers', icon: '🌦️' };
  if (code >= 95) return { condition: 'Thunderstorm', icon: '⛈️' };
  return { condition: 'Cloudy', icon: '☁️' };
}

interface OpenMeteoGeoResponse {
  results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[];
}

interface PhotonResponse {
  features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[];
}

interface MeteoResponse {
  daily?: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
}

interface OsrmResponse {
  code?: string;
  routes?: { duration: number; distance: number; geometry?: { coordinates: [number, number][] } }[];
}

export interface HttpOptions {
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Photon's public server throttles bursts (503, then refused connections). */
  photonGapMs?: number;
}

const RETRY_DELAYS_MS = [700, 2000];
/** A town match further than this from the surrounding place is probably a namesake. */
const NEAR_KM = 75;
const SAME_PLACE_M = 2000;

const label = (...parts: (string | undefined)[]) =>
  parts.filter((p, i, all): p is string => !!p && all.indexOf(p) === i).join(', ');

export function httpServices(fetchFn: typeof fetch = (...a) => fetch(...a), opts: HttpOptions = {}): Services {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 8000;
  const photonGapMs = opts.photonGapMs ?? 1100;

  /** Retries overload and network failures; a 4xx is the caller's problem and isn't retried. */
  async function getJson<T>(url: string, failure: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let retryable: boolean;
      try {
        const res = await fetchFn(url, { signal: controller.signal });
        if (res.ok) return (await res.json()) as T;
        retryable = res.status === 429 || res.status >= 500;
        if (!retryable) throw new Error(failure);
      } catch (e) {
        if (!(e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError'))) throw e;
        retryable = true;
      } finally {
        clearTimeout(timer);
      }
      if (attempt >= RETRY_DELAYS_MS.length) throw new TransientError(failure);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  let photonQueue: Promise<unknown> = Promise.resolve();
  let photonLast = 0;
  /** One Photon request at a time, spaced out, so a page full of mentions isn't a burst. */
  function viaPhotonQueue<T>(task: () => Promise<T>): Promise<T> {
    const run = photonQueue.then(async () => {
      const wait = photonLast + photonGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        photonLast = Date.now();
      }
    });
    photonQueue = run.catch(() => undefined);
    return run;
  }

  async function openMeteo(q: string, count: number): Promise<Place[]> {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
    const data = await getJson<OpenMeteoGeoResponse>(url, 'place lookup unavailable');
    return (data.results ?? []).map((r) => ({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      label: label(r.name, r.admin1, r.country),
    }));
  }

  function photon(q: string, limit: number, near?: Place): Promise<Place[]> {
    const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=en${bias}`;
    return viaPhotonQueue(async () => {
      const data = await getJson<PhotonResponse>(url, 'place lookup unavailable');
      return (data.features ?? []).map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        const { name, city, county, state, country } = f.properties;
        const n = name ?? q;
        return { name: n, lat, lon, label: label(n, city ?? county ?? state, country) };
      });
    });
  }

  const settle = <T>(p: Promise<T>) =>
    p.then(
      (value) => ({ value, failed: false as const }),
      (error: unknown) => {
        if (!(error instanceof TransientError)) throw error;
        return { value: [] as never as T, failed: true as const };
      },
    );

  const isNear = (p: Place, near?: Place) => !near || haversine(p, near) <= NEAR_KM * 1000;

  return {
    async geocode(name, near) {
      const om = await settle(openMeteo(name, 1));
      const town = om.value[0];
      if (town && isNear(town, near)) return town;
      const ph = await settle(photon(name, 1, near));
      const found = ph.value[0] ?? town;
      if (found) return found;
      if (om.failed || ph.failed) throw new TransientError('place lookup unavailable');
      return null;
    },

    async search(query, near) {
      const [om, ph] = await Promise.all([settle(openMeteo(query, 5)), settle(photon(query, 5, near))]);
      if (om.failed && ph.failed) throw new TransientError('place lookup unavailable');
      // Near a known place, biased landmarks lead; otherwise population-ranked towns do.
      const ordered = near
        ? [...ph.value.filter((p) => isNear(p, near)), ...om.value, ...ph.value.filter((p) => !isNear(p, near))]
        : [...om.value, ...ph.value];
      const out: Place[] = [];
      for (const p of ordered) {
        if (!out.some((o) => haversine(o, p) < SAME_PLACE_M && o.name.toLowerCase() === p.name.toLowerCase())) out.push(p);
      }
      return out.slice(0, 8);
    },

    async weather(p, iso) {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${iso}&end_date=${iso}`;
      const data = await getJson<MeteoResponse>(url, 'weather unavailable');
      const d = data.daily;
      if (!d || d.weather_code[0] == null) throw new Error('weather unavailable');
      const code = d.weather_code[0];
      return { code, ...describeWeather(code), high: d.temperature_2m_max[0], low: d.temperature_2m_min[0] };
    },

    async route(a, b) {
      const url =
        `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}` +
        `?overview=full&geometries=geojson`;
      const data = await getJson<OsrmResponse>(url, 'routing unavailable');
      const r = data.routes?.[0];
      if (data.code !== 'Ok' || !r) throw new Error('no route found');
      const geometry = r.geometry?.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
      return geometry ? { seconds: r.duration, meters: r.distance, geometry } : { seconds: r.duration, meters: r.distance };
    },
  };
}
