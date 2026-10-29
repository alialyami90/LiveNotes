import type { Place, PlaceKind } from '../model/types';

/** Spec §5. Pure: no React, no fetch. */
export const KIND_ICON: Record<PlaceKind, string> = {
  region: '🗺️',
  city: '🏙️',
  village: '🏘️',
  neighbourhood: '🏠',
  restaurant: '🍽️',
  cafe: '☕',
  bar: '🍷',
  shop: '🛍️',
  stay: '🛏️',
  sight: '🏛️',
  park: '🌳',
  beach: '🏖️',
  nature: '⛰️',
  airport: '✈️',
  station: '🚉',
  street: '📍',
};

const FALLBACK_ICON = '📍';

/** Tolerates a missing or unknown kind: imported documents can hold anything. */
export function placeIcon(p?: Pick<Place, 'kind'>): string {
  const kind = p?.kind;
  return (kind && Object.prototype.hasOwnProperty.call(KIND_ICON, kind) ? KIND_ICON[kind] : undefined) ?? FALLBACK_ICON;
}

const PLACE_KINDS: Record<string, PlaceKind> = {
  country: 'region',
  state: 'region',
  region: 'region',
  province: 'region',
  city: 'city',
  town: 'city',
  village: 'village',
  hamlet: 'village',
  suburb: 'neighbourhood',
  neighbourhood: 'neighbourhood',
  quarter: 'neighbourhood',
  borough: 'neighbourhood',
  district: 'neighbourhood',
};

const AMENITY_KINDS: Record<string, PlaceKind> = {
  restaurant: 'restaurant',
  fast_food: 'restaurant',
  food_court: 'restaurant',
  cafe: 'cafe',
  ice_cream: 'cafe',
  bar: 'bar',
  pub: 'bar',
  biergarten: 'bar',
  marketplace: 'shop',
  bus_station: 'station',
};

const STAY_VALUES = new Set(['hotel', 'hostel', 'guest_house', 'apartment', 'motel']);
const SIGHT_VALUES = new Set(['attraction', 'museum', 'gallery', 'viewpoint', 'artwork']);

/** What a Photon feature is, from its OSM tag. Unknown tags are `street` (a plain pin). */
export function kindOfPhoton(osmKey?: string, osmValue?: string): PlaceKind {
  const v = osmValue ?? '';
  switch (osmKey) {
    case 'place':
      return PLACE_KINDS[v] ?? 'street';
    case 'boundary':
      return v === 'administrative' ? 'region' : v === 'protected_area' ? 'nature' : 'street';
    case 'amenity':
      return AMENITY_KINDS[v] ?? 'street';
    case 'shop':
      return 'shop';
    case 'tourism':
      return STAY_VALUES.has(v) ? 'stay' : SIGHT_VALUES.has(v) ? 'sight' : 'street';
    case 'historic':
      return 'sight';
    case 'leisure':
      return v === 'park' || v === 'garden' ? 'park' : 'street';
    case 'landuse':
      return v === 'forest' ? 'park' : 'street';
    case 'natural':
      return v === 'beach' ? 'beach' : v === 'peak' || v === 'volcano' ? 'nature' : 'street';
    case 'aeroway':
      return v === 'aerodrome' || v === 'terminal' ? 'airport' : 'street';
    case 'railway':
      return v === 'station' || v === 'halt' ? 'station' : 'street';
    case 'public_transport':
      return v === 'station' ? 'station' : 'street';
    default:
      return 'street';
  }
}

/** Open-Meteo only returns settlements and administrative areas (GeoNames feature codes). */
export function kindOfOpenMeteo(featureCode?: string, population?: number): PlaceKind {
  const code = featureCode ?? '';
  if (code === 'PPLC' || /^PPLA\d?$/.test(code)) return 'city';
  if (code === 'PPL' && (population ?? 0) >= 10_000) return 'city';
  if (code.startsWith('ADM') || code.startsWith('PCL')) return 'region';
  return 'village';
}

/**
 * Ranking meaning of "street" (R7): only roads, buildings and houses never beat a settlement.
 * This is narrower than the icon's `street` kind, so a hospital isn't lost to a far namesake town.
 */
export function isStreetTag(osmKey?: string, osmValue?: string): boolean {
  return osmKey === 'highway' || osmKey === 'building' || (osmKey === 'place' && osmValue === 'house');
}

/** Photon's `extent` is [west, north, east, south]; places store [west, south, east, north]. */
export function photonExtent(e: unknown): Place['extent'] | undefined {
  if (!Array.isArray(e) || e.length !== 4 || !e.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  const [west, north, east, south] = e as number[];
  return [west, south, east, north];
}
