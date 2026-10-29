import type { Place } from '../model/types';
import type { Found } from './types';
import { areaOf, haversine, inArea } from './geo';

/** Ranking and merging of place candidates (spec §6). Pure: no fetch. */

/** Candidates carry ranking hints that are dropped before a Place is stored. */
export type Candidate = Place & { population?: number; street?: boolean };

/** A town match further than this from the surrounding place is probably a namesake... */
export const NEAR_KM = 75;
/** ...unless it's a major city: "@Dammam" under Riyadh means the city, not a local namesake. */
export const MAJOR_CITY = 100_000;
const SAME_PLACE_M = 2000;
/** Rows per picker section (inside, elsewhere), and in the unsplit list. */
const SECTION_MAX = 8;

export const toPlace = ({ name, lat, lon, label, kind, extent }: Candidate): Place => ({
  name,
  lat,
  lon,
  ...(label ? { label } : {}),
  ...(kind ? { kind } : {}),
  ...(extent ? { extent } : {}),
});

export const isNear = (p: Place, near?: Place) => !near || haversine(p, near) <= NEAR_KM * 1000;
export const isMajor = (p?: Candidate) => (p?.population ?? 0) >= MAJOR_CITY;

/** What each search stage has answered so far; a stage that hasn't answered is empty. */
export interface SearchSources {
  towns: Candidate[];
  area: Candidate[];
  biased: Candidate[];
}

const sameName = (a: Place, b: Place) => a.name.toLowerCase() === b.name.toLowerCase();

/** Drops same-name places within 2 km of one already kept; `kept` is shared across sections. */
function dedupe(list: Candidate[], kept: Place[]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of list) {
    if (kept.some((o) => sameName(o, p) && haversine(o, p) < SAME_PLACE_M)) continue;
    kept.push(p);
    out.push(p);
  }
  return out;
}

/**
 * The picker list. With a parent place: rows inside its area (settlements and named places
 * before streets, then nearest first), then rows elsewhere flagged `elsewhere` (major cities,
 * other towns, landmarks). Without one, today's single list: majors, towns, landmarks.
 */
export function mergeSearch({ towns, area, biased }: SearchSources, near?: Place): Found[] {
  const majors = towns.filter((p) => isMajor(p));
  const minor = towns.filter((p) => !isMajor(p));
  if (!near) return dedupe([...majors, ...minor, ...area, ...biased], []).slice(0, SECTION_MAX).map(toPlace);

  const box = areaOf(near);
  const outside = (p: Candidate) => !inArea(p, box);
  const inside = [...towns, ...area, ...biased]
    .filter((p) => !outside(p))
    .map((p) => ({ p, street: Number(!!p.street), m: haversine(p, near) }))
    .sort((a, b) => a.street - b.street || a.m - b.m)
    .map(({ p }) => p);
  const elsewhere = [...majors.filter(outside), ...minor.filter(outside), ...area.filter(outside), ...biased.filter(outside)];

  const kept: Place[] = [];
  const insideRows = dedupe(inside, kept).slice(0, SECTION_MAX).map(toPlace);
  const elsewhereRows = dedupe(elsewhere, kept)
    .slice(0, SECTION_MAX)
    .map((p): Found => ({ ...toPlace(p), elsewhere: true }));
  return [...insideRows, ...elsewhereRows];
}
