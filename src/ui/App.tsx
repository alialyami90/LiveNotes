import { useRef, type ChangeEvent } from 'react';
import { parseImport } from '../model/storage';
import { sampleDoc } from '../model/sample';
import { useStore } from './store';
import { Outline } from './Outline';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const { doc, replaceDoc } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

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
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ✦
          </span>
          <div>
            <h1>LiveNotes</h1>
            <p>Dynamic documents for making plans</p>
          </div>
        </div>
        <nav className="actions">
          <button type="button" onClick={() => download('livenotes.json', JSON.stringify(doc, null, 2))}>
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
    </div>
  );
}
