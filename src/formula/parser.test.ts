import { describe, expect, it } from 'vitest';
import { parse } from './parser';

describe('parse', () => {
  it('respects precedence', () => {
    expect(parse('1 + 2 * 3')).toEqual({
      t: 'bin', op: '+', l: { t: 'num', value: 1 },
      r: { t: 'bin', op: '*', l: { t: 'num', value: 2 }, r: { t: 'num', value: 3 } },
    });
  });

  it('parses parentheses and unary minus', () => {
    expect(parse('-(1 - 2)')).toEqual({
      t: 'neg', e: { t: 'bin', op: '-', l: { t: 'num', value: 1 }, r: { t: 'num', value: 2 } },
    });
  });

  it('parses property access on a call with place arguments', () => {
    expect(parse('route(prev, @[Porto Airport]).duration')).toEqual({
      t: 'prop', name: 'duration',
      e: { t: 'call', name: 'route', args: [{ t: 'ident', name: 'prev' }, { t: 'place', key: 'porto airport', name: 'Porto Airport' }] },
    });
  });

  it('parses unit literals', () => {
    expect(parse('2h + 30min')).toEqual({
      t: 'bin', op: '+', l: { t: 'num', value: 2, unit: 'h' }, r: { t: 'num', value: 30, unit: 'min' },
    });
    expect(parse('1.5km')).toEqual({ t: 'num', value: 1.5, unit: 'km' });
  });

  it('parses ISO date literals, strings and single-word places', () => {
    expect(parse('days(2026-11-03, @Porto, "hi")')).toEqual({
      t: 'call', name: 'days',
      args: [{ t: 'date', iso: '2026-11-03' }, { t: 'place', key: 'porto', name: 'Porto' }, { t: 'str', value: 'hi' }],
    });
  });

  it('lowercases identifiers and function names', () => {
    expect(parse('Weather(Here)')).toEqual({ t: 'call', name: 'weather', args: [{ t: 'ident', name: 'here' }] });
  });

  it('parses an empty-argument call', () => {
    expect(parse('weather()')).toEqual({ t: 'call', name: 'weather', args: [] });
  });

  it.each(['1 +', '', '(1', 'route(a,', '2x', '1 2', '@', '"open'])('reports an error for %j', (src) => {
    expect(parse(src)).toHaveProperty('error');
  });
});
