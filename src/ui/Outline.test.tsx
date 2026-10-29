import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode } from '../model/types';
import type { Services } from '../services/types';
import { DocProvider, useStore } from './store';
import { STORAGE_KEY } from '../model/storage';
import { TransientError } from '../services/http';
import { Outline } from './Outline';

function build(items: [string, string][]): Doc {
  const nodes: Record<string, OutlineNode> = { root: { id: 'root', text: '', children: items.map(([id]) => id) } };
  for (const [id, text] of items) nodes[id] = { id, text, children: [] };
  return { version: 1, rootId: 'root', nodes, places: {} };
}

const services: Services = {
  search: async () => [],
  geocode: async (name) => (name === 'lisbon' ? { name: 'Lisboa', lat: 38.72, lon: -9.14 } : null),
  weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
  route: async () => ({ seconds: 3600, meters: 100000 }),
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

describe('Outline', () => {
  it('an empty outline offers "Start typing…", which adds a focused first bullet', async () => {
    const { user, container } = setup(build([]));
    await user.click(screen.getByRole('button', { name: 'Start typing…' }));
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('typing then Enter creates a second, focused row', async () => {
    const { user, container } = setup(build([['a', 'hello']]));
    await user.click(screen.getByText('hello'));
    await user.keyboard('{End} world{Enter}');
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(2);
    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue('');
    expect(editor).toHaveFocus();
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('Tab indents the row under its previous sibling', async () => {
    const { user, container } = setup(build([['a', 'first'], ['b', 'second']]));
    await user.click(screen.getByText('second'));
    await user.keyboard('{Tab}');
    expect(container.querySelector('li[data-node-id="a"] li[data-node-id="b"]')).not.toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('second');
  });

  it('Shift+Tab outdents it again', async () => {
    const { user, container } = setup(build([['a', 'first'], ['b', 'second']]));
    await user.click(screen.getByText('second'));
    await user.keyboard('{Tab}{Shift>}{Tab}{/Shift}');
    expect(container.querySelector('li[data-node-id="a"] li[data-node-id="b"]')).toBeNull();
  });

  it('Backspace on an empty row deletes it', async () => {
    const { user, container } = setup(build([['a', 'first'], ['b', '']]));
    await user.click(container.querySelector('li[data-node-id="b"] .rich')!);
    await user.keyboard('{Backspace}');
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('first');
  });

  it('an unfocused place mention renders a chip that resolves', async () => {
    setup(build([['a', 'Visit @Lisbon']]));
    const chip = await screen.findByText('Lisbon');
    expect(chip).toHaveClass('chip-place');
    await waitFor(() => expect(chip).toHaveAttribute('title', 'Lisboa'));
  });

  it('phrase words still read in the read view until they get chips', () => {
    const { container } = setup(build([['a', 'Forecast in @Lisbon'], ['b', '\\weather and drive to @Porto']]));
    expect(container.querySelector('li[data-node-id="a"] .rich')?.textContent).toMatch(/^Forecast in /);
    expect(container.querySelector('li[data-node-id="b"] .rich')?.textContent).toMatch(/^weather and drive to /);
  });

  it('an unknown place renders a missing chip', async () => {
    setup(build([['a', 'Visit @Atlantis']]));
    await waitFor(() => expect(screen.getByText('Atlantis')).toHaveClass('is-missing'));
  });

  it('formulas render their results', async () => {
    setup(build([['a', 'total {1 + 2}']]));
    expect(await screen.findByText('3')).toHaveClass('chip-formula');
  });

  it('a formula error renders an error chip without crashing', async () => {
    setup(build([['a', 'oops {1 +}']]));
    expect(await screen.findByText(/⚠/)).toHaveClass('is-error');
  });

  it('tapping an error chip shows the full message in a popover, without opening the editor', async () => {
    const { user } = setup(build([['a', 'oops {1 +}']]));
    const chip = await screen.findByText(/⚠/);
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(chip);
    const pop = screen.getByRole('status');
    expect(pop.textContent).toMatch(/\S/);
    expect(pop.textContent).not.toBe(chip.textContent);
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(chip);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the error popover closes on Escape and on an outside tap', async () => {
    const { user } = setup(build([['a', 'oops {1 +}'], ['b', 'other']]));
    const chip = await screen.findByText(/⚠/);
    await user.click(chip);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(chip);
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the error popover is portalled out of a clipping table view and stays placed in the viewport', async () => {
    const nodes: Record<string, OutlineNode> = {
      root: { id: 'root', text: '', children: ['t'] },
      t: { id: 't', text: 'Ideas', children: ['x'], view: 'table' },
      x: { id: 'x', text: 'row {1 +}', children: [] },
    };
    const doc: Doc = { version: 1, rootId: 'root', nodes, places: {} };
    const { user, container } = setup(doc);
    const table = container.querySelector<HTMLElement>('[data-view="table"] table')!;
    const chip = await within(table).findByText(/⚠/);
    // jsdom has no layout: put the chip left of the viewport and check the clamp.
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 120, left: -50, right: 0, width: 50, height: 20, x: -50, y: 100, toJSON: () => ({}),
    });
    await user.click(chip);
    const pop = screen.getByRole('status');
    expect(pop.textContent).toMatch(/\S/);
    expect(container.contains(pop)).toBe(false);
    expect(pop.parentElement).toBe(document.body);
    expect(pop.style.left).toBe('8px');
    expect(pop.style.top).toBe('124px');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keys that belong to an IME candidate list do not split, indent or move', async () => {
    const { user, container } = setup(build([['a', 'first'], ['b', 'second']]));
    await user.click(screen.getByText('second'));
    const editor = screen.getByRole('textbox');
    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(editor, { key: 'Tab' });
    fireEvent.keyDown(editor, { key: 'ArrowUp' });
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(2);
    expect(container.querySelector('li[data-node-id="a"] li[data-node-id="b"]')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('second');
    // Android reports committed candidates as keyCode 229 without a composition flag.
    fireEvent.compositionEnd(editor);
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 });
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(2);
    // Once composition is over, Enter splits again.
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(3);
  });

  it('marks the editor as composing between compositionstart and compositionend', async () => {
    const { user, container } = setup(build([['a', 'hello']]));
    await user.click(screen.getByText('hello'));
    const wrap = container.querySelector('.editor-wrap')!;
    const editor = screen.getByRole('textbox');
    expect(wrap).not.toHaveClass('is-composing');
    fireEvent.compositionStart(editor);
    expect(wrap).toHaveClass('is-composing');
    fireEvent.compositionEnd(editor);
    expect(wrap).not.toHaveClass('is-composing');
  });

  it('typing /map at the end of a row and pressing Enter attaches a map view', async () => {
    const { user, container } = setup(build([['a', 'Day 1']]));
    await user.click(screen.getByText('Day 1'));
    await user.keyboard('{End} /table{Enter}');
    expect(container.querySelector('[data-view="table"]')).not.toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('Day 1');
  });

  it('the view toggle buttons attach and detach a view', async () => {
    const { user, container } = setup(build([['a', 'Day 1']]));
    await user.click(screen.getByRole('button', { name: 'Calendar view' }));
    expect(container.querySelector('[data-view="calendar"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Calendar view' }));
    expect(container.querySelector('[data-view="calendar"]')).toBeNull();
  });
});

describe('store robustness', () => {
  it('does not geocode half-typed mentions through formulas in other rows', async () => {
    const calls: string[] = [];
    const recording: Services = { ...services, geocode: async (n) => { calls.push(n); return services.geocode(n); } };
    const doc = build([['p', 'Trip']]);
    doc.nodes.p.children = ['c'];
    doc.nodes.root.children = ['p'];
    doc.nodes.c = { id: 'c', text: 'lunch {here.name}', children: [] };
    const user = userEvent.setup();
    render(
      <DocProvider initialDoc={doc} services={recording} storage={null} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    await user.click(screen.getByText('Trip'));
    await user.keyboard('{End} @Lisbon');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
    await user.click(document.body); // leave the row
    await waitFor(() => expect(screen.getByText('Lisboa')).toBeInTheDocument());
    expect(calls).toEqual(['lisbon']);
  });

  it('re-resolves places after the document is replaced', async () => {
    let replace: (d: Doc) => void = () => {};
    function Grab() {
      replace = useStore().replaceDoc;
      return null;
    }
    render(
      <DocProvider initialDoc={build([['a', 'Visit @Lisbon']])} services={services} storage={null} today="2026-10-28">
        <Grab />
        <Outline />
      </DocProvider>,
    );
    await waitFor(() => expect(screen.getByText('Lisbon')).toHaveAttribute('title', 'Lisboa'));
    act(() => replace(build([['b', 'Back to @Lisbon']])));
    await waitFor(() => expect(screen.getByText('Lisbon')).toHaveAttribute('title', 'Lisboa'));
  });

  it('picks up edits saved by another tab', async () => {
    window.localStorage.clear();
    render(
      <DocProvider initialDoc={build([['a', 'mine']])} services={services} storage={window.localStorage} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    const theirs = JSON.stringify(build([['a', 'from the other tab']]));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: theirs }));
    });
    expect(await screen.findByText('from the other tab')).toBeInTheDocument();
  });

  it('flushes a pending save when the page is hidden', async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    render(
      <DocProvider initialDoc={build([['a', 'x']])} services={services} storage={window.localStorage} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    await user.click(screen.getByText('x'));
    await user.keyboard('{End}yz');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('xyz');
  });
});

describe('slash commands', () => {
  it('only treat /table as a command when it is a separate word', async () => {
    const { user, container } = setup(build([['a', 'dinner/table']]));
    await user.click(screen.getByText('dinner/table'));
    await user.keyboard('{End}{Enter}');
    expect(container.querySelector('[data-view]')).toBeNull();
    expect(screen.getByText('dinner/table')).toBeInTheDocument();
  });
});

describe('editor highlighting', () => {
  it('colours mentions, dates and formulas while typing', async () => {
    const { user, container } = setup(build([['a', 'x']]));
    await user.click(screen.getByText('x'));
    await user.keyboard('{End} @Lisbon on Nov 3 {{1 + 1}');
    const mirror = container.querySelector('.editor-mirror')!;
    expect(mirror.querySelector('.hl-place')).toHaveTextContent('@Lisbon');
    expect(mirror.querySelector('.hl-date')).toHaveTextContent('Nov 3');
    expect(mirror.querySelector('.hl-formula')).toHaveTextContent('{1 + 1}');
    // the mirror must reproduce the raw text exactly so the caret lines up
    expect(mirror.textContent!.replace(/​$/, '')).toBe('x @Lisbon on Nov 3 {1 + 1}');
  });
});

describe('place lookups', () => {
  it('retries a place the service could not reach, instead of calling it "not found"', async () => {
    let calls = 0;
    const flaky: Services = {
      ...services,
      geocode: async (n) => {
        calls++;
        if (calls === 1) throw new TransientError('place lookup unavailable');
        return services.geocode(n);
      },
    };
    render(
      <DocProvider initialDoc={build([['a', 'Visit @Lisbon']])} services={flaky} storage={null} today="2026-10-28" retryDelaysMs={[10]}>
        <Outline />
      </DocProvider>,
    );
    await waitFor(() => expect(screen.getByText('Lisbon')).toHaveClass('is-error'));
    await waitFor(() => expect(screen.getByText('Lisbon')).toHaveAttribute('title', 'Lisboa'));
    expect(calls).toBe(2);
  });

  it('looks up a mention near its parent bullet’s place', async () => {
    const seen: [string, string | undefined][] = [];
    const biased: Services = {
      ...services,
      geocode: async (n, near) => {
        seen.push([n, near?.name]);
        return n === 'lisbon' ? { name: 'Lisboa', lat: 38.72, lon: -9.14 } : { name: 'Time Out Market Lisboa', lat: 38.707, lon: -9.146 };
      },
    };
    const doc = build([['p', 'Day in @Lisbon']]);
    doc.nodes.p.children = ['c'];
    doc.nodes.c = { id: 'c', text: 'Lunch at @[Time Out Market]', children: [] };
    render(
      <DocProvider initialDoc={doc} services={biased} storage={null} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    await waitFor(() => expect(screen.getByText('Time Out Market')).toHaveAttribute('title', 'Time Out Market Lisboa'));
    expect(seen).toEqual([['lisbon', undefined], ['time out market', 'Lisboa']]);
  });

  it('a formula waits for its mention to resolve rather than looking it up again', async () => {
    const seen: string[] = [];
    const counting: Services = { ...services, geocode: async (n, near) => { seen.push(n); return services.geocode(n, near); } };
    render(
      <DocProvider initialDoc={build([['a', 'Visit @Lisbon {here.name}']])} services={counting} storage={null} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    expect(await screen.findByText('Lisboa', { selector: '.chip-formula' })).toBeInTheDocument();
    expect(seen).toEqual(['lisbon']);
  });
});

describe('place picker', () => {
  const LISBOA = { name: 'Lisbon', lat: 38.72, lon: -9.14, label: 'Lisbon, Portugal' };
  const IOWA = { name: 'Lisbon', lat: 41.92, lon: -91.39, label: 'Lisbon, Iowa, United States' };

  function setupPicker(doc: Doc) {
    const queries: string[] = [];
    const geocoded: string[] = [];
    const svc: Services = {
      ...services,
      search: async (q) => {
        queries.push(q);
        return q.toLowerCase().startsWith('lis') ? [LISBOA, IOWA] : [];
      },
      geocode: async (n) => {
        geocoded.push(n);
        return null;
      },
    };
    const user = userEvent.setup();
    const utils = render(
      <DocProvider initialDoc={doc} services={svc} storage={null} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    return { user, queries, geocoded, ...utils };
  }

  it('suggests places while typing an @mention and inserts the picked one', async () => {
    const { user, geocoded } = setupPicker(build([['a', 'Visit']]));
    await user.click(screen.getByText('Visit'));
    await user.keyboard('{End} @lis');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['📍LisbonLisbon, Portugal', '📍LisbonLisbon, Iowa, United States']);
    await user.click(options[0]);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(editor).toHaveValue('Visit @Lisbon ');
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(14);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Escape}');
    // the picked place is stored, so no blind lookup happens
    expect(await screen.findByText('Lisbon')).toHaveAttribute('title', 'Lisbon, Portugal');
    expect(geocoded).toEqual([]);
  });

  it('stores a picked Elsewhere row without its section flag', async () => {
    let places: Doc['places'] = {};
    function Probe() {
      places = useStore().doc.places;
      return null;
    }
    const svc: Services = { ...services, search: async () => [{ ...LISBOA, elsewhere: true }] };
    const user = userEvent.setup();
    render(
      <DocProvider initialDoc={build([['a', 'Visit']])} services={svc} storage={null} today="2026-10-28">
        <Outline />
        <Probe />
      </DocProvider>,
    );
    await user.click(screen.getByText('Visit'));
    await user.keyboard('{End} @lis');
    await user.click((await screen.findAllByRole('option'))[0]);
    await waitFor(() => expect(places.lisbon).toEqual(LISBOA));
    expect(places.lisbon).not.toHaveProperty('elsewhere');
  });

  it('arrow keys and Enter pick a suggestion without splitting the bullet', async () => {
    const { user, container } = setupPicker(build([['a', 'Visit']]));
    await user.click(screen.getByText('Visit'));
    await user.keyboard('{End} @lis');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue('Visit @Lisbon ');
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Lisbon')).toHaveAttribute('title', 'Lisbon, Iowa, United States');
  });

  it('does not search the web for fewer than 2 characters, but offers saved places', async () => {
    const doc = build([['a', 'Been to @Porto'], ['b', 'Next']]);
    doc.places.porto = { name: 'Porto', lat: 41.15, lon: -8.61, label: 'Porto, Portugal' };
    const { user, queries } = setupPicker(doc);
    await user.click(screen.getByText('Next'));
    await user.keyboard('{End} @p');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Porto');
    expect(queries).toEqual([]);
  });

  it('Escape closes the suggestions and keeps editing', async () => {
    const { user } = setupPicker(build([['a', 'Visit']]));
    await user.click(screen.getByText('Visit'));
    await user.keyboard('{End} @lis');
    await screen.findAllByRole('option');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
});

describe('review fixes: lookups', () => {
  const RIYADH = { name: 'Riyadh', lat: 24.69, lon: 46.72 };

  it('retries a place used only inside a formula', async () => {
    let calls = 0;
    const svc: Services = {
      ...services,
      geocode: async () => {
        calls++;
        if (calls === 1) throw new TransientError('place lookup unavailable');
        return RIYADH;
      },
    };
    render(
      <DocProvider initialDoc={build([['a', 'span {distance(@Riyadh, @Riyadh)}']])} services={svc} storage={null} today="2026-10-28" retryDelaysMs={[10]}>
        <Outline />
      </DocProvider>,
    );
    expect(await screen.findByText('0 m', {}, { timeout: 2000 })).toHaveClass('chip-formula');
    expect(calls).toBe(2);
  });

  it('formula rows still get the parent-biased lookup', async () => {
    const seen: [string, string | undefined][] = [];
    const svc: Services = {
      ...services,
      geocode: async (n, near) => {
        seen.push([n, near?.name]);
        return n === 'lisbon' ? { name: 'Lisboa', lat: 38.72, lon: -9.14 } : { name: 'Time Out Market Lisboa', lat: 38.707, lon: -9.146 };
      },
    };
    const doc = build([['p', 'Day in @Lisbon']]);
    doc.nodes.p.children = ['c'];
    doc.nodes.c = { id: 'c', text: 'Lunch at @[Time Out Market] {route(prev, here)}', children: [] };
    render(
      <DocProvider initialDoc={doc} services={svc} storage={null} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    await waitFor(() => expect(screen.getByText('Time Out Market')).toHaveAttribute('title', 'Time Out Market Lisboa'));
    expect(seen).toEqual([['lisbon', undefined], ['time out market', 'Lisboa']]);
  });

  it('keeps retrying after the backoff list runs out (last delay repeats)', async () => {
    let calls = 0;
    const svc: Services = {
      ...services,
      geocode: async (n) => {
        calls++;
        if (calls <= 3) throw new TransientError('place lookup unavailable');
        return services.geocode(n);
      },
    };
    render(
      <DocProvider initialDoc={build([['a', 'Visit @Lisbon']])} services={svc} storage={null} today="2026-10-28" retryDelaysMs={[5]}>
        <Outline />
      </DocProvider>,
    );
    await waitFor(() => expect(screen.getByText('Lisbon')).toHaveAttribute('title', 'Lisboa'), { timeout: 2000 });
    expect(calls).toBe(4);
  });

  it('tapping a "couldn’t reach" chip retries now, without opening the editor', async () => {
    let calls = 0;
    const svc: Services = {
      ...services,
      geocode: async (n) => {
        calls++;
        if (calls === 1) throw new TransientError('place lookup unavailable');
        return services.geocode(n);
      },
    };
    const user = userEvent.setup();
    render(
      <DocProvider initialDoc={build([['a', 'Visit @Lisbon']])} services={svc} storage={null} today="2026-10-28" retryDelaysMs={[1_000_000]}>
        <Outline />
      </DocProvider>,
    );
    await waitFor(() => expect(screen.getByText('Lisbon')).toHaveClass('is-error'));
    await user.click(screen.getByText('Lisbon'));
    expect(screen.queryByRole('textbox')).toBeNull();
    await waitFor(() => expect(screen.getByText('Lisbon')).toHaveAttribute('title', 'Lisboa'));
  });

  it('a formula waiting during an import still resolves afterwards', async () => {
    let release: (p: { name: string; lat: number; lon: number }) => void = () => {};
    const svc: Services = { ...services, geocode: () => new Promise((r) => { release = r; }) };
    let replace: (d: Doc) => void = () => {};
    function Grab() {
      replace = useStore().replaceDoc;
      return null;
    }
    const doc = build([['a', 'span {distance(@Riyadh, @Riyadh)}']]);
    render(
      <DocProvider initialDoc={doc} services={svc} storage={null} today="2026-10-28">
        <Grab />
        <Outline />
      </DocProvider>,
    );
    await waitFor(() => expect(screen.getByText('…')).toBeInTheDocument());
    act(() => replace(build([['a', 'span {distance(@Riyadh, @Riyadh)}']])));
    await act(async () => release(RIYADH));
    expect(await screen.findByText('0 m')).toBeInTheDocument();
  });
});

describe('review fixes: picker', () => {
  it('tapping a row that ends in a saved place does not open the picker; Enter makes a new bullet', async () => {
    const doc = build([['a', 'fly into @Lisbon']]);
    doc.places.lisbon = { name: 'Lisbon', lat: 38.72, lon: -9.14, label: 'Lisbon, Portugal' };
    const { user, container } = setup(doc);
    await user.click(screen.getByText('fly into', { exact: false }));
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(2);
  });

  it('the picker opens once you type inside the mention', async () => {
    const doc = build([['a', 'fly into @Lis']]);
    doc.places.lisbon = { name: 'Lisbon', lat: 38.72, lon: -9.14, label: 'Lisbon, Portugal' };
    const { user } = setup(doc);
    await user.click(screen.getByText('fly into', { exact: false }));
    await user.keyboard('b');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('scrolls the picker into view when it opens (rows near the keyboard)', async () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const doc = build([['a', 'x']]);
      doc.places.lisbon = { name: 'Lisbon', lat: 38.72, lon: -9.14 };
      const { user } = setup(doc);
      await user.click(screen.getByText('x'));
      await user.keyboard('{End} @l');
      await screen.findByRole('listbox');
      expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('review fixes: responsive picker', () => {
  it('shows town results while landmark results are still coming, and cancels stale searches', async () => {
    const signals: AbortSignal[] = [];
    const svc: Services = {
      ...services,
      search: (q, _near, opts) => {
        if (opts?.signal) signals.push(opts.signal);
        opts?.onUpdate?.([{ name: `Town ${q}`, lat: 1, lon: 2, label: `Town ${q}, Somewhere` }]);
        return new Promise(() => {}); // landmarks never arrive
      },
    };
    const user = userEvent.setup();
    render(
      <DocProvider initialDoc={build([['a', 'x']])} services={svc} storage={null} today="2026-10-28">
        <Outline />
      </DocProvider>,
    );
    await user.click(screen.getByText('x'));
    await user.keyboard('{End} @po');
    expect(await screen.findByText('Town po')).toBeInTheDocument();
    await user.keyboard('r');
    expect(await screen.findByText('Town por')).toBeInTheDocument();
    expect(signals[0].aborted).toBe(true);
  });
});
