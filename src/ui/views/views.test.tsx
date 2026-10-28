import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode, ViewKind } from '../../model/types';
import type { Services } from '../../services/types';
import { resolveContexts } from '../../context/resolve';
import { DocProvider } from '../store';
import { Outline } from '../Outline';
import { collectDates, collectPlaces, plainText } from './collect';

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
const PORTO = { name: 'Porto', lat: 41.16, lon: -8.63 };
const TODAY = '2026-10-28';

describe('collect', () => {
  const doc = build(
    [['trip', 'Trip to @Lisbon', [
      ['a', 'Nov 3 arrive @Lisbon'],
      ['b', 'Nov 5 visit @Atlantis then @Porto {distance(@Lisbon, @Porto)}'],
      ['c', 'Nov 5 dinner'],
    ]]],
    { lisbon: LISBON, porto: PORTO },
  );
  const ctx = resolveContexts(doc, TODAY);

  it('collectPlaces returns resolved own places in document order, skipping unresolved', () => {
    expect(collectPlaces(doc, ctx, 'trip')).toEqual([
      { nodeId: 'trip', key: 'lisbon', place: LISBON, index: 1 },
      { nodeId: 'a', key: 'lisbon', place: LISBON, index: 2 },
      { nodeId: 'b', key: 'porto', place: PORTO, index: 3 },
    ]);
  });

  it('collectDates groups nodes by their own dates, sorted', () => {
    expect([...collectDates(doc, ctx, 'trip')]).toEqual([
      ['2026-11-03', ['a']],
      ['2026-11-05', ['b', 'c']],
    ]);
  });

  it('plainText can drop dates and leading separators for calendar cells', () => {
    expect(plainText('Nov 5 — visit @Porto', { dates: false })).toBe('visit Porto');
  });

  it('plainText strips mention syntax and formulas', () => {
    expect(plainText('Nov 5 visit @[Time Out] then @Porto {x}')).toBe('Nov 5 visit Time Out then Porto');
  });
});

const services: Services = {
  geocode: async () => null,
  weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
  route: async () => ({ seconds: 3600, meters: 100000 }),
};

function setup(doc: Doc) {
  const user = userEvent.setup();
  const utils = render(
    <DocProvider initialDoc={doc} services={services} storage={null} today={TODAY}>
      <Outline />
    </DocProvider>,
  );
  return { user, ...utils };
}

describe('CalendarView', () => {
  it('renders a November grid with an entry per dated node', () => {
    const { container } = setup(build([['trip', 'Trip', [['a', 'Nov 3 arrive'], ['b', 'Nov 5 leave']], 'calendar']]));
    const cal = within(container.querySelector<HTMLElement>('[data-view="calendar"]')!);
    expect(cal.getByText('November 2026')).toBeInTheDocument();
    expect(cal.getAllByRole('button')).toHaveLength(2);
    expect(cal.getByRole('button', { name: 'arrive' })).toBeInTheDocument();
  });

  it('only renders the weeks the dates span', () => {
    const { container } = setup(build([['trip', 'Trip', [['a', 'Nov 3 2026 arrive'], ['b', 'Nov 12 2026 leave']], 'calendar']]));
    // Mon Nov 2 → Sun Nov 15: two weeks
    expect(container.querySelectorAll('[data-view="calendar"] .day')).toHaveLength(14);
  });

  it('labels a span across months with both month names', () => {
    const { container } = setup(build([['trip', 'Trip', [['a', 'Nov 30 2026 arrive'], ['b', 'Dec 2 2026 leave']], 'calendar']]));
    expect(container.querySelector('[data-view="calendar"] h4')).toHaveTextContent('November – December 2026');
  });

  it('clicking an entry focuses its node for editing', async () => {
    const { user, container } = setup(build([['trip', 'Trip', [['a', 'Nov 3 arrive']], 'calendar']]));
    const cal = within(container.querySelector<HTMLElement>('[data-view="calendar"]')!);
    await user.click(cal.getByRole('button', { name: 'arrive' }));
    expect(screen.getByRole('textbox')).toHaveValue('Nov 3 arrive');
  });

  it('shows a hint when the subtree has no dates', () => {
    const { container } = setup(build([['trip', 'Trip', [['a', 'nothing']], 'calendar']]));
    expect(container.querySelector('[data-view="calendar"]')).toHaveTextContent(/no dates/i);
  });
});

describe('TableView', () => {
  it('renders one row per child with place, date and formula columns', async () => {
    const { container } = setup(
      build(
        [['ideas', 'Ideas', [['x', 'Nov 4 @Porto {1 + 1}'], ['y', 'Something else {2 * 3}']], 'table']],
        { porto: PORTO },
      ),
    );
    const table = container.querySelector<HTMLElement>('[data-view="table"] table')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    const t = within(table);
    await waitFor(() => expect(t.getByText('2')).toBeInTheDocument());
    expect(t.getByText('6')).toBeInTheDocument();
    expect(t.getByText('Wed, Nov 4')).toBeInTheDocument();
    expect(table.querySelectorAll('th')).toHaveLength(4);
  });
});
