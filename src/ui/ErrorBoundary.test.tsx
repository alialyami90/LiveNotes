import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { exportDocument } from '../platform/export';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../platform/export', () => ({ exportDocument: vi.fn(async () => {}) }));

const Boom = () => {
  throw new Error('kaboom');
};

function crash(reload = vi.fn()) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ErrorBoundary reload={reload}>
      <Boom />
    </ErrorBoundary>,
  );
  return reload;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page', () => {
    crash();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download saved data/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset to sample/i })).toBeNull();
  });

  it('backs up every livenotes key in one file', async () => {
    localStorage.setItem('livenotes:index:v1', '{"version":1,"notes":[]}');
    localStorage.setItem('livenotes:note:A', '{"broken"');
    localStorage.setItem('unrelated', 'x');
    crash();
    await userEvent.click(screen.getByRole('button', { name: /download saved data/i }));
    await waitFor(() => expect(exportDocument).toHaveBeenCalled());
    const [json, , name] = vi.mocked(exportDocument).mock.calls[0];
    expect(JSON.parse(json)).toEqual({
      'livenotes:index:v1': '{"version":1,"notes":[]}',
      'livenotes:note:A': '{"broken"',
    });
    expect(name).toBe('livenotes-backup.json');
  });

  it('"Back to notes" goes home and reloads, leaving the library alone', async () => {
    localStorage.setItem('livenotes:note:A', 'keep');
    history.replaceState(null, '', '#/note/A');
    const reload = crash();
    await userEvent.click(screen.getByRole('button', { name: /back to notes/i }));
    expect(location.hash).toBe('#/');
    expect(reload).toHaveBeenCalled();
    expect(localStorage.getItem('livenotes:note:A')).toBe('keep');
  });
});
