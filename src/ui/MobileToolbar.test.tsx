import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode } from '../model/types';
import type { Services } from '../services/types';
import { DocProvider } from './store';
import { Outline } from './Outline';
import { MobileToolbar } from './MobileToolbar';

function build(items: [string, string][]): Doc {
  const nodes: Record<string, OutlineNode> = { root: { id: 'root', text: '', children: items.map(([id]) => id) } };
  for (const [id, text] of items) nodes[id] = { id, text, children: [] };
  return { version: 1, rootId: 'root', nodes, places: {} };
}

const services: Services = {
  geocode: async () => null,
  weather: async () => ({ code: 0, condition: '', icon: '', high: 0, low: 0 }),
  route: async () => ({ seconds: 0, meters: 0 }),
};

function setup(doc: Doc) {
  const user = userEvent.setup();
  const utils = render(
    <DocProvider initialDoc={doc} services={services} storage={null} today="2026-10-28">
      <Outline />
      <MobileToolbar forceVisible />
    </DocProvider>,
  );
  return { user, ...utils };
}

describe('MobileToolbar', () => {
  it('is hidden while no row is being edited', () => {
    setup(build([['a', 'first']]));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('indents the focused row and keeps editing it', async () => {
    const { user, container } = setup(build([['a', 'first'], ['b', 'second']]));
    await user.click(screen.getByText('second'));
    await user.click(screen.getByRole('button', { name: 'Indent' }));
    expect(container.querySelector('li[data-node-id="a"] li[data-node-id="b"]')).not.toBeNull();
    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue('second');
    expect(editor).toHaveFocus();
  });

  it('outdents and moves rows', async () => {
    const { user, container } = setup(build([['a', 'first'], ['b', 'second']]));
    await user.click(screen.getByText('second'));
    await user.click(screen.getByRole('button', { name: 'Move up' }));
    expect([...container.querySelectorAll('li[data-node-id]')].map((li) => li.getAttribute('data-node-id'))).toEqual(['b', 'a']);
    await user.click(screen.getByRole('button', { name: 'Indent' }));
    expect(container.querySelector('li[data-node-id="b"] li[data-node-id]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Move down' }));
    await user.click(screen.getByRole('button', { name: 'Indent' }));
    await user.click(screen.getByRole('button', { name: 'Outdent' }));
    expect(container.querySelector('li[data-node-id="a"] li[data-node-id="b"]')).toBeNull();
  });

  it('does not take focus away from the editor (keyboard stays up)', async () => {
    const { user } = setup(build([['a', 'first']]));
    await user.click(screen.getByText('first'));
    const button = screen.getByRole('button', { name: 'Indent' });
    expect(fireEvent.mouseDown(button)).toBe(false);
    expect(fireEvent.pointerDown(button)).toBe(false);
  });

  it('keeps the caret where it was after an action', async () => {
    const { user } = setup(build([['a', 'first'], ['b', 'second']]));
    await user.click(screen.getByText('second'));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.setSelectionRange(3, 3);
    await user.click(screen.getByRole('button', { name: 'Indent' }));
    const after = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(after.selectionStart).toBe(3);
  });

  it('deletes the focused bullet and edits the previous one', async () => {
    const { user, container } = setup(build([['a', 'first'], ['b', 'second']]));
    await user.click(screen.getByText('second'));
    await user.click(screen.getByRole('button', { name: 'Delete bullet' }));
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('first');
  });
});
