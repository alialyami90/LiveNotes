import { Component, type ErrorInfo, type ReactNode } from 'react';
import { safeStorage } from '../model/storage';
import { exportDocument } from '../platform/export';

interface Props {
  children: ReactNode;
  /** Injected by tests, since jsdom cannot reload. */
  reload?: () => void;
}

interface State {
  error: Error | null;
}

/** Raw strings, not parsed docs: the crash may have come from data that does not parse. */
function libraryBackup(): string {
  const out: Record<string, string> = {};
  const storage = safeStorage();
  try {
    for (let i = 0; storage && i < storage.length; i++) {
      const k = storage.key(i);
      const v = k?.startsWith('livenotes:') ? storage.getItem(k) : null;
      if (k && v !== null) out[k] = v;
    }
  } catch {
    // whatever was read so far is still worth saving
  }
  return JSON.stringify(out, null, 2);
}

/** A crash shouldn't leave a blank page with the user's notes unreachable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LiveNotes crashed', error, info.componentStack);
  }

  private download = () => {
    exportDocument(libraryBackup(), { name: 'livenotes-backup.json' }).catch((e: unknown) =>
      alert(`Backup failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  };

  /**
   * The library is the user's notes, so recovery only leaves the screen that crashed.
   * Replacing the entry keeps back from returning to that screen.
   */
  private backToNotes = () => {
    location.replace('#/');
    (this.props.reload ?? (() => location.reload()))();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <div className="crash-actions">
          <button type="button" onClick={this.download}>
            Download saved data
          </button>
          <button type="button" onClick={this.backToNotes}>
            Back to notes
          </button>
        </div>
      </div>
    );
  }
}
