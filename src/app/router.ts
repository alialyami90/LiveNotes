import { useMemo, useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'archive' } | { name: 'note'; id: string };

export function parseHash(hash: string): Route {
  if (hash === '#/archive') return { name: 'archive' };
  const note = /^#\/note\/([^/]+)$/.exec(hash);
  if (note) {
    try {
      return { name: 'note', id: decodeURIComponent(note[1]) };
    } catch {
      return { name: 'home' };
    }
  }
  return { name: 'home' };
}

/**
 * How many in-app entries sit behind the current one. navigate() bumps it, and it
 * is also stamped on each history entry, so the system back button, link clicks
 * and reloads (which keep history.state) leave it right instead of drifting.
 */
let depth = 0;
const STAMP = 'livenotesDepth';

const currentState = (): Record<string, unknown> => {
  const s: unknown = history.state;
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
};

const stampOf = (): number | undefined => {
  const v = currentState()[STAMP];
  return typeof v === 'number' ? v : undefined;
};

const stamp = (n: number) => {
  depth = n;
  history.replaceState({ ...currentState(), [STAMP]: n }, '');
};

if (typeof window !== 'undefined') {
  stamp(stampOf() ?? 0);
  // An unstamped entry is new (a link click or a typed hash), so it sits one above where we came from.
  window.addEventListener('hashchange', () => stamp(stampOf() ?? depth + 1));
}

export function navigate(to: string): void {
  if (location.hash === to) return;
  const from = depth;
  location.hash = to;
  stamp(from + 1);
}

/** Android's back gesture already walks history; the in-app arrow should do the same when it can. */
export function goBack(): void {
  if (depth > 0 && history.length > 1) history.back();
  else navigate('#/');
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return useMemo(() => parseHash(hash), [hash]);
}
