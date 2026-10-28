import type { Place } from '../model/types';
import type { Weather } from '../formula/values';
import type { Services } from './types';

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

export function httpServices(fetchFn: typeof fetch = (...a) => fetch(...a)): Services {
  const getJson = async <T>(url: string, failure: string): Promise<T> => {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(failure);
    return (await res.json()) as T;
  };

  return {
    async geocode(name) {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(name)}&limit=1`;
      const data = await getJson<PhotonResponse>(url, 'place lookup unavailable');
      const f = data.features?.[0];
      if (!f) return null;
      const [lon, lat] = f.geometry.coordinates;
      const { name: fname, city, country } = f.properties;
      const label = [fname, city, country].filter((s, i, all) => s && all.indexOf(s) === i).join(', ');
      const place: Place = { name: fname ?? name, lat, lon };
      return label ? { ...place, label } : place;
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
