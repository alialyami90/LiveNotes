import { describe, expect, it } from 'vitest';
import { loadDoc, safeStorage, saveDoc, STORAGE_KEY } from './storage';
import { sampleDoc } from './sample';
import { displayText, tokenize } from '../syntax/tokenize';

const store = (v: string | null) => ({ getItem: (k: string) => (k === STORAGE_KEY ? v : null) });

describe('storage', () => {
  it('uses the spec key', () => {
    expect(STORAGE_KEY).toBe('livenotes:doc:v1');
  });

  it('returns sampleDoc for missing, invalid JSON, or wrong version', () => {
    const sampleTexts = Object.values(sampleDoc().nodes).map((n) => n.text).sort();
    for (const raw of [null, '{not json', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, rootId: 'x', nodes: {} })]) {
      const d = loadDoc(store(raw));
      expect(Object.values(d.nodes).map((n) => n.text).sort()).toEqual(sampleTexts);
    }
  });

  it('returns sampleDoc for structurally broken docs', () => {
    const base = (nodes: unknown, places: unknown = {}) => JSON.stringify({ version: 1, rootId: 'root', nodes, places });
    const sampleTexts = Object.values(sampleDoc().nodes).map((n) => n.text).sort();
    const broken = [
      base({ root: { id: 'root', text: '', children: ['missing'] } }),
      base({ root: { id: 'root', text: '', children: ['a'] }, a: { id: 'a', text: 'x' } }),
      base({ root: { id: 'root', text: '', children: ['a'] }, a: { id: 'a', text: 'x', children: ['a'] } }),
      base({ root: { id: 'root', text: '', children: ['a', 'a'] }, a: { id: 'a', text: 'x', children: [] } }),
      base({ root: { id: 'root', text: '', children: ['a'] }, a: { id: 'a', text: 5, children: [] } }),
      base({ root: { id: 'root', text: '', children: [] } }, null),
    ];
    for (const raw of broken) {
      expect(Object.values(loadDoc(store(raw)).nodes).map((n) => n.text).sort()).toEqual(sampleTexts);
    }
  });

  it('safeStorage returns null when storage access throws', () => {
    expect(safeStorage(() => { throw new Error('SecurityError'); })).toBeNull();
    const s = {} as Storage;
    expect(safeStorage(() => s)).toBe(s);
  });

  it('round-trips a saved doc', () => {
    let saved = '';
    const d = sampleDoc();
    saveDoc({ setItem: (_k: string, v: string) => { saved = v; } }, d);
    expect(loadDoc(store(saved))).toEqual(d);
  });

  it('sampleDoc only spells out the year when the trip crosses into another year', () => {
    const texts = (d: Date) => Object.values(sampleDoc(d).nodes).map((n) => n.text).join('\n');
    expect(texts(new Date(2026, 9, 28))).not.toMatch(/\b2026\b/);
    expect(texts(new Date(2026, 11, 29))).toMatch(/Jan 2 2027/);
  });

  it('sampleDoc ships with every mentioned place already resolved (instant and offline)', () => {
    const d = sampleDoc();
    const keys = new Set<string>();
    for (const n of Object.values(d.nodes)) {
      for (const seg of tokenize(n.text)) if (seg.kind === 'place') keys.add(seg.key);
    }
    for (const key of keys) expect(d.places[key], key).toBeDefined();
  });

  it('sampleDoc shows each fact once: no row has both a phrase and the formula it stands for', () => {
    for (const n of Object.values(sampleDoc().nodes)) {
      const segs = tokenize(n.text);
      const formulas = segs.flatMap((s) => (s.kind === 'formula' ? [s.source] : []));
      if (segs.some((s) => s.kind === 'weather')) expect(formulas.join(' '), n.text).not.toMatch(/weather\(/);
      if (segs.some((s) => s.kind === 'route')) expect(formulas.join(' '), n.text).not.toMatch(/route\(|travel\(/);
    }
  });

  it('sampleDoc demonstrates weather, route and distance formulas and the weather and route phrases', () => {
    const segs = Object.values(sampleDoc().nodes).flatMap((n) => tokenize(n.text));
    const formulas = segs.flatMap((s) => (s.kind === 'formula' ? [s.source] : [])).join(' ');
    for (const f of ['weather(', 'route(', 'distance(']) expect(formulas).toContain(f);
    expect(segs.some((s) => s.kind === 'weather')).toBe(true);
    expect(segs.some((s) => s.kind === 'route')).toBe(true);
  });

  it('sampleDoc gives its places a kind, so the sample shows place icons (M6)', () => {
    const kinds = Object.fromEntries(Object.entries(sampleDoc().places).map(([k, p]) => [k, p.kind]));
    expect(kinds).toEqual({
      lisbon: 'city',
      porto: 'city',
      coimbra: 'city',
      sintra: 'city',
      'vila nova de gaia': 'city',
      cascais: 'city',
      'pinhão': 'village',
      'belém tower': 'sight',
      'praça do comércio': 'sight',
      'miradouro da senhora do monte': 'sight',
      'time out market': 'restaurant',
      'livraria lello': 'shop',
      'pastéis de belém': 'cafe',
    });
  });

  it('sampleDoc\'s "How this works" bullet mentions the plain-word phrases, as plain text (M6)', () => {
    const how = Object.values(sampleDoc().nodes).find((n) => n.text.startsWith('How this works'))!;
    expect(displayText(how.text)).toMatch(/plain words like weather or drive to @Place/);
    const segs = tokenize(how.text);
    expect(segs.some((s) => s.kind === 'weather' || s.kind === 'route' || s.kind === 'place')).toBe(false);
  });

  it('sampleDoc has a valid tree with nodes reachable from root', () => {
    const d = sampleDoc();
    expect(d.nodes[d.rootId].children.length).toBeGreaterThan(0);
    for (const n of Object.values(d.nodes)) for (const c of n.children) expect(d.nodes[c]).toBeDefined();
  });
});
