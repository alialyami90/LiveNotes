import type { Place } from '../model/types';
import type { Weather } from '../formula/values';
import type { Services } from './types';
import { haversine } from './geo';
import { isStreetTag, kindOfOpenMeteo, kindOfPhoton, photonExtent } from './kinds';

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
  results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string; population?: number; feature_code?: string }[];
}

interface PhotonResponse {
  features?: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[];
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
/** A town match further than this from the surrounding place is probably a namesake... */
const NEAR_KM = 75;
/** ...unless it's a major city: "@Dammam" under Riyadh means the city, not a local namesake. */
const MAJOR_CITY = 100_000;

/** Candidates carry ranking hints that are dropped before a Place is stored. */
type Candidate = Place & { population?: number; street?: boolean };
const toPlace = ({ name, lat, lon, label, kind, extent }: Candidate): Place => ({
  name,
  lat,
  lon,
  ...(label ? { label } : {}),
  ...(kind ? { kind } : {}),
  ...(extent ? { extent } : {}),
});
const SAME_PLACE_M = 2000;

const label = (...parts: (string | undefined)[]) =>
  parts.filter((p, i, all): p is string => !!p && all.indexOf(p) === i).join(', ');

export function httpServices(fetchFn: typeof fetch = (...a) => fetch(...a), opts: HttpOptions = {}): Services {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 8000;
  const photonGapMs = opts.photonGapMs ?? 1100;

  /** Retries overload and network failures; a 4xx is the caller's problem and isn't retried. */
  async function getJson<T>(url: string, failure: string, minRetryDelayMs = 0): Promise<T> {
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
      await sleep(Math.max(RETRY_DELAYS_MS[attempt], minRetryDelayMs));
    }
  }

  // One Photon request at a time, spaced out, so a page full of mentions isn't a burst.
  // Searches the user is typing go ahead of background lookups; a cancelled search is skipped.
  interface QueuedTask {
    run(): Promise<void>;
    skip(): void;
    signal?: AbortSignal;
  }
  const queues: Record<'interactive' | 'background', QueuedTask[]> = { interactive: [], background: [] };
  let pumping = false;
  let photonLast = 0;

  const nextTask = () => queues.interactive.shift() ?? queues.background.shift();

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queues.interactive.length || queues.background.length) {
        // Wait out the spacing *before* choosing, so a search typed meanwhile can go first.
        const wait = photonLast + photonGapMs - Date.now();
        if (wait > 0) await sleep(wait);
        const task = nextTask();
        if (!task) break;
        if (task.signal?.aborted) {
          task.skip();
          continue;
        }
        await task.run();
        photonLast = Date.now();
      }
    } finally {
      pumping = false;
    }
  }

  function viaPhotonQueue<T>(task: () => Promise<T>, priority: 'interactive' | 'background', signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queues[priority].push({
        signal,
        skip: () => reject(new DOMException('search cancelled', 'AbortError')),
        run: () => task().then(resolve, reject),
      });
      void pump();
    });
  }

  async function openMeteo(q: string, count: number): Promise<Candidate[]> {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
    const data = await getJson<OpenMeteoGeoResponse>(url, 'place lookup unavailable');
    return (data.results ?? []).map((r) => ({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      label: label(r.name, r.admin1, r.country),
      population: r.population,
      kind: kindOfOpenMeteo(r.feature_code, r.population),
    }));
  }

  function photon(q: string, limit: number, near: Place | undefined, priority: 'interactive' | 'background', signal?: AbortSignal): Promise<Candidate[]> {
    const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=en${bias}`;
    return viaPhotonQueue(async () => {
      const data = await getJson<PhotonResponse>(url, 'place lookup unavailable', photonGapMs);
      return (data.features ?? []).map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;
        const str = (k: string) => (typeof props[k] === 'string' ? (props[k] as string) : undefined);
        const n = str('name') ?? q;
        const osmKey = str('osm_key');
        const osmValue = str('osm_value');
        return {
          name: n,
          lat,
          lon,
          label: label(n, str('city') ?? str('county') ?? str('state'), str('country')),
          kind: kindOfPhoton(osmKey, osmValue),
          extent: photonExtent(props.extent),
          street: isStreetTag(osmKey, osmValue),
        };
      });
    }, priority, signal);
  }

  /** A source's answer, or how it failed; a cancelled search still rejects. */
  const settle = <T>(p: Promise<T[]>) =>
    p.then(
      (value) => ({ value, failed: false, transient: false }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        return { value: [] as T[], failed: true, transient: error instanceof TransientError };
      },
    );

  const failure = (...results: { failed: boolean; transient: boolean }[]) =>
    results.some((r) => r.transient) ? new TransientError('place lookup unavailable') : new Error('place lookup failed');

  const isNear = (p: Place, near?: Place) => !near || haversine(p, near) <= NEAR_KM * 1000;
  const isMajor = (p?: Candidate) => (p?.population ?? 0) >= MAJOR_CITY;

  return {
    async geocode(name, near) {
      const om = await settle(openMeteo(name, 1));
      const town = om.value[0];
      if (town && (isNear(town, near) || isMajor(town))) return toPlace(town);
      const ph = await settle(photon(name, 1, near, 'background'));
      const landmark = ph.value[0];
      if (landmark && !(landmark.street && town)) return toPlace(landmark);
      // A far-away namesake is only acceptable once Photon has really answered.
      if (town && !ph.transient) return toPlace(town);
      if (om.failed || ph.failed) throw failure(om, ph);
      return null;
    },

    async search(query, near, opts = {}) {
      const townsP = settle(openMeteo(query, 5));
      void townsP.then((r) => r.value.length && opts.onTowns?.(r.value.map(toPlace)), () => undefined);
      const [om, ph] = await Promise.all([townsP, settle(photon(query, 5, near, 'interactive', opts.signal))]);
      if (om.failed && ph.failed) throw failure(om, ph);
      // Major cities lead; then, near a known place, biased landmarks; then the remaining towns.
      const majors = om.value.filter((p) => isMajor(p));
      const towns = om.value.filter((p) => !isMajor(p));
      const ordered = near
        ? [...majors, ...ph.value.filter((p) => isNear(p, near)), ...towns, ...ph.value.filter((p) => !isNear(p, near))]
        : [...majors, ...towns, ...ph.value];
      const out: Place[] = [];
      for (const p of ordered) {
        if (!out.some((o) => haversine(o, p) < SAME_PLACE_M && o.name.toLowerCase() === p.name.toLowerCase())) out.push(toPlace(p));
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
