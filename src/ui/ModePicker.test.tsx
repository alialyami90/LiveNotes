import { describe, expect, it } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, OutlineNode } from '../model/types';
import type { Services } from '../services/types';
import { DocProvider } from './store';
import { Outline } from './Outline';

const PORTO = { name: 'Porto', lat: 41.15, lon: -8.61, label: 'Porto, Portugal' };
const LISBON = { name: 'Lisbon', lat: 38.72, lon: -9.14, label: 'Lisbon, Portugal' };

function build(items: [string, string][]): Doc {
  const nodes: Record<string, OutlineNode> = { root: { id: 'root', text: '', children: items.map(([id]) => id) } };
  for (const [id, text] of items) nodes[id] = { id, text, children: [] };
  return { version: 1, rootId: 'root', nodes, places: { porto: PORTO, lisbon: LISBON } };
}

const services: Services = {
  search: async () => [],
  geocode: async () => null,
  weather: async () => ({ code: 0, condition: 'Clear', icon: '☀️', high: 20, low: 10 }),
  route: async () => ({ seconds: 3600, meters: 100000 }),
};

function setup(text = 'go') {
  const user = userEvent.setup();
  const utils = render(
    <DocProvider initialDoc={build([['a', text]])} services={services} storage={null} today="2026-10-28">
      <Outline />
    </DocProvider>,
  );
  return { user, ...utils };
}

async function edit(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await user.click(container.querySelector('li[data-node-id="a"] .rich')!);
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

const popup = () => screen.queryByRole('listbox', { name: 'Travel mode' });

describe('travel-mode popup', () => {
  it('opens after "to @place" and a space, with the five modes in order', async () => {
    const { user, container } = setup();
    await edit(user, container);
    await user.keyboard('{End} to @porto ');
    const list = popup();
    expect(list).not.toBeNull();
    const names = Array.from(list!.querySelectorAll('[role="option"]')).map((o) => o.textContent?.replace(/^\P{L}+/u, ''));
    expect(names).toEqual(['Drive', 'Walk', 'Public transport', 'Bike', 'Fly']);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAccessibleName('Drive');
    expect(options[2]).toHaveAccessibleName('Public transport');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowDown then Enter inserts the mode word and keeps the caret after the mention', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(editor).toHaveValue('go walk to @porto ');
    expect(editor.selectionStart).toBe(18);
    expect(popup()).toBeNull();
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(1);
  });

  it('Tab chooses the highlighted mode instead of indenting', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    await user.keyboard('{Tab}');
    expect(editor).toHaveValue('go drive to @porto ');
    expect(editor).toHaveFocus();
  });

  it('opens after a pick from the place picker, and is never in the DOM with it', async () => {
    const { user, container } = setup();
    let both = false;
    const observer = new MutationObserver(() => {
      if (container.querySelector('[aria-label="Places"]') && container.querySelector('[aria-label="Travel mode"]')) both = true;
    });
    observer.observe(container, { childList: true, subtree: true });
    try {
      const editor = await edit(user, container);
      await user.keyboard('{End} to @por');
      const places = await screen.findByRole('listbox', { name: 'Places' });
      expect(popup()).toBeNull();
      await user.click(places.querySelector('[role="option"]')!);
      expect(editor).toHaveValue('go to @Porto ');
      expect(screen.queryByRole('listbox', { name: 'Places' })).toBeNull();
      expect(popup()).not.toBeNull();
      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
      expect(editor).toHaveValue('go transit to @Porto ');
      expect(both).toBe(false);
    } finally {
      observer.disconnect();
    }
  });

  it('does not open for "next to"', async () => {
    const { user, container } = setup();
    await edit(user, container);
    await user.keyboard('{End} next to @porto ');
    expect(popup()).toBeNull();
  });

  it('does not open for punctuation that continues the name (@Porto-Novo)', async () => {
    const { user, container } = setup();
    await edit(user, container);
    await user.keyboard('{End} to @porto-');
    // let the place search settle, so the place picker no longer hides it
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole('listbox', { name: 'Places' })).toBeNull();
    expect(popup()).toBeNull();
  });

  it('does not open while merely typing letters', async () => {
    const { user, container } = setup('go to @port');
    await edit(user, container);
    await user.keyboard('{End}o');
    expect(popup()).toBeNull();
  });

  it('Escape closes it, keeps the text and the focus, and the phrase stays dismissed', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    await user.keyboard('{Escape}');
    expect(popup()).toBeNull();
    expect(editor).toHaveValue('go to @porto ');
    expect(editor).toHaveFocus();
    await user.keyboard('x{Backspace} ');
    expect(popup()).toBeNull();
    // deleting back into the mention and retyping the space is still the same phrase
    await user.keyboard('{Backspace}{Backspace} ');
    expect(editor).toHaveValue('go to @porto ');
    expect(popup()).toBeNull();
    // a different mention is a different phrase
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}lisbon ');
    expect(editor).toHaveValue('go to @lisbon ');
    expect(popup()).not.toBeNull();
  });

  it('a second Escape leaves the row', async () => {
    const { user, container } = setup();
    await edit(user, container);
    await user.keyboard('{End} to @porto {Escape}');
    expect(screen.getByRole('textbox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('any other key closes it and goes through', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    await user.keyboard('{ArrowLeft}');
    expect(popup()).toBeNull();
    expect(editor.selectionStart).toBe(12);
  });

  it('rows keep the editor focused: pointerdown is prevented, and a click inserts the mode', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    const fly = screen.getByRole('option', { name: 'Fly' });
    const down = createEvent.pointerDown(fly);
    fireEvent(fly, down);
    expect(down.defaultPrevented).toBe(true);
    const mouse = createEvent.mouseDown(fly);
    fireEvent(fly, mouse);
    expect(mouse.defaultPrevented).toBe(true);
    await user.click(fly);
    expect(editor).toHaveValue('go fly to @porto ');
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(17);
    expect(popup()).toBeNull();
  });

  it('closes on any text change, as an Android keyboard sends it (keyCode 229)', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 });
    expect(popup()).not.toBeNull();
    expect(editor).toHaveValue('go to @porto ');
    fireEvent.change(editor, { target: { value: 'go to @porto a' } });
    expect(popup()).toBeNull();
    fireEvent.change(editor, { target: { value: 'go to @porto ' } });
    expect(popup()).toBeNull();
  });
});

describe('travel-mode popup: fix round 1', () => {
  it('closes when the caret is moved elsewhere, so Enter at the start inserts a bullet above', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    expect(popup()).not.toBeNull();
    editor.setSelectionRange(0, 0);
    fireEvent.select(editor);
    expect(popup()).toBeNull();
    await user.keyboard('{Enter}');
    expect(container.querySelectorAll('li[data-node-id]')).toHaveLength(2);
    expect(container.querySelector('li[data-node-id="a"]')?.textContent).toContain('go to ');
    expect(container.querySelector('li[data-node-id="a"]')?.textContent).not.toContain('drive');
  });

  it('closes when a range is selected from the phrase caret, and stays dismissed', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @porto ');
    editor.setSelectionRange(10, 13);
    fireEvent.select(editor);
    expect(popup()).toBeNull();
    editor.setSelectionRange(13, 13);
    fireEvent.select(editor);
    expect(popup()).toBeNull();
  });

  it('a hand-typed bracket mention opens it on the space after "]", not on the "]"', async () => {
    const { user, container } = setup();
    const editor = await edit(user, container);
    await user.keyboard('{End} to @[[Porto]');
    expect(editor).toHaveValue('go to @[Porto]');
    expect(popup()).toBeNull();
    await user.keyboard(' ');
    expect(popup()).not.toBeNull();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(editor).toHaveValue('go walk to @[Porto] ');
  });

  it('does not arm while an IME is composing', async () => {
    const { user, container } = setup('go to @porto');
    const editor = await edit(user, container);
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: 'go to @porto ' } });
    expect(popup()).toBeNull();
    fireEvent.compositionEnd(editor);
    // not dismissed, merely never armed: the same space typed outside composition opens it
    fireEvent.change(editor, { target: { value: 'go to @porto' } });
    fireEvent.change(editor, { target: { value: 'go to @porto ' } });
    expect(popup()).not.toBeNull();
  });
});

describe('phrase highlighting in the editor mirror', () => {
  it('colours mode and weather words, and draws exactly the textarea text', async () => {
    const { user, container } = setup('weather then drive to @porto');
    const editor = await edit(user, container);
    const mirror = container.querySelector('.editor-mirror')!;
    expect(mirror.querySelector('.hl-mode')?.textContent).toBe('drive');
    expect(mirror.querySelector('.hl-weather')?.textContent).toBe('weather');
    expect(mirror.querySelector('.hl-place')?.textContent).toBe('@porto');
    expect(mirror.textContent).toBe(editor.value + '​');
  });

  it('does not mark a mode word that is not part of a route', async () => {
    const { user, container } = setup('drive home');
    await edit(user, container);
    expect(container.querySelector('.editor-mirror .hl-mode')).toBeNull();
  });
});
