import { describe, expect, it } from 'vitest';
import type { Place } from '../model/types';
import type { Services } from '../services/types';
import type { Segment } from '../syntax/tokenize';
import { evaluate, type Env } from './evaluate';
import { parse, type Expr } from './parser';
import { directionsUrl, phraseSource, travel } from './travel';
import type { Value } from './values';

const LISBON: Place = { name: 'Lisbon', lat: 38.7223, lon: -9.1393 };
const PORTO: Place = { name: 'Porto', lat: 41.1579, lon: -8.6291 };
const SAO_BENTO: Place = { name: 'São Bento', lat: 41.1456, lon: -8.6107 };
const PLACES: Record<string, Place> = { lisbon: LISBON, porto: PORTO, 'são bento': SAO_BENTO };

function fakes(meters = 313400) {
  const state = { routeCalls: 0 };
  const services: Services = {
    search: async () => [],
    geocode: async () => null,
    weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 21, low: 14 }),
    route: async (a, b) => {
      state.routeCalls++;
      return a.lat === b.lat && a.lon === b.lon ? { seconds: 0, meters: 0 } : { seconds: 11100, meters };
    },
  };
  return { services, state };
}

const env = (over: Partial<Env> = {}): Env => ({
  hereKey: 'porto',
  prevKey: 'lisbon',
  date: '2026-11-03',
  today: '2026-10-28',
  resolvePlace: async (key) => PLACES[key] ?? null,
  ...over,
});

type Phrase = Extract<Segment, { kind: 'weather' | 'route' }>;

const route = (mode: Extract<Segment, { kind: 'route' }>['mode'], toKey: string, fromKey?: string): Phrase => ({
  kind: 'route',
  mode,
  ...(fromKey ? { fromKey } : {}),
  toKey,
  raw: '',
});

async function runPhrase(seg: Phrase, e: Env = env(), s: Services = fakes().services): Promise<Value> {
  const ast = parse(phraseSource(seg));
  if ('error' in ast) throw new Error(ast.error);
  return evaluate(ast, e, s);
}

describe('travel()', () => {
  it('drive uses the route as is', async () => {
    const { services } = fakes();
    expect(await travel('drive', LISBON, PORTO, services)).toEqual({
      kind: 'travel', mode: 'drive', meters: 313400, seconds: 11100, estimated: false,
    });
  });

  it('walk derives time at 4.8 km/h and is estimated', async () => {
    const { services } = fakes(5800);
    const v = await travel('walk', LISBON, PORTO, services);
    expect(v).toMatchObject({ kind: 'travel', mode: 'walk', meters: 5800, estimated: true });
    expect((v as { seconds: number }).seconds).toBeCloseTo(5800 / (4.8 / 3.6), 6);
  });

  it('bike derives time at 15 km/h and is estimated', async () => {
    const { services } = fakes(6100);
    const v = await travel('bike', LISBON, PORTO, services);
    expect(v).toMatchObject({ kind: 'travel', mode: 'bike', meters: 6100, estimated: true });
    expect((v as { seconds: number }).seconds).toBeCloseTo(6100 / (15 / 3.6), 6);
  });

  it('refuses to walk or cycle more than 100 km', async () => {
    const { services } = fakes(150_000);
    expect(await travel('walk', LISBON, PORTO, services)).toEqual({ kind: 'error', message: 'too far to walk' });
    expect(await travel('bike', LISBON, PORTO, services)).toEqual({ kind: 'error', message: 'too far to cycle' });
  });

  it('transit has the route distance, no time, and a directions link', async () => {
    const { services } = fakes();
    const v = await travel('transit', LISBON, PORTO, services);
    expect(v).toEqual({
      kind: 'travel',
      mode: 'transit',
      meters: 313400,
      estimated: false,
      directionsUrl:
        'https://www.google.com/maps/dir/?api=1&origin=38.7223,-9.1393&destination=41.1579,-8.6291&travelmode=transit',
    });
    expect(v).not.toHaveProperty('seconds');
    expect(directionsUrl(LISBON, PORTO)).toBe((v as { directionsUrl: string }).directionsUrl);
  });

  it('fly is the great-circle distance and never calls the router', async () => {
    const { services, state } = fakes();
    const v = await travel('fly', LISBON, PORTO, services);
    expect(v).toMatchObject({ kind: 'travel', mode: 'fly', estimated: false });
    expect((v as { meters: number }).meters / 1000).toBeGreaterThan(270);
    expect((v as { meters: number }).meters / 1000).toBeLessThan(278);
    expect(v).not.toHaveProperty('seconds');
    expect(state.routeCalls).toBe(0);
  });

  it('a rejected route becomes an error value through evaluate', async () => {
    const { services } = fakes();
    services.route = async () => {
      throw new Error('no route found');
    };
    expect(await runPhrase(route('drive', 'porto', 'lisbon'), env(), services)).toEqual({
      kind: 'error', message: 'no route found',
    });
  });
});

describe('phraseSource', () => {
  const weather: Phrase = { kind: 'weather', raw: 'forecast' };

  it('turns phrases into formulas', () => {
    expect(phraseSource(weather)).toBe('weather()');
    expect(phraseSource(route('walk', 'porto'))).toBe('travel("walk", prev, @[porto])');
    expect(phraseSource(route('drive', 'porto', 'lisbon'))).toBe('travel("drive", @[lisbon], @[porto])');
  });

  it('keys with spaces and accents round-trip through parse to the same place key', () => {
    const ast = parse(phraseSource(route('walk', 'são bento', 'lisbon')));
    expect(ast).toMatchObject({ t: 'call', name: 'travel' });
    const args = (ast as Extract<Expr, { t: 'call' }>).args;
    expect(args[1]).toMatchObject({ t: 'place', key: 'lisbon' });
    expect(args[2]).toMatchObject({ t: 'place', key: 'são bento' });
  });

  it('evaluates a weather phrase like weather()', async () => {
    expect(await runPhrase(weather)).toMatchObject({ kind: 'weather', high: 21 });
  });

  it('with no previous place says so', async () => {
    expect(await runPhrase(route('drive', 'porto'), env({ prevKey: undefined }))).toEqual({
      kind: 'error', message: 'no previous place',
    });
  });

  it('an unresolvable destination names the place', async () => {
    const e = env({ resolvePlace: async (k) => (k === 'porto' ? null : PLACES[k] ?? null) });
    expect(await runPhrase(route('drive', 'porto', 'lisbon'), e)).toEqual({
      kind: 'error', message: 'unknown place: porto',
    });
  });

  it('the same place twice is a zero drive', async () => {
    const v = await runPhrase(route('drive', 'porto', 'porto'));
    expect(v).toMatchObject({ kind: 'travel', mode: 'drive', meters: 0, seconds: 0 });
  });

  it('uses prev from the environment when there is no from', async () => {
    const v = await runPhrase(route('fly', 'porto'));
    expect(v).toMatchObject({ kind: 'travel', mode: 'fly' });
  });
});

describe('travel() in the formula language', () => {
  const run = async (src: string, e = env(), s = fakes().services) => {
    const ast = parse(src);
    if ('error' in ast) throw new Error(ast.error);
    return evaluate(ast, e, s);
  };

  it('rejects an unknown mode', async () => {
    expect(await run('travel("teleport", @[lisbon], @[porto])')).toEqual({
      kind: 'error', message: 'unknown travel mode "teleport"',
    });
  });

  it('exposes .distance and .duration', async () => {
    expect(await run('travel("drive", @[lisbon], @[porto]).distance')).toEqual({ kind: 'distance', meters: 313400 });
    expect(await run('travel("drive", @[lisbon], @[porto]).duration')).toEqual({ kind: 'duration', seconds: 11100 });
  });

  it('.duration says no time for transit and fly', async () => {
    expect(await run('travel("transit", @[lisbon], @[porto]).duration')).toEqual({
      kind: 'error', message: 'no time for transit',
    });
    expect(await run('travel("fly", @[lisbon], @[porto]).duration')).toEqual({
      kind: 'error', message: 'no time for fly',
    });
  });

  it('needs a string mode and two places', async () => {
    expect(await run('travel(1, @[lisbon], @[porto])')).toMatchObject({ kind: 'error' });
    expect(await run('travel("walk", @[lisbon])')).toMatchObject({ kind: 'error' });
  });
});
