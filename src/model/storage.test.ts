import { describe, expect, it } from 'vitest';
import { loadDoc, saveDoc, STORAGE_KEY } from './storage';
import { sampleDoc } from './sample';

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

  it('sampleDoc has a valid tree with nodes reachable from root', () => {
    const d = sampleDoc();
    expect(d.nodes[d.rootId].children.length).toBeGreaterThan(0);
    for (const n of Object.values(d.nodes)) for (const c of n.children) expect(d.nodes[c]).toBeDefined();
  });
});
