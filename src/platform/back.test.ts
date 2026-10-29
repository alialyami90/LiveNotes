import { describe, expect, it, vi } from 'vitest';
import { handleBack, installBackButton, type BackDeps } from './back';

function fake({ native = true, hash = '#/' }: { native?: boolean; hash?: string } = {}) {
  const calls: string[] = [];
  let listener: ((e: { canGoBack: boolean }) => void) | null = null;
  const deps: BackDeps = {
    isNative: () => native,
    addBackListener: (fn) => {
      listener = fn;
    },
    exitApp: () => void calls.push('exit'),
    hash: () => hash,
    goBack: (opts) => void calls.push(`goBack:${opts.historyAvailable}`),
  };
  const press = (canGoBack: boolean) => listener?.({ canGoBack });
  return { deps, calls, press, listening: () => listener !== null };
}

describe('Android back button', () => {
  it('does nothing on the web, where the browser owns back', () => {
    const f = fake({ native: false });
    expect(installBackButton(f.deps)).toBe(false);
    expect(f.listening()).toBe(false);
  });

  it('from a note goes back through the router', () => {
    const f = fake({ hash: '#/note/abc' });
    installBackButton(f.deps);
    f.press(true);
    expect(f.calls).toEqual(['goBack:true']);
  });

  it('from the archive goes back through the router', () => {
    const f = fake({ hash: '#/archive' });
    installBackButton(f.deps);
    f.press(true);
    expect(f.calls).toEqual(['goBack:true']);
  });

  it('tells the router when the WebView has no history, so it replaces with home instead of a dead history.back()', () => {
    const f = fake({ hash: '#/note/abc' });
    installBackButton(f.deps);
    f.press(false);
    expect(f.calls).toEqual(['goBack:false']);
  });

  it('from home exits, even with history behind it', () => {
    for (const can of [true, false]) {
      const f = fake({ hash: '#/' });
      handleBack(can, f.deps);
      expect(f.calls).toEqual(['exit']);
    }
  });

  it('treats an unknown hash as home', () => {
    const f = fake({ hash: '#/nowhere' });
    handleBack(true, f.deps);
    expect(f.calls).toEqual(['exit']);
  });

  it('installs one listener', () => {
    const f = fake();
    const add = vi.spyOn(f.deps, 'addBackListener');
    expect(installBackButton(f.deps)).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
  });
});
