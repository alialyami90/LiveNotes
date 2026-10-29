import type { Place } from '../model/types';
import type { Services } from './types';
import { inArea, searchArea, type Box } from './geo';
import { describeWeather } from './wmo';
import { isStreetTag, kindOfOpenMeteo, kindOfPhoton, photonExtent } from './kinds';
import { areaPick, isMajor, isNear, mergeSearch, toPlace, type Candidate, type SearchSources } from './rank';
import { isAbort, TransientError } from './errors';
export { TransientError };

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
/** Five decimals is about a metre; it keeps bbox URLs short. */
const coord = (n: number) => Number(n.toFixed(5));

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
        if (!(e instanceof TypeError || isAbort(e))) throw e;
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

  /** With `box`, only results inside it ([west, south, east, north]); `near` still ranks them. */
  function photon(
    q: string,
    limit: number,
    near: Place | undefined,
    priority: 'interactive' | 'background',
    signal?: AbortSignal,
    box?: Box,
  ): Promise<Candidate[]> {
    const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
    const bbox = box ? `&bbox=${box.map(coord).join(',')}` : '';
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=en${bias}${bbox}`;
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
        if (isAbort(error)) throw error;
        return { value: [] as T[], failed: true, transient: error instanceof TransientError };
      },
    );

  const failure = (...results: { failed: boolean; transient: boolean }[]) =>
    results.some((r) => r.transient) ? new TransientError('place lookup unavailable') : new Error('place lookup failed');

  return {
    async geocode(name, near) {
      const om = await settle(openMeteo(name, 1));
      // Without the town source we can't tell whether a major city wins, and a guessed landmark
      // would be stored for good; a retry later costs only a delay.
      if (om.transient) throw failure(om);
      const town = om.value[0];
      const box = near && searchArea(near);
      // A major city, or a town inside the parent's area, is what the mention means.
      if (town && (!near || isMajor(town) || (box && inArea(town, box)))) return toPlace(town);
      // Then a named place inside the area: "@airport" under Barcelona is El Prat.
      const area = box ? await settle(photon(name, 5, near, 'background', undefined, box)) : undefined;
      const inside = near && area && areaPick(area.value, town, near);
      if (inside) return toPlace(inside);
      // Then the worldwide rules: a nearby town (once the area has really been searched),
      // else the biased landmark, which a street never is.
      if (town && isNear(town, near) && !area?.transient) return toPlace(town);
      const ph = await settle(photon(name, 1, near, 'background'));
      const landmark = ph.value[0];
      if (landmark && !(landmark.street && town)) {
        // I5: while the area couldn't be searched, only a result inside it can't be overruled by it.
        if (area?.transient && box && !inArea(landmark, box)) throw failure(area);
        return toPlace(landmark);
      }
      // A far-away namesake is only acceptable once Photon has really answered, area search included.
      if (town && !ph.transient && !area?.transient) return toPlace(town);
      const tried = area ? [om, area, ph] : [om, ph];
      if (tried.some((r) => r.failed)) throw failure(...tried);
      return null;
    },

    async search(query, near, { signal, onUpdate } = {}) {
      let sources: SearchSources = { towns: [], area: [], biased: [] };
      // Each stage shows everything so far as soon as it answers; the queued Photon stages come later.
      const stage = (key: keyof SearchSources, p: Promise<Candidate[]>) =>
        settle(p).then((r) => {
          sources = { ...sources, [key]: r.value };
          if (!signal?.aborted) onUpdate?.(mergeSearch(sources, near));
          return r;
        });
      const box = near && searchArea(near);
      const results = await Promise.all([
        stage('towns', openMeteo(query, 5)),
        ...(box ? [stage('area', photon(query, 8, near, 'interactive', signal, box))] : []),
        // Still runs when the area stage fails: it fills the Elsewhere rows.
        stage('biased', photon(query, 5, near, 'interactive', signal)),
      ]);
      if (results.every((r) => r.failed)) throw failure(...results);
      return mergeSearch(sources, near);
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
