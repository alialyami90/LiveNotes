import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc } from '../model/types';
import type { Services } from '../services/types';
import { memoryStorage } from '../library/memoryStorage';
import { DocProvider } from './store';
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
});
