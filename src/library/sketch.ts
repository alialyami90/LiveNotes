/**
 * Equirectangular projection into a w×h box, keeping the aspect ratio. Longitude is
 * shrunk by cos(latitude) so a route doesn't look stretched away from the equator.
 * North is up, and the sketch is centred in the box.
 */
export function projectSketch(
  places: { lat: number; lon: number }[],
  w: number,
  h: number,
  pad = 6,
): { x: number; y: number }[] {
  if (places.length === 0) return [];
  const lats = places.map((p) => p.lat);
  const lons = places.map((p) => p.lon);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);

  const dx = (maxLon - minLon) * k;
  const dy = maxLat - minLat;
  const fit = Math.min(dx > 0 ? (w - 2 * pad) / dx : Infinity, dy > 0 ? (h - 2 * pad) / dy : Infinity);
  const scale = Number.isFinite(fit) ? fit : 0; // a single point (or coincident ones) has no extent

  const cx = ((minLon + maxLon) / 2) * k;
  const cy = (minLat + maxLat) / 2;
  return places.map((p) => ({
    x: w / 2 + (p.lon * k - cx) * scale,
    y: h / 2 - (p.lat - cy) * scale,
  }));
}
