import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode, ViewKind } from '../../model/types';
import type { Services } from '../../services/types';
import { resolveContexts } from '../../context/resolve';
import { DocProvider } from '../store';
import { Outline } from '../Outline';
import { CalendarView } from './CalendarView';
import { collectDates, collectPlaces, plainText, unresolvedPlaces } from './collect';

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

  it('unresolvedPlaces lists mention keys in the subtree that have no coordinates yet', () => {
    expect(unresolvedPlaces(doc, ctx, 'trip')).toEqual([{ key: 'atlantis', name: 'Atlantis' }]);
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
  search: async () => [],
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
    const view = container.querySelector<HTMLElement>('[data-view="calendar"]')!;
    expect(within(view).getByText('November 2026')).toBeInTheDocument();
    const grid = within(view.querySelector<HTMLElement>('.month-grid')!);
    expect(grid.getAllByRole('button')).toHaveLength(2);
    expect(grid.getByRole('button', { name: 'arrive' })).toBeInTheDocument();
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

  const narrowDoc = () =>
    build([['trip', 'Trip', [['a', 'Nov 3 arrive'], ['b', 'Nov 5 leave'], ['c', 'Nov 5 dinner']]]]);
  const renderCalendar = (forceNarrow?: boolean) =>
    render(
      <DocProvider initialDoc={narrowDoc()} services={services} storage={null} today={TODAY}>
        <CalendarView id="trip" forceNarrow={forceNarrow} />
      </DocProvider>,
    );

  it('when narrow, the grid shows dots and the agenda holds the buttons', () => {
    const { container } = renderCalendar(true);
    const grid = container.querySelector<HTMLElement>('.month-grid')!;
    expect(within(grid).queryAllByRole('button')).toHaveLength(0);
    expect(grid.querySelectorAll('span[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    const days = container.querySelectorAll('.agenda li');
    expect(days).toHaveLength(2);
    expect(days[0]).toHaveTextContent('Tue, Nov 3');
    expect(within(container.querySelector<HTMLElement>('.agenda')!).getAllByRole('button')).toHaveLength(3);
    expect(within(days[1] as HTMLElement).getAllByRole('button')).toHaveLength(2);
  });

  it('when wide (the default), there is no agenda list', () => {
    const { container } = renderCalendar();
    expect(container.querySelector('.agenda')).toBeNull();
    expect(within(container.querySelector<HTMLElement>('.month-grid')!).getAllByRole('button')).toHaveLength(3);
  });

  it('clicking an entry focuses its node for editing', async () => {
    const { user, container } = setup(build([['trip', 'Trip', [['a', 'Nov 3 arrive']], 'calendar']]));
    const grid = within(container.querySelector<HTMLElement>('[data-view="calendar"] .month-grid')!);
    await user.click(grid.getByRole('button', { name: 'arrive' }));
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
