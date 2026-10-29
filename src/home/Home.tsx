import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { dayNumber, type ISODate } from '../context/resolve';
import { navigate } from '../app/router';
import { useLibrary } from '../library/LibraryProvider';
import { homeSections } from '../library/sections';
import type { NoteMeta } from '../library/types';
import { useCardMenu } from './cardActions';
import { HomeMenu, SAMPLE_TITLE } from './HomeMenu';
import { NoteCard } from './NoteCard';
import { PinnedRow } from './PinnedRow';
import { Timeline } from './Timeline';
import { UndoBar } from './UndoBar';
import './home.css';
import './screens.css';

const WIDE = '(min-width: 640px)';

/** Wide screens put New note in the header; phones get the thumb-reach button. Only one exists at a time. */
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.(WIDE);
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    () => window.matchMedia?.(WIDE).matches ?? false,
  );
}

export function useCreateNote(): () => void {
  const { library, refresh } = useLibrary();
  return useCallback(() => {
    let id: string;
    try {
      id = library.create().id;
    } catch (e) {
      console.warn('LiveNotes: could not create a note', e);
      alert('Could not create a note: storage is full or unavailable.');
      return;
    }
    refresh();
    navigate(`#/note/${encodeURIComponent(id)}`);
  }, [library, refresh]);
}

export function Home() {
  const { metas, today } = useLibrary();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const wide = useWide();
  const create = useCreateNote();
  const menuFor = useCardMenu();
  const s = useMemo(() => homeSections(metas, today, query), [metas, today, query]);

  const live = metas.filter((m) => m.deletedAt === undefined);
  const searching = s.results !== undefined;
  const empty = !searching && s.pinned.length + s.upcoming.length + s.recent.length === 0;
  const onlySample = live.length === 1 && live[0].summary.title === SAMPLE_TITLE;

  const clear = () => {
    setQuery('');
    search.current?.focus();
  };

  return (
    <main data-screen="home" className="screen home">
      <header className="topbar home-header">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ✦
          </span>
          <h1>LiveNotes</h1>
        </div>
        <div className="home-header__search">
          <input
            ref={search}
            type="search"
            className="home-search"
            aria-label="Search notes"
            placeholder="Search notes"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="home-header__actions">
          {wide && (
            <button type="button" className="new-note-btn" aria-label="New note" onClick={create}>
              <span aria-hidden="true">+</span> New note
            </button>
          )}
          <HomeMenu />
        </div>
      </header>

      <div className="screen__body">
        {onlySample && !searching && (
          <p className="hint-card">
            <span className="hint-card__mark" aria-hidden="true">
              ✦
            </span>
            Tap + to start a note. Type @ for places, dates like Nov 3.
          </p>
        )}

        {searching ? (
          <Results results={s.results!} query={query.trim()} today={today} menuFor={menuFor} onClear={clear} />
        ) : empty ? (
          <div className="empty-state">
            <h2 className="empty-state__title">No notes yet</h2>
            <p className="empty-state__text">Plans with dates and places rise to the top on their own.</p>
            <button type="button" className="new-note-btn" onClick={create}>
              <span aria-hidden="true">+</span> New note
            </button>
          </div>
        ) : (
          <>
            <PinnedRow metas={s.pinned} today={today} />
            <Timeline upcoming={s.upcoming} today={today} menuFor={menuFor} />
            {s.recent.length > 0 && (
              <section className="home-recent" aria-labelledby="home-recent-head">
                <h2 className="section-head" id="home-recent-head">
                  Recent
                </h2>
                <CardList notes={s.recent} today={today} menuFor={menuFor} />
              </section>
            )}
          </>
        )}

        {s.archivedCount > 0 && (
          <footer className="home-footer">
            <a className="home-footer__link" href="#/archive">
              Archive ({s.archivedCount})
            </a>
          </footer>
        )}
      </div>

      {!wide && !empty && (
        <button type="button" className="fab" aria-label="New note" onClick={create}>
          <span aria-hidden="true">+</span>
        </button>
      )}
    </main>
  );
}

interface ListProps {
  notes: NoteMeta[];
  today: ISODate;
  menuFor(meta: NoteMeta): ReactNode;
}

/** Recent-style cards; a result that is still ahead keeps its timeline look so the date leads. */
export function CardList({ notes, today, menuFor }: ListProps) {
  return (
    <ul className="card-list">
      {notes.map((m) => (
        <li key={m.id}>
          <NoteCard meta={m} variant={isAhead(m, today) ? 'timeline' : 'recent'} today={today} menu={menuFor(m)} />
        </li>
      ))}
    </ul>
  );
}

const isAhead = (m: NoteMeta, today: ISODate) => {
  const end = m.summary.to ?? m.summary.from;
  return !!end && dayNumber(end) >= dayNumber(today);
};

function Results({
  results,
  query,
  today,
  menuFor,
  onClear,
}: Omit<ListProps, 'notes'> & { results: NoteMeta[]; query: string; onClear(): void }) {
  if (results.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__text" role="status">
          No notes match "{query}"
        </p>
        <button type="button" className="text-btn" onClick={onClear}>
          Clear
        </button>
      </div>
    );
  }
  return (
    <section aria-labelledby="home-results-head">
      <h2 className="section-head" id="home-results-head">
        {results.length === 1 ? '1 note' : `${results.length} notes`}
      </h2>
      <CardList notes={results} today={today} menuFor={menuFor} />
    </section>
  );
}

/** The undo bar for Home and Archive, mounted once above both so switching between them keeps its countdown. */
export function PendingUndo() {
  const { pendingDelete, undoDelete, expireDelete } = useLibrary();
  if (pendingDelete === null) return null;
  // Keyed by note, so a second delete starts a fresh window.
  return <UndoBar key={pendingDelete} onUndo={undoDelete} onExpire={expireDelete} />;
}
