import { describe, expect, it } from 'vitest';
import { MODES, insertModeWord, modeOf, routeWithoutMode, type Mode } from './phrases';
import { displayText, tokenize, type Segment } from './tokenize';
import { phraseSource } from '../formula/travel';

const raw = (s: Segment) => (s.kind === 'text' ? s.text : s.raw);
const roundTrip = (t: string) => tokenize(t).map(raw).join('');
const kinds = (t: string) => tokenize(t).map((s) => s.kind);

const WORDS: [string, Mode][] = [
  ['drive', 'drive'], ['driving', 'drive'], ['car', 'drive'], ['taxi', 'drive'],
  ['walk', 'walk'], ['walking', 'walk'],
  ['transit', 'transit'], ['train', 'transit'], ['bus', 'transit'], ['metro', 'transit'], ['tram', 'transit'],
  ['bike', 'bike'], ['cycle', 'bike'], ['cycling', 'bike'],
  ['fly', 'fly'], ['flight', 'fly'],
];

describe('MODES / modeOf', () => {
  it('lists the popup rows in fixed order with icons', () => {
    expect(MODES.map((m) => [m.mode, m.word, m.label, m.icon])).toEqual([
      ['drive', 'drive', 'Drive', '🚗'],
      ['walk', 'walk', 'Walk', '🚶'],
      ['transit', 'transit', 'Public transport', '🚆'],
      ['bike', 'bike', 'Bike', '🚲'],
      ['fly', 'fly', 'Fly', '✈'],
    ]);
  });
  it('maps every mode word, case-insensitively', () => {
    for (const [w, m] of WORDS) {
      expect(modeOf(w)).toBe(m);
      expect(modeOf(w.toUpperCase())).toBe(m);
    }
    expect(modeOf('carefully')).toBeUndefined();
    expect(modeOf('to')).toBeUndefined();
  });
});

describe('weather words', () => {
  it('weather and forecast become weather segments, raw preserved', () => {
    expect(tokenize('weather')).toEqual([{ kind: 'weather', raw: 'weather' }]);
    expect(tokenize('Weather')).toEqual([{ kind: 'weather', raw: 'Weather' }]);
    expect(tokenize('FORECAST')).toEqual([{ kind: 'weather', raw: 'FORECAST' }]);
    expect(tokenize('Lunch, weather?')).toEqual([
      { kind: 'text', text: 'Lunch, ' },
      { kind: 'weather', raw: 'weather' },
      { kind: 'text', text: '?' },
    ]);
  });
  it('is not a phrase when part of a word, escaped or inside a formula', () => {
    expect(kinds('weathered')).toEqual(['text']);
    expect(kinds('unweather')).toEqual(['text']);
    expect(kinds('\\weather')).toEqual(['text']);
    expect(kinds('{weather()}')).toEqual(['formula']);
  });
});

describe('phrase words glued to URLs, emails and compounds', () => {
  const PLAIN = [
    'check weather.com first',
    'https://weather.com/today',
    'see https://x.com/weather',
    'ali@weather.com',
    'weather-proof jacket',
    'weather_report',
    'https://x.com/bus to @Porto',
    'see x.com/forecast',
  ];
  for (const t of PLAIN) {
    it(`${JSON.stringify(t)} stays plain text`, () => {
      expect(kinds(t)).not.toContain('weather');
      expect(kinds(t)).not.toContain('route');
      expect(tokenize(t).every((s) => s.kind === 'text' || s.kind === 'place')).toBe(true);
      expect(roundTrip(t)).toBe(t);
    });
  }
  it('sentence punctuation does not block a match', () => {
    expect(kinds('Nice weather.')).toEqual(['text', 'weather', 'text']);
    expect(kinds('weather, then lunch')).toEqual(['weather', 'text']);
    expect(kinds('(weather)')).toEqual(['text', 'weather', 'text']);
    expect(kinds('Weather: sunny')).toEqual(['weather', 'text']);
    expect(kinds('drive to @Porto.')).toEqual(['text', 'text', 'place', 'route', 'text']);
  });
});

describe('route phrases', () => {
  for (const [word, mode] of WORDS) {
    it(`${word} to @Porto is a ${mode} route`, () => {
      const t = `${word} to @Porto`;
      expect(tokenize(t)).toEqual([
        { kind: 'text', text: word, mode },
        { kind: 'text', text: ' to ' },
        { kind: 'place', key: 'porto', name: 'Porto', raw: '@Porto' },
        { kind: 'route', mode, toKey: 'porto', raw: '' },
      ]);
      expect(roundTrip(t)).toBe(t);
    });
  }

  it('from X to Y carries both keys, after the destination', () => {
    const t = 'drive from @Lisbon to @Porto';
    expect(tokenize(t)).toEqual([
      { kind: 'text', text: 'drive', mode: 'drive' },
      { kind: 'text', text: ' from ' },
      { kind: 'place', key: 'lisbon', name: 'Lisbon', raw: '@Lisbon' },
      { kind: 'text', text: ' to ' },
      { kind: 'place', key: 'porto', name: 'Porto', raw: '@Porto' },
      { kind: 'route', mode: 'drive', fromKey: 'lisbon', toKey: 'porto', raw: '' },
    ]);
    expect(roundTrip(t)).toBe(t);
  });

  it('is case-insensitive and accepts bracket places', () => {
    const segs = tokenize('Drive To @[São Bento]');
    expect(segs.map((s) => s.kind)).toEqual(['text', 'text', 'place', 'route']);
    expect(segs[0]).toMatchObject({ text: 'Drive', mode: 'drive' });
    expect(segs[3]).toMatchObject({ kind: 'route', toKey: 'são bento' });
  });

  it('keeps text around the phrase and finds two routes in one bullet', () => {
    const t = 'Nov 3 drive to @A, then walk to @B';
    const segs = tokenize(t);
    expect(segs.map((s) => (s.kind === 'route' ? `route:${s.mode}:${s.toKey}` : s.kind))).toEqual([
      'date', 'text', 'text', 'text', 'place', 'route:drive:a', 'text', 'text', 'text', 'place', 'route:walk:b',
    ]);
    expect(roundTrip(t)).toBe(t);
  });

  it('round-trips with other chips around the phrase', () => {
    const t = 'walk to @Porto {weather()} weather';
    expect(roundTrip(t)).toBe(t);
  });

  const NOT_ROUTES = [
    'drive carefully',
    'to @Porto',
    'into @Porto',
    'next to @Porto',
    'drive\nto @Porto',
    'drive to \\@Porto',
    '\\drive to @Porto',
    'drive from @A\nto @B',
    'drive from @A and @B',
    'barcelona to @Porto',
  ];
  for (const t of NOT_ROUTES) {
    it(`${JSON.stringify(t)} is not a route`, () => {
      expect(kinds(t)).not.toContain('route');
      expect(roundTrip(t)).toBe(t);
    });
  }

  it('does not mark a mode word that is not in a route', () => {
    expect(tokenize('drive carefully')).toEqual([{ kind: 'text', text: 'drive carefully' }]);
  });
});

describe('routeWithoutMode', () => {
  it('finds where a mode word goes after "to <place>" and a trailing char', () => {
    expect(routeWithoutMode('go to @Porto ', 12)).toEqual({ at: 3 });
    expect(routeWithoutMode('to @[São Bento]', 15)).toEqual({ at: 0 });
    expect(routeWithoutMode('from @A to @B,', 14)).toEqual({ at: 0 });
  });
  it('is null when a mode is already there', () => {
    expect(routeWithoutMode('drive to @Porto ', 16)).toBeNull();
    expect(routeWithoutMode('drive from @A to @B ', 20)).toBeNull();
  });
  it('is null for next/close/near to', () => {
    expect(routeWithoutMode('next to @Porto ', 15)).toBeNull();
    expect(routeWithoutMode('close to @X ', 12)).toBeNull();
    expect(routeWithoutMode('near to @X ', 11)).toBeNull();
  });
  it('is null when more was typed, or the caret is inside the mention', () => {
    expect(routeWithoutMode('to @Porto x', 11)).toBeNull();
    expect(routeWithoutMode('to @Porto', 6)).toBeNull();
    expect(routeWithoutMode('to @[São Be', 11)).toBeNull();
    expect(routeWithoutMode('to @Por', 5)).toBeNull();
  });
  it('is null when the caret is inside a hyphenated name', () => {
    expect(routeWithoutMode('to @Saint-Malo', 9)).toBeNull();
    expect(routeWithoutMode('to @Saint-Malo', 14)).toEqual({ at: 0 });
  });
  it('is null without a whole-word "to" on the same line', () => {
    expect(routeWithoutMode('visit @Porto ', 13)).toBeNull();
    expect(routeWithoutMode('into @Porto ', 12)).toBeNull();
    expect(routeWithoutMode('to\n@Porto ', 10)).toBeNull();
    expect(routeWithoutMode('go\nto @Porto ', 13)).toEqual({ at: 3 });
  });
});

describe('insertModeWord', () => {
  it('inserts the word and moves a caret at or after the insertion', () => {
    expect(insertModeWord('go to @Porto ', 3, 'walk', 12)).toEqual({ text: 'go walk to @Porto ', caret: 17 });
  });
  it('leaves a caret before the insertion point alone', () => {
    expect(insertModeWord('go to @Porto ', 3, 'fly', 1)).toEqual({ text: 'go fly to @Porto ', caret: 1 });
  });
});

describe('displayText with phrase escapes', () => {
  it('hides a backslash before a whole phrase word', () => {
    expect(displayText('\\weather and \\drive')).toBe('weather and drive');
    expect(displayText('\\Forecast \\train')).toBe('Forecast train');
  });
  it('keeps other backslashes', () => {
    expect(displayText('\\weathered \\x')).toBe('\\weathered \\x');
    expect(displayText('C:\\Docs\\train\\x')).toBe('C:\\Docs\\train\\x');
    expect(displayText('foo\\weather')).toBe('foo\\weather');
    expect(displayText('mail \\@home \\{x}')).toBe('mail @home {x}');
  });
});

describe('a formula in the bullet already says it (I1)', () => {
  const OLD_ROUTE = 'Nov 3 — drive to @Porto {route(@Lisbon, here)}';
  const OLD_WEATHER = 'Forecast in Porto: {weather()}';

  it(`${JSON.stringify(OLD_ROUTE)} keeps its formula and no route phrase`, () => {
    const segs = tokenize(OLD_ROUTE);
    expect(segs.map((s) => s.kind)).toEqual(['date', 'text', 'place', 'text', 'formula']);
    expect(segs.some((s) => s.kind === 'text' && s.mode)).toBe(false);
    expect(roundTrip(OLD_ROUTE)).toBe(OLD_ROUTE);
  });

  it(`${JSON.stringify(OLD_WEATHER)} keeps its formula and no weather word`, () => {
    expect(tokenize(OLD_WEATHER)).toEqual([
      { kind: 'text', text: 'Forecast in Porto: ' },
      { kind: 'formula', source: 'weather()', raw: '{weather()}' },
    ]);
  });

  it('matches the call case-insensitively, with spaces before the parenthesis', () => {
    expect(kinds('weather {WEATHER (@Porto)}')).toEqual(['text', 'formula']);
    expect(kinds('walk to @Porto {Travel ("walk", prev, here)}')).not.toContain('route');
    expect(kinds('walk to @Porto {ROUTE(prev, here).duration}')).not.toContain('route');
  });

  it('only the same kind of call suppresses: a route formula leaves weather, and the reverse', () => {
    expect(kinds('weather {route(prev, here)}')).toEqual(['weather', 'text', 'formula']);
    expect(kinds('walk to @Porto {weather()}')).toContain('route');
    expect(kinds('weather {distance(@A, @B)}')).toContain('weather');
    expect(kinds('weather {weatherman}')).toContain('weather');
  });
});

describe('chained routes in one bullet (I3)', () => {
  const routes = (t: string) =>
    tokenize(t).flatMap((s) => (s.kind === 'route' ? [[s.mode, s.fromKey, s.toKey]] : []));

  it('a later "to @X" starts from the previous route\'s destination', () => {
    expect(routes('drive to @Coimbra then walk to @[Museu Machado]')).toEqual([
      ['drive', undefined, 'coimbra'],
      ['walk', 'coimbra', 'museu machado'],
    ]);
  });

  it('a from…to route then a to route: the train leg starts from Porto', () => {
    expect(routes('Car from @Lisbon to @Porto, then train to @Braga')).toEqual([
      ['drive', 'lisbon', 'porto'],
      ['transit', 'porto', 'braga'],
    ]);
  });

  it('a later from…to route keeps its own start', () => {
    expect(routes('drive to @A, then walk from @B to @C')).toEqual([
      ['drive', undefined, 'a'],
      ['walk', 'b', 'c'],
    ]);
  });

  it('phraseSource of the chained route names its start', () => {
    const seg = tokenize('drive to @Coimbra then walk to @[Museu Machado]').filter((s) => s.kind === 'route')[1];
    expect(seg.kind === 'route' && phraseSource(seg)).toBe('travel("walk", @[coimbra], @[museu machado])');
  });
});

describe('minor phrase guards', () => {
  it('M1: a possessive weather word stays plain', () => {
    expect(kinds('the weather’s fine')).toEqual(['text']);
    expect(kinds("the weather's fine")).toEqual(['text']);
    expect(kinds("weather' fine")).toContain('weather');
  });

  it('M2: a backslash after a colon or a slash is kept', () => {
    expect(displayText('C:\\bus')).toBe('C:\\bus');
    expect(displayText('a/\\weather')).toBe('a/\\weather');
    expect(displayText('see \\bus')).toBe('see bus');
  });
});
