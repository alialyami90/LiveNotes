import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc } from '../model/types';
import type { Services } from '../services/types';
import { memoryStorage } from '../library/memoryStorage';
import { DocProvider, useStore } from './store';
import { Outline } from './Outline';

const services: Services = {
  search: async () => [],
  geocode: async () => null,
  weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
  route: async () => ({ seconds: 3600, meters: 100000 }),
};

const doc = (text: string): Doc => ({
  version: 1,
  rootId: 'root',
  nodes: { root: { id: 'root', text: '', children: ['a'] }, a: { id: 'a', text, children: [] } },
  places: {},
});

function setup(storage: Storage, onSaved = vi.fn()) {
  storage.setItem('livenotes:note:N', JSON.stringify(doc('x')));
  const utils = render(
    <DocProvider initialDoc={doc('x')} storageKey="livenotes:note:N" storage={storage} services={services} today="2026-10-28" onSaved={onSaved}>
      <Outline />
    </DocProvider>,
  );
  return { onSaved, ...utils };
}

describe('per-note persistence', () => {
  it('flushes a pending save when the provider unmounts, and reports it', async () => {
    const storage = memoryStorage();
    const user = userEvent.setup();
    const { onSaved, unmount } = setup(storage);
    await user.click(screen.getByText('x'));
    await user.keyboard('{End}yz');
    unmount();
    expect(storage.getItem('livenotes:note:N')).toContain('xyz');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0].nodes.a.text).toBe('xyz');
    expect(onSaved.mock.calls[0][1]).toBe(JSON.stringify(doc('x'))); // what the key held before
  });

  it('writes nothing for a document that was only opened', async () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const { onSaved, unmount } = setup(storage);
    setItem.mockClear();
    await act(() => new Promise((r) => setTimeout(r, 350)));
    unmount();
    expect(setItem).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('follows another tab editing the same key, and ignores other keys', async () => {
    const storage = memoryStorage();
    setup(storage);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'livenotes:note:OTHER', newValue: JSON.stringify(doc('nope')) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'livenotes:note:N', newValue: JSON.stringify(doc('theirs')) }));
    });
    expect(await screen.findByText('theirs')).toBeInTheDocument();
    expect(screen.queryByText('nope')).toBeNull();
  });

  it('a failed save stays dirty, so the unmount flush retries it', async () => {
    const storage = memoryStorage();
    const user = userEvent.setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { onSaved, unmount } = setup(storage);
    const setItem = storage.setItem.bind(storage);
    let full = true;
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      if (full) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    });
    await user.click(screen.getByText('x'));
    await user.keyboard('{End}yz');
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(storage.getItem('livenotes:note:N')).not.toContain('xyz');
    full = false;
    unmount();
    expect(storage.getItem('livenotes:note:N')).toContain('xyz');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('reports saveError while saves fail, and clears it on the next successful save', async () => {
    const storage = memoryStorage();
    const user = userEvent.setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results: boolean[] = [];
    function Probe() {
      const { saveError } = useStore();
      return <p data-testid="save-error">{String(saveError)}</p>;
    }
    storage.setItem('livenotes:note:N', JSON.stringify(doc('x')));
    render(
      <DocProvider
        initialDoc={doc('x')}
        storageKey="livenotes:note:N"
        storage={storage}
        services={services}
        today="2026-10-28"
        onSaveResult={(ok) => results.push(ok)}
      >
        <Outline />
        <Probe />
      </DocProvider>,
    );
    const setItem = storage.setItem.bind(storage);
    let full = true;
    vi.spyOn(storage, 'setItem').mockImplementation((k, v) => {
      if (full) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    });
    expect(screen.getByTestId('save-error')).toHaveTextContent('false');
    await user.click(screen.getByText('x'));
    await user.keyboard('{End}y');
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(screen.getByTestId('save-error')).toHaveTextContent('true');
    expect(results).toEqual([false]);
    full = false;
    await user.keyboard('z');
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(screen.getByTestId('save-error')).toHaveTextContent('false');
    expect(results).toEqual([false, true]);
    expect(storage.getItem('livenotes:note:N')).toContain('xyz');
  });
});
