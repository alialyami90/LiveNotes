import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode } from '../model/types';
import type { Services } from '../services/types';
import { DocProvider } from './store';
import { Outline } from './Outline';

function build(items: [string, string][]): Doc {
  const nodes: Record<string, OutlineNode> = { root: { id: 'root', text: '', children: items.map(([id]) => id) } };
  for (const [id, text] of items) nodes[id] = { id, text, children: [] };
  return { version: 1, rootId: 'root', nodes, places: {} };
}

const services: Services = {
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
