import { describe, expect, it } from 'vitest';
import type { PlaceKind } from '../model/types';
import { isStreetTag, KIND_ICON, kindOfOpenMeteo, kindOfPhoton, photonExtent, placeIcon } from './kinds';

// Every row of the spec's §5 table: [key, value, kind].
const PHOTON_ROWS: [string, string, PlaceKind][] = [
  ['place', 'country', 'region'],
  ['place', 'state', 'region'],
  ['place', 'region', 'region'],
  ['place', 'province', 'region'],
  ['boundary', 'administrative', 'region'],
  ['place', 'city', 'city'],
  ['place', 'town', 'city'],
  ['place', 'village', 'village'],
  ['place', 'hamlet', 'village'],
  ['place', 'suburb', 'neighbourhood'],
  ['place', 'neighbourhood', 'neighbourhood'],
  ['place', 'quarter', 'neighbourhood'],
  ['place', 'borough', 'neighbourhood'],
  ['place', 'district', 'neighbourhood'],
  ['amenity', 'restaurant', 'restaurant'],
  ['amenity', 'fast_food', 'restaurant'],
  ['amenity', 'food_court', 'restaurant'],
  ['amenity', 'cafe', 'cafe'],
  ['amenity', 'ice_cream', 'cafe'],
  ['amenity', 'bar', 'bar'],
  ['amenity', 'pub', 'bar'],
  ['amenity', 'biergarten', 'bar'],
  ['shop', 'bakery', 'shop'],
  ['shop', 'supermarket', 'shop'],
  ['amenity', 'marketplace', 'shop'],
  ['tourism', 'hotel', 'stay'],
  ['tourism', 'hostel', 'stay'],
  ['tourism', 'guest_house', 'stay'],
  ['tourism', 'apartment', 'stay'],
  ['tourism', 'motel', 'stay'],
  ['tourism', 'attraction', 'sight'],
  ['tourism', 'museum', 'sight'],
  ['tourism', 'gallery', 'sight'],
  ['tourism', 'viewpoint', 'sight'],
  ['tourism', 'artwork', 'sight'],
  ['historic', 'castle', 'sight'],
  ['historic', 'monument', 'sight'],
  ['leisure', 'park', 'park'],
  ['leisure', 'garden', 'park'],
  ['landuse', 'forest', 'park'],
  ['natural', 'beach', 'beach'],
  ['natural', 'peak', 'nature'],
  ['natural', 'volcano', 'nature'],
  ['boundary', 'protected_area', 'nature'],
  ['aeroway', 'aerodrome', 'airport'],
  ['aeroway', 'terminal', 'airport'],
  ['railway', 'station', 'station'],
  ['railway', 'halt', 'station'],
  ['amenity', 'bus_station', 'station'],
  ['public_transport', 'station', 'station'],
  ['highway', 'primary', 'street'],
  ['place', 'house', 'street'],
  ['building', 'yes', 'street'],
  ['amenity', 'hospital', 'street'],
  ['natural', 'water', 'street'],
];

describe('kindOfPhoton', () => {
  it.each(PHOTON_ROWS)('%s=%s is %s', (key, value, kind) => {
    expect(kindOfPhoton(key, value)).toBe(kind);
  });

  it('anything unknown or missing is a street', () => {
    expect(kindOfPhoton(undefined, undefined)).toBe('street');
    expect(kindOfPhoton('place', undefined)).toBe('street');
    expect(kindOfPhoton('tourism', 'zoo')).toBe('street');
  });
});

describe('kindOfOpenMeteo', () => {
  it.each<[string | undefined, number | undefined, PlaceKind]>([
    ['PPLC', undefined, 'city'],
    ['PPLA', 5, 'city'],
    ['PPLA2', undefined, 'city'],
    ['PPLA4', undefined, 'city'],
    ['PPL', 12000, 'city'],
    ['PPL', 10000, 'city'],
    ['PPL', 900, 'village'],
    ['PPL', undefined, 'village'],
    ['ADM1', undefined, 'region'],
    ['ADM2', 300000, 'region'],
    ['PCLI', undefined, 'region'],
    ['PPLX', 50000, 'village'],
    ['PPLG', undefined, 'village'],
    [undefined, undefined, 'village'],
  ])('%s with population %s is %s', (code, population, kind) => {
    expect(kindOfOpenMeteo(code, population)).toBe(kind);
  });
});

describe('placeIcon', () => {
  it('uses the kind table and falls back to the pin', () => {
    expect(placeIcon({ kind: 'cafe' })).toBe('☕');
    expect(placeIcon({})).toBe('📍');
    expect(placeIcon()).toBe('📍');
    expect(placeIcon({ kind: 'spaceship' as PlaceKind })).toBe('📍');
  });

  it('has an icon for every row of the spec', () => {
    expect(KIND_ICON).toEqual({
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
    });
  });
});

describe('photonExtent', () => {
  it('reorders [west, north, east, south] into [west, south, east, north]', () => {
    expect(photonExtent([2.05, 41.47, 2.23, 41.32])).toEqual([2.05, 41.32, 2.23, 41.47]);
  });

  it('is undefined unless there are four finite numbers', () => {
    expect(photonExtent([1, 2])).toBeUndefined();
    expect(photonExtent('x')).toBeUndefined();
    expect(photonExtent(undefined)).toBeUndefined();
    expect(photonExtent([1, NaN, 2, 3])).toBeUndefined();
    expect(photonExtent([1, '2', 3, 4])).toBeUndefined();
    expect(photonExtent([1, 2, 3, Infinity])).toBeUndefined();
  });
});

describe('isStreetTag (ranking: only roads and buildings never beat a settlement)', () => {
  it('is true for highways, buildings and houses', () => {
    expect(isStreetTag('highway', 'primary')).toBe(true);
    expect(isStreetTag('building', 'yes')).toBe(true);
    expect(isStreetTag('place', 'house')).toBe(true);
  });

  it('is false for everything else, so a hospital can beat a far namesake town', () => {
    expect(isStreetTag('amenity', 'hospital')).toBe(false);
    expect(isStreetTag('place', 'town')).toBe(false);
    expect(isStreetTag(undefined, undefined)).toBe(false);
  });
});
