import { describe, expect, it } from 'vitest';
import { loadDoc, safeStorage, saveDoc, STORAGE_KEY } from './storage';
import { sampleDoc } from './sample';
import { tokenize } from '../syntax/tokenize';

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

  it('sampleDoc has a valid tree with nodes reachable from root', () => {
    const d = sampleDoc();
    expect(d.nodes[d.rootId].children.length).toBeGreaterThan(0);
    for (const n of Object.values(d.nodes)) for (const c of n.children) expect(d.nodes[c]).toBeDefined();
  });
});
