import type { Place } from '../model/types';

const EARTH_RADIUS_M = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversine(a: Pick<Place, 'lat' | 'lon'>, b: Pick<Place, 'lat' | 'lon'>): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** [west, south, east, north] in degrees, the order Photon's `bbox` takes. */
export type Box = [number, number, number, number];

/** Without a known extent, a place's area reaches this far in each direction. */
export const AREA_KM = 30;

const isBox = (e: unknown): e is Box =>
  Array.isArray(e) &&
  e.length === 4 &&
  e.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  e[0] < e[2] &&
  e[1] < e[3];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The area a bullet's children are searched in: a box reaching 30 km around the place, grown to
 * cover its own extent. A city's extent is its municipal boundary, which often leaves out its
 * airport and suburbs (Barcelona's excludes El Prat), so an extent never shrinks the area.
 * Imported documents can hold any `extent`, so a malformed one is ignored.
 */
export function areaOf(p: Place): Box {
  const dLat = (AREA_KM * 1000) / (EARTH_RADIUS_M * rad(1));
  // Near the poles a degree of longitude shrinks to nothing; the clamp keeps the box finite.
  const dLon = dLat / Math.max(Math.cos(rad(p.lat)), 0.01);
  const box: Box = [clamp(p.lon - dLon, -180, 180), clamp(p.lat - dLat, -90, 90), clamp(p.lon + dLon, -180, 180), clamp(p.lat + dLat, -90, 90)];
  if (!isBox(p.extent)) return box;
  const [w, s, e, n] = p.extent;
  return [Math.min(w, box[0]), Math.min(s, box[1]), Math.max(e, box[2]), Math.max(n, box[3])];
}

/**
 * The area to search a parent place's children in, if it has a meaningful one. A
 * country or region geocoded without an extent would get a 30 km box around its
 * centre, which means nothing (M3), so it has none and searches stay biased only.
 */
export function searchArea(p: Place): Box | undefined {
  return p.kind === 'region' && !isBox(p.extent) ? undefined : areaOf(p);
}

export function inArea(p: Pick<Place, 'lat' | 'lon'>, [west, south, east, north]: Box): boolean {
  return p.lon >= west && p.lon <= east && p.lat >= south && p.lat <= north;
}
