import { describe, expect, it } from 'vitest';
import { projectSketch } from './sketch';

describe('projectSketch', () => {
  it('maps two points to opposite padded corners (north is up)', () => {
    // Midpoint latitude 0, so degrees of lon and lat are the same length.
    const [sw, ne] = projectSketch([{ lat: -1, lon: 0 }, { lat: 1, lon: 2 }], 100, 100, 6);
    expect(sw.x).toBeCloseTo(6);
    expect(sw.y).toBeCloseTo(94);
    expect(ne.x).toBeCloseTo(94);
    expect(ne.y).toBeCloseTo(6);
  });

  it('maps a single point to the centre', () => {
    expect(projectSketch([{ lat: 38.7, lon: -9.1 }], 120, 60)).toEqual([{ x: 60, y: 30 }]);
  });

  it('returns nothing for no points', () => {
    expect(projectSketch([], 100, 100)).toEqual([]);
  });

  it('keeps the aspect: a tall set of points does not fill the width', () => {
    const [a, b] = projectSketch([{ lat: -2, lon: 0 }, { lat: 2, lon: 1 }], 100, 100, 6);
    expect(a.y).toBeCloseTo(94);
    expect(b.y).toBeCloseTo(6);
    expect(Math.abs(b.x - a.x)).toBeLessThan(40);
    expect((a.x + b.x) / 2).toBeCloseTo(50);
  });

  it('keeps every point inside the padding', () => {
    const pts = projectSketch(
      [{ lat: 38.7, lon: -9.1 }, { lat: 41.1, lon: -8.6 }, { lat: 37.0, lon: -7.9 }],
      200, 80, 6,
    );
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(6 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(194 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(6 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(74 + 1e-9);
    }
  });

  it('centres points that share a latitude without dividing by zero', () => {
    const [a, b] = projectSketch([{ lat: 40, lon: 0 }, { lat: 40, lon: 1 }], 100, 50, 6);
    expect(a.y).toBeCloseTo(25);
    expect(b.y).toBeCloseTo(25);
    expect(a.x).toBeLessThan(b.x);
  });
});
