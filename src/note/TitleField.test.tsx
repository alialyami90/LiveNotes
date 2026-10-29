import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode } from '../model/types';
import type { Services } from '../services/types';
import { DocProvider, useStore } from '../ui/store';
import { Outline } from '../ui/Outline';
import { TitleField } from './TitleField';

function build(items: [string, string][], title?: string): Doc {
  const nodes: Record<string, OutlineNode> = { root: { id: 'root', text: '', children: items.map(([id]) => id) } };
  for (const [id, text] of items) nodes[id] = { id, text, children: [] };
  return { version: 1, rootId: 'root', nodes, places: {}, ...(title === undefined ? {} : { title }) };
}

const services: Services = {
  search: async () => [],
  geocode: async () => null,
  weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
  route: async () => ({ seconds: 3600, meters: 100000 }),
};

/** Exposes the stored title, so tests assert on the document rather than the DOM value. */
function Probe() {
  const { doc } = useStore();
  return <output data-testid="stored-title">{JSON.stringify(doc.title ?? null)}</output>;
}

function setup(doc: Doc, autoFocus?: boolean) {
  const user = userEvent.setup();
  const utils = render(
    <DocProvider initialDoc={doc} services={services} storage={null} today="2026-10-28">
      <TitleField autoFocus={autoFocus} />
      <Outline />
      <Probe />
    </DocProvider>,
  );
  return { user, ...utils };
}

const title = () => screen.getByRole('textbox', { name: 'Title' });
const stored = () => screen.getByTestId('stored-title').textContent;

describe('TitleField', () => {
  it('takes focus on mount with autoFocus, caret at the end', () => {
    setup(build([['a', 'hello']], 'Trip'), true);
    expect(title()).toHaveFocus();
    expect((title() as HTMLTextAreaElement).selectionStart).toBe(4);
  });

  it('is not focused without autoFocus', () => {
    setup(build([['a', 'hello']], 'Trip'));
    expect(title()).not.toHaveFocus();
  });

  it('typing updates doc.title', async () => {
    const { user } = setup(build([['a', 'hello']], ''), true);
    await user.keyboard('Weekend');
    expect(title()).toHaveValue('Weekend');
    expect(stored()).toBe('"Weekend"');
  });

  it('Enter focuses the first bullet editor and adds no newline to the title', async () => {
    const { user, container } = setup(build([['a', 'hello'], ['b', 'world']]), true);
    await user.keyboard('Weekend{Enter}');
    expect(title()).toHaveValue('Weekend');
    expect(stored()).toBe('"Weekend"');
    const editor = container.querySelector('li[data-node-id="a"] textarea') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(0);
  });

  it('Enter on an empty outline creates a bullet and focuses it', async () => {
    const { user, container } = setup(build([]), true);
    await user.keyboard('Weekend{Enter}');
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(1);
    const editor = container.querySelector('li[data-node-id] textarea');
    expect(editor).toHaveFocus();
    expect(title()).toHaveValue('Weekend');
  });

  it('ignores Enter while an IME composition is active', () => {
    const { container } = setup(build([]), true);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    act(() => {
      title().dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(title()).toHaveFocus();
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(0);
  });

  it('strips newlines from pasted text', async () => {
    const { user } = setup(build([['a', 'hello']], ''), true);
    await user.paste('Long\nweekend\r\naway');
    expect(title()).toHaveValue('Long weekend away');
    expect(stored()).toBe('"Long weekend away"');
  });

  it('shows an empty field with the placeholder for a doc without a title', () => {
    setup(build([['a', 'hello']]));
    expect(title()).toHaveValue('');
    expect(title()).toHaveAttribute('placeholder', 'Title');
    expect(stored()).toBe('null');
  });
});
