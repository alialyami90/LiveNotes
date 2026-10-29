import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { goBack, parseHash } from '../app/router';

export interface BackDeps {
  isNative(): boolean;
  addBackListener(fn: (e: { canGoBack: boolean }) => void): void;
  exitApp(): void;
  hash(): string;
  goBack(opts: { historyAvailable: boolean }): void;
}

const capacitorDeps: BackDeps = {
  isNative: () => Capacitor.isNativePlatform(),
  addBackListener: (fn) => void App.addListener('backButton', fn),
  exitApp: () => void App.exitApp(),
  hash: () => location.hash,
  goBack,
};

/**
 * Spec §3: note → home, then exit. Home is the bottom of the app, so it exits even if
 * history sits behind it (e.g. a forward entry redirected in place). Anywhere else the
 * router decides, since only it knows whether the entry behind is in-app.
 */
export function handleBack(canGoBack: boolean, deps: BackDeps): void {
  if (parseHash(deps.hash()).name === 'home') deps.exitApp();
  else deps.goBack({ historyAvailable: canGoBack });
}

let installed = false;

/**
 * Without a listener Capacitor lets Android finish the activity on back, so the app
 * would close from a note. The web keeps the browser's own back.
 */
export function installBackButton(deps: BackDeps = capacitorDeps): boolean {
  if (!deps.isNative()) return false;
  if (deps === capacitorDeps) {
    if (installed) return true;
    installed = true;
  }
  deps.addBackListener(({ canGoBack }) => handleBack(canGoBack, deps));
  return true;
}
