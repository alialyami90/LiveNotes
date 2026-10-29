import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { parseImport } from '../model/storage';
import { sampleDoc } from '../model/sample';
import { exportDocument } from '../platform/export';
import { useStore } from './store';
import { Outline } from './Outline';
import { MobileToolbar } from './MobileToolbar';

export function App() {
  const { doc, replaceDoc } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const imported = parseImport(await file.text());
    if (imported) replaceDoc(imported);
    else alert('That file is not a LiveNotes document.');
  };

  return (
    <div className="app">
      <header className="topbar" ref={headerRef}>
        <div className="brand">
          <span className="logo" aria-hidden>
            ✦
          </span>
          <div>
            <h1>LiveNotes</h1>
            <p>Dynamic documents for making plans</p>
          </div>
        </div>
        <button
          type="button"
          className="menu-toggle"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ⋯
        </button>
        <nav className={`actions${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)}>
          <button
            type="button"
            onClick={() =>
              exportDocument(JSON.stringify(doc, null, 2)).catch((e: unknown) =>
                alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`),
              )
            }
          >
            Export
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button
            type="button"
            onClick={() => confirm('Replace this document with the sample trip?') && replaceDoc(sampleDoc())}
          >
            Reset to sample
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
        </nav>
      </header>
      <main className="page">
        <Outline />
        <footer className="legend">
          <span><code>@Place</code> or <code>@[Two Words]</code> mentions a place</span>
          <span><code>Nov 3</code> mentions a date</span>
          <span><code>{'{weather()}'}</code> <code>{'{route(prev, here)}'}</code> formulas</span>
          <span><code>/map</code> <code>/calendar</code> <code>/table</code> + Enter adds a view</span>
        </footer>
      </main>
      <MobileToolbar />
    </div>
  );
}
