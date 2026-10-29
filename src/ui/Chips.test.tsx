import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode, ViewKind } from '../model/types';
import type { Services } from '../services/types';
import { DocProvider } from './store';
import { Outline } from './Outline';
import { sampleDoc } from '../model/sample';

type Spec = [string, string, Spec[]?, ViewKind?];
function build(spec: Spec[], places: Doc['places'] = {}): Doc {
  const nodes: Record<string, OutlineNode> = {};
  const add = ([id, text, kids = [], view]: Spec): string => {
    nodes[id] = { id, text, children: kids.map(add), ...(view ? { view } : {}) };
    return id;
  };
  nodes.root = { id: 'root', text: '', children: spec.map(add) };
  return { version: 1, rootId: 'root', nodes, places };
}

const LISBON = { name: 'Lisbon', lat: 38.72, lon: -9.14 };
const PORTO = { name: 'Porto', lat: 41.15, lon: -8.61 };
const PLACES = { lisbon: LISBON, porto: PORTO };

const services: Services = {
  search: async () => [],
  geocode: async () => null,
  weather: async () => ({ code: 3, condition: 'Overcast', icon: '☁️', high: 18, low: 11 }),
  route: async () => ({ seconds: 3 * 3600 + 5 * 60, meters: 313_000 }),
};

function setup(doc: Doc) {
  const user = userEvent.setup();
  const utils = render(
    <DocProvider initialDoc={doc} services={services} storage={null} today="2026-10-28">
      <Outline />
    </DocProvider>,
  );
  return { user, ...utils };
}

const rich = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`li[data-node-id="${id}"] .rich`)!; // a row's own text comes first

describe('phrase chips', () => {
  it('a weather word becomes a weather chip where the word was', async () => {
    const { container } = setup(build([['a', 'Nov 3 @Lisbon', [['b', 'Day out weather, then home']]]], PLACES));
    const row = rich(container, 'b');
    const chip = await within(row).findByText('☁️ 18° / 11°');
    expect(chip).toHaveClass('chip-formula');
    expect(chip).toHaveAttribute('title', '{weather()}');
    expect(row.textContent).toBe('Day out ☁️ 18° / 11°, then home');
  });

  it('an escaped weather word stays a plain word', () => {
    const { container } = setup(build([['a', '\\weather is fine']]));
    expect(rich(container, 'a').textContent).toBe('weather is fine');
    expect(rich(container, 'a').querySelector('.chip-formula')).toBeNull();
  });

  it('"drive to @Porto" under a bullet with @Lisbon shows a travel chip after the destination', async () => {
    const { container } = setup(build([['a', 'Trip from @Lisbon', [['b', 'Then drive to @Porto!']]]], PLACES));
    const row = rich(container, 'b');
    const chip = await within(row).findByText('🚗 3h 05m · 313 km');
    expect(chip).toHaveClass('chip-formula', 'kind-travel');
    expect(chip).toHaveAttribute('title', '{travel("drive", prev, @[porto])}');
    // The mode word reads as plain text, and the chip sits right after Porto's chip.
    expect(row.textContent).toBe('Then drive to Porto🚗 3h 05m · 313 km!');
    expect(within(row).getByText('Porto').nextElementSibling).toBe(chip);
  });

  it('"transit to @Porto" carries a Directions link that does not open the editor', async () => {
    const { user, container } = setup(build([['a', 'Trip from @Lisbon', [['b', 'transit to @Porto']]]], PLACES));
    const link = await within(rich(container, 'b')).findByRole('link', {
      name: 'Public transport directions in Google Maps (opens in a new tab)',
    });
    expect(link).toHaveTextContent('Directions ↗');
    expect(link).toHaveClass('chip-link');
    expect(link.getAttribute('href')).toContain('travelmode=transit');
    expect(link.getAttribute('href')).toContain('origin=38.72,-9.14');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const chip = link.closest('.chip')!;
    expect(chip.textContent).toBe('🚆 313 km · Directions ↗');
    expect(chip.parentElement).toHaveClass('chip-wrap');
    await user.click(link);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a travel chip without a directions URL has no link', async () => {
    const { container } = setup(build([['a', 'Trip from @Lisbon', [['b', 'fly to @Porto']]]], PLACES));
    await within(rich(container, 'b')).findByText(/^✈ \d+ km$/);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a route with an unresolved destination stays pending, then errors like a formula', async () => {
    const { container } = setup(build([['a', 'Trip from @Lisbon', [['b', 'walk to @Atlantis']]]], PLACES));
    const row = rich(container, 'b');
    await waitFor(() => expect(row.querySelector('.chip-formula.is-error')).not.toBeNull());
  });
});

describe('old notes whose formula already says it (I1)', () => {
  it('"Nov 3 — drive to @Porto {route(@Lisbon, here)}" shows only its route chip', async () => {
    const { container } = setup(build([['a', 'Nov 3 — drive to @Porto {route(@Lisbon, here)}']], PLACES));
    const row = rich(container, 'a');
    const chip = await within(row).findByText('🚗 3h 05m · 313 km');
    expect(chip).toHaveClass('kind-route');
    expect(row.querySelectorAll('.chip-formula')).toHaveLength(1);
    expect(row.querySelector('.kind-travel, .is-error')).toBeNull();
    expect(row.textContent).toBe('Nov 3 — drive to Porto 🚗 3h 05m · 313 km');
  });

  it('"Forecast in Porto: {weather()}" shows one weather chip and the word', async () => {
    const { container } = setup(build([['a', 'Nov 3 @Porto', [['b', 'Forecast in Porto: {weather()}']]]], PLACES));
    const row = rich(container, 'b');
    await within(row).findByText('☁️ 18° / 11°');
    expect(row.querySelectorAll('.chip-formula')).toHaveLength(1);
    expect(row.textContent).toBe('Forecast in Porto: ☁️ 18° / 11°');
  });
});

describe('a weather word with nothing to forecast (I2)', () => {
  it('"Q4 sales forecast review" reads as plain text, with no chip', () => {
    const { container } = setup(build([['a', 'Q4 sales forecast review']]));
    const row = rich(container, 'a');
    expect(row.textContent).toBe('Q4 sales forecast review');
    expect(row.querySelector('.chip')).toBeNull();
    expect(within(row).getByText('forecast')).toHaveAttribute('title', 'No place here for a forecast');
  });

  it('a bullet with a place but no date shows the plain word with its tooltip', () => {
    const { container } = setup(build([['a', 'Pack for the weather @Lisbon']], PLACES));
    const row = rich(container, 'a');
    expect(row.querySelector('.chip-formula')).toBeNull();
    expect(within(row).getByText('weather')).toHaveAttribute('title', 'No date here for a forecast');
    expect(row.textContent).toBe('Pack for the weather Lisbon');
  });

  it('a dated bullet with a place still shows the chip', async () => {
    const { container } = setup(build([['a', 'Nov 3 @Lisbon weather']], PLACES));
    const row = rich(container, 'a');
    await within(row).findByText('☁️ 18° / 11°');
    expect(within(row).queryByText('weather')).toBeNull();
  });

  it('any other failure still shows the error chip ("no forecast yet")', async () => {
    const { container } = setup(build([['a', 'Dec 30 @Lisbon weather']], PLACES));
    const row = rich(container, 'a');
    await waitFor(() => expect(row.querySelector('.chip-formula.is-error')).not.toBeNull());
    expect(row.querySelector('.chip-formula.is-error')).toHaveTextContent('no forecast yet');
  });

  it('a written {weather()} formula keeps its error chip', async () => {
    const { container } = setup(build([['a', 'Plan {weather()}']]));
    const row = rich(container, 'a');
    await waitFor(() => expect(row.querySelector('.chip-formula.is-error')).not.toBeNull());
  });
});

describe('place-kind icons', () => {
  it('a resolved café shows ☕, a place without a kind shows 📍', () => {
    const { container } = setup(
      build([['a', 'Coffee at @Cafe then @Porto and @Nowhere']], {
        cafe: { name: 'Café', lat: 1, lon: 1, kind: 'cafe' },
        porto: PORTO,
      }),
    );
    const row = rich(container, 'a');
    expect(within(row).getByText('Cafe')).toHaveAttribute('data-icon', '☕');
    expect(within(row).getByText('Porto')).toHaveAttribute('data-icon', '📍');
    expect(within(row).getByText('Nowhere')).toHaveAttribute('data-icon', '📍');
  });
});

describe('the sample note', () => {
  it('renders its phrases as one chip per fact, with no error chips', async () => {
    const doc = sampleDoc(new Date(2026, 9, 28));
    const { container } = setup(doc);
    const idOf = (start: string) => Object.values(doc.nodes).find((n) => n.text.includes(start))!.id;
    const drive = rich(container, idOf('drive from @Lisbon'));
    await within(drive).findByText('🚗 3h 05m · 313 km');
    expect(drive.querySelectorAll('.chip-formula')).toHaveLength(1);
    const weather = rich(container, idOf('Porto weather'));
    await within(weather).findByText('☁️ 18° / 11°');
    expect(weather.querySelectorAll('.chip-formula')).toHaveLength(1);
    await waitFor(() => expect(container.querySelector('.chip-formula.is-pending')).toBeNull());
    expect(container.querySelector('.chip-formula.is-error')).toBeNull();
  });
});
