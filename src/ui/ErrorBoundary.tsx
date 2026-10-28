import { Component, type ErrorInfo, type ReactNode } from 'react';
import { safeStorage, saveDoc, STORAGE_KEY } from '../model/storage';
import { sampleDoc } from '../model/sample';

interface State {
  error: Error | null;
}

/** A crash shouldn't leave a blank page with the user's notes unreachable. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LiveNotes crashed', error, info.componentStack);
  }

  private downloadRaw = () => {
    const raw = safeStorage()?.getItem(STORAGE_KEY) ?? '';
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'livenotes-backup.json' }).click();
    URL.revokeObjectURL(url);
  };

  private reset = () => {
    if (!confirm('Replace the saved document with the sample? Download a backup first if you need it.')) return;
    const storage = safeStorage();
    if (storage) saveDoc(storage, sampleDoc());
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <div className="actions">
          <button type="button" onClick={this.downloadRaw}>
            Download saved data
          </button>
          <button type="button" onClick={this.reset}>
            Reset to sample
          </button>
        </div>
      </div>
    );
  }
}
