import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { goBack, navigate, parseHash, useRoute } from './router';

describe('parseHash', () => {
  it('maps the known routes', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/archive')).toEqual({ name: 'archive' });
    expect(parseHash('#/note/abc-123')).toEqual({ name: 'note', id: 'abc-123' });
  });

  it('maps anything unknown to home', () => {
    expect(parseHash('#/elsewhere')).toEqual({ name: 'home' });
    expect(parseHash('#/note/')).toEqual({ name: 'home' });
    expect(parseHash('#/note/a/b')).toEqual({ name: 'home' });
  });
});

function Show() {
  const r = useRoute();
  return <p>{r.name === 'note' ? `note ${r.id}` : r.name}</p>;
}

describe('useRoute and navigation', () => {
  beforeEach(() => history.replaceState(null, '', '#/'));
  afterEach(() => vi.restoreAllMocks());

  it('follows hashchange', async () => {
    render(<Show />);
    expect(screen.getByText('home')).toBeInTheDocument();
    act(() => navigate('#/note/x'));
    expect(await screen.findByText('note x')).toBeInTheDocument();
    act(() => navigate('#/archive'));
    expect(await screen.findByText('archive')).toBeInTheDocument();
  });

  it('goBack uses history after in-app navigation', async () => {
    render(<Show />);
    act(() => navigate('#/note/y'));
    await screen.findByText('note y');
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    act(() => goBack());
    expect(back).toHaveBeenCalled();
  });

  it('goBack follows a link click, which never went through navigate', async () => {
    render(<Show />);
    act(() => {
      location.hash = '#/note/linked';
    });
    await screen.findByText('note linked');
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    act(() => goBack());
    expect(back).toHaveBeenCalled();
  });

  it('goBack goes home when the note was opened directly', async () => {
    // A deep link or reload: a fresh module and an entry with no in-app history behind it.
    history.replaceState(null, '', '#/note/z');
    vi.resetModules();
    const fresh = await import('./router');
    render(<Show />);
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    act(() => fresh.goBack());
    expect(back).not.toHaveBeenCalled();
    await waitFor(() => expect(location.hash).toBe('#/'));
  });
});
