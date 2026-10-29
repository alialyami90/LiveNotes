import { describe, expect, it } from 'vitest';
import type { Place } from '../model/types';
import type { Services } from '../services/types';
import { evaluate, type Env } from './evaluate';
import { parse, type Expr } from './parser';
import type { Value } from './values';

const LISBON: Place = { name: 'Lisbon', lat: 38.7223, lon: -9.1393 };
const PORTO: Place = { name: 'Porto', lat: 41.1579, lon: -8.6291 };
const PLACES: Record<string, Place> = { lisbon: LISBON, porto: PORTO };

function fakeServices() {
  const calls: string[] = [];
  const services: Services = {
    search: async () => [],
    geocode: async (name) => {
      calls.push(`geocode:${name}`);
      return PLACES[name] ?? null;
    },
    weather: async (p, iso) => {
      calls.push(`weather:${p.name}:${iso}`);
      return { code: 0, condition: 'Clear', icon: '☀️', high: 21, low: 14 };
    },
    route: async (a, b) => {
      calls.push(`route:${a.name}:${b.name}`);
      return { seconds: 11100, meters: 313400 };
    },
  };
  return { services, calls };
}

const env = (over: Partial<Env> = {}): Env => ({
  hereKey: 'porto',
  prevKey: 'lisbon',
  date: '2026-11-03',
  today: '2026-10-28',
  resolvePlace: async (key) => PLACES[key] ?? null,
  ...over,
});

async function run(src: string, e: Env = env(), services = fakeServices().services): Promise<Value> {
  const ast = parse(src);
  if ('error' in ast) throw new Error(ast.error);
  return evaluate(ast as Expr, e, services);
}

describe('evaluate', () => {
  it('weather() uses the node context place and date', async () => {
    const f = fakeServices();
    const v = await run('weather()', env(), f.services);
    expect(v).toMatchObject({ kind: 'weather', high: 21 });
    expect(f.calls).toEqual(['weather:Porto:2026-11-03']);
  });

  it('weather() without a date is an error', async () => {
    expect(await run('weather()', env({ date: undefined }))).toEqual({ kind: 'error', message: 'no date here' });
  });

  it('weather() beyond the 16-day forecast window says no forecast yet', async () => {
    const f = fakeServices();
    expect(await run('weather(here, 2026-12-25)', env(), f.services)).toEqual({ kind: 'error', message: 'no forecast yet' });
    expect(f.calls).toEqual([]);
  });

  it('route(prev, here).duration returns a duration', async () => {
    expect(await run('route(prev, here).duration')).toEqual({ kind: 'duration', seconds: 11100 });
    expect(await run('route(prev, here)')).toMatchObject({ kind: 'route', meters: 313400 });
  });

  it('prev with no previous place is an error', async () => {
    expect(await run('prev', env({ prevKey: undefined }))).toEqual({ kind: 'error', message: 'no previous place' });
  });

  it('here with no place is an error', async () => {
    expect(await run('weather()', env({ hereKey: undefined }))).toEqual({ kind: 'error', message: 'no place here' });
  });

  it('adds unit literals: 2h + 30min = 9000 s', async () => {
    expect(await run('2h + 30min')).toEqual({ kind: 'duration', seconds: 9000 });
  });

  it('distance(@Lisbon, @Porto) is a great-circle distance', async () => {
    const v = await run('distance(@Lisbon, @Porto)');
    expect(v.kind).toBe('distance');
    expect((v as { meters: number }).meters / 1000).toBeGreaterThan(270);
    expect((v as { meters: number }).meters / 1000).toBeLessThan(280);
  });

  it('an unresolvable place is an error', async () => {
    expect(await run('distance(@Atlantis, @Porto)')).toEqual({ kind: 'error', message: 'unknown place: atlantis' });
  });

  it('days(a, b) counts whole days', async () => {
    expect(await run('days(2026-11-03, 2026-11-07)')).toEqual({ kind: 'number', value: 4 });
  });

  it('date - date is a duration in days; date + duration is a date', async () => {
    expect(await run('2026-11-07 - 2026-11-03')).toEqual({ kind: 'duration', seconds: 4 * 86400 });
    expect(await run('date + 2d')).toEqual({ kind: 'date', iso: '2026-11-05' });
  });

  it('distance / duration is a speed; unit conversions give numbers', async () => {
    expect(await run('100km / 2h')).toMatchObject({ kind: 'speed' });
    expect(await run('hours(90min)')).toEqual({ kind: 'number', value: 1.5 });
    expect(await run('minutes(2h)')).toEqual({ kind: 'number', value: 120 });
    expect(await run('km(route(prev, here).distance)')).toEqual({ kind: 'number', value: 313.4 });
  });

  it('number arithmetic and scaling durations', async () => {
    expect(await run('1 + 2 * 3')).toEqual({ kind: 'number', value: 7 });
    expect(await run('route(prev, here).duration * 2')).toEqual({ kind: 'duration', seconds: 22200 });
    expect(await run('-30min')).toEqual({ kind: 'duration', seconds: -1800 });
  });

  it('mismatched types are error values, not exceptions', async () => {
    expect(await run('1 + @Lisbon')).toMatchObject({ kind: 'error' });
    expect(await run('2h + 3km')).toMatchObject({ kind: 'error' });
  });

  it('a rejecting service becomes an error value', async () => {
    const { services } = fakeServices();
    services.route = async () => {
      throw new Error('no route found');
    };
    expect(await run('route(prev, here)', env(), services)).toEqual({ kind: 'error', message: 'no route found' });
  });

  it('property access works on places and weather; unknown names are errors', async () => {
    expect(await run('here.name')).toEqual({ kind: 'string', value: 'Porto' });
    expect(await run('weather().high')).toEqual({ kind: 'number', value: 21 });
    expect(await run('here.nope')).toMatchObject({ kind: 'error' });
    expect(await run('nope')).toEqual({ kind: 'error', message: 'unknown name "nope"' });
    expect(await run('nope()')).toEqual({ kind: 'error', message: 'unknown function "nope"' });
  });

  it('today is the env date', async () => {
    expect(await run('today')).toEqual({ kind: 'date', iso: '2026-10-28' });
  });
});
