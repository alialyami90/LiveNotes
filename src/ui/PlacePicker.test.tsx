import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode, Place } from '../model/types';
import type { Found, Services } from '../services/types';
import { DocProvider, useStore } from './store';
import { Outline } from './Outline';

const BARCELONA: Place = { name: 'Barcelona', lat: 41.39, lon: 2.17, label: 'Barcelona, Spain', kind: 'city' };
const EL_PRAT: Found = { name: 'El Prat Airport', lat: 41.3, lon: 2.08, label: 'Barcelona, Spain', kind: 'airport' };
const MADRID: Found = { name: 'Madrid', lat: 40.42, lon: -3.7, label: 'Madrid, Spain', kind: 'city', elsewhere: true };

/** "Trip @Barcelona" with a child bullet "Visit": the child has a parent place to bias to. */
function tripDoc(extraPlaces: Doc['places'] = {}): Doc {
  const nodes: Record<string, OutlineNode> = {
    root: { id: 'root', text: '', children: ['t'] },
    t: { id: 't', text: 'Trip @Barcelona', children: ['v'] },
    v: { id: 'v', text: 'Visit', children: [] },
  };
  return { version: 1, rootId: 'root', nodes, places: { barcelona: BARCELONA, ...extraPlaces } };
}

function flatDoc(): Doc {
  const nodes: Record<string, OutlineNode> = {
    root: { id: 'root', text: '', children: ['v'] },
    v: { id: 'v', text: 'Visit', children: [] },
  };
  return { version: 1, rootId: 'root', nodes, places: {} };
}

function services(search: Services['search']): Services {
  return {
    search,
    geocode: async () => null,
    weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
    route: async () => ({ seconds: 3600, meters: 100000 }),
  };
}

async function typeMention(doc: Doc, svc: Services, typed = '{End} @mad') {
  let places: Doc['places'] = {};
  function Probe() {
    places = useStore().doc.places;
    return null;
  }
  const user = userEvent.setup();
  render(
    <DocProvider initialDoc={doc} services={svc} storage={null} today="2026-10-28">
      <Outline />
      <Probe />
    </DocProvider>,
  );
  await user.click(screen.getByText('Visit'));
  await user.keyboard(typed);
  return { user, places: () => places };
}

describe('place picker sections and icons', () => {
  it('shows a kind icon per row and an Elsewhere divider before the outside rows', async () => {
    await typeMention(tripDoc(), services(async () => [EL_PRAT, MADRID]));
    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
    const rows = within(list).getAllByRole('option');
    expect(rows[0].textContent).toBe('✈️El Prat AirportBarcelona, Spain');
    expect(rows[1].textContent).toBe('🏙️MadridMadrid, Spain');
    const divider = list.querySelector('.picker-divider');
    expect(divider).toHaveTextContent('Elsewhere');
    expect(divider).toHaveAttribute('role', 'presentation');
    expect(rows[0].compareDocumentPosition(divider!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider!.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ArrowDown then Enter picks the Elsewhere row; the divider is not an option', async () => {
    const { user, places } = await typeMention(tripDoc(), services(async () => [EL_PRAT, MADRID]));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(places().madrid).toBeDefined());
    expect(places().madrid).not.toHaveProperty('elsewhere');
    expect(places().madrid.kind).toBe('city');
    expect(screen.getByRole('textbox')).toHaveValue('Visit @Madrid ');
  });

  it('shows no divider without a parent place, even when rows are flagged', async () => {
    await typeMention(flatDoc(), services(async () => [EL_PRAT, MADRID]));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(document.querySelector('.picker-divider')).toBeNull();
  });

  it('shows no divider when every row is elsewhere (nothing before it)', async () => {
    await typeMention(tripDoc(), services(async () => [MADRID]));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(document.querySelector('.picker-divider')).toBeNull();
  });

  it('counts a saved row as before the divider', async () => {
    const mad: Place = { name: 'Madrid', lat: 40.42, lon: -3.7, kind: 'city' };
    const other: Found = { name: 'Madrid Barajas', lat: 40.49, lon: -3.57, kind: 'airport', elsewhere: true };
    await typeMention(tripDoc({ madrid: mad }), services(async () => [other]));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent('Madrid');
    expect(list.querySelector('.picker-divider')).toHaveTextContent('Elsewhere');
  });

  it('renders an early onUpdate list before the search promise resolves', async () => {
    const svc = services((_q, _near, opts) => {
      opts?.onUpdate?.([EL_PRAT]);
      return new Promise(() => {});
    });
    await typeMention(tripDoc(), svc);
    expect(await screen.findByText('El Prat Airport')).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toHaveTextContent('✈️');
  });

  it('caps rows at 4 saved, 8 inside and 8 elsewhere', async () => {
    const saved: Doc['places'] = {};
    for (let i = 0; i < 6; i++) saved[`mad saved ${i}`] = { name: `Saved ${i}`, lat: 10 + i, lon: 10 };
    const inside: Found[] = Array.from({ length: 12 }, (_, i) => ({ name: `In ${i}`, lat: 41 + i / 50, lon: 2 }));
    const out: Found[] = Array.from({ length: 12 }, (_, i) => ({ name: `Out ${i}`, lat: 50 + i, lon: 20, elsewhere: true }));
    await typeMention(tripDoc(saved), services(async () => [...inside, ...out]));
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(4));
    const names = screen.getAllByRole('option').map((o) => o.querySelector('strong')!.textContent!);
    expect(names.filter((n) => n.startsWith('Saved'))).toHaveLength(4);
    expect(names.filter((n) => n.startsWith('In '))).toHaveLength(8);
    expect(names.filter((n) => n.startsWith('Out '))).toHaveLength(8);
  });

  it('scrolls the newly highlighted row into view as the arrow keys move (wrapping too)', async () => {
    const rows: Found[] = Array.from({ length: 16 }, (_, i) => ({ name: `Row ${i}`, lat: 41 + i / 20, lon: 2, ...(i >= 8 ? { elsewhere: true as const } : {}) }));
    const { user } = await typeMention(tripDoc(), services(async () => rows));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(16));
    const options = screen.getAllByRole('option');
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    try {
      await user.keyboard('{ArrowDown}');
      expect(scrolled.at(-1)).toBe(options[1]);
      await user.keyboard('{ArrowUp}{ArrowUp}'); // 1 -> 0 -> wraps to the last row
      expect(scrolled.at(-1)).toBe(options[15]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
