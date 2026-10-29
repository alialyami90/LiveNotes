import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { navigate } from '../app/router';
import { useLibrary } from '../library/LibraryProvider';
import { homeSections } from '../library/sections';
import { SAMPLE_TITLE } from '../library/storage';
import { useCardMenu } from './cardActions';
import { CardList } from './CardList';
import { HomeMenu } from './HomeMenu';
import { PinnedRow } from './PinnedRow';
import { Timeline } from './Timeline';
import './home.css';
import './home-screens.css';

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
  const { library, attempt } = useLibrary();
  return useCallback(() => {
    let id: string | undefined;
    if (!attempt('create a note', () => (id = library.create().id)) || !id) return;
    navigate(`#/note/${encodeURIComponent(id)}`);
  }, [library, attempt]);
}

export function Home() {
  const { metas, today } = useLibrary();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const wide = useWide();
  const create = useCreateNote();
  const menuFor = useCardMenu();
  const s = useMemo(() => homeSections(metas, today, query), [metas, today, query]);

  const active = metas.filter((m) => m.deletedAt === undefined && !m.archived);
  const results = s.results;
  const noMatch = results !== undefined && results.length === 0;
  const empty = results === undefined && active.length === 0;
  const onlySample = active.length === 1 && active[0].summary.title === SAMPLE_TITLE;

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
          <h1 tabIndex={-1}>LiveNotes</h1>
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
        {onlySample && results === undefined && (
          <p className="hint-card">
            <span className="hint-card__mark" aria-hidden="true">
              ✦
            </span>
            Tap + to start a note. Type @ for places, dates like Nov 3.
          </p>
        )}

        {/* Always mounted, so screen readers announce the message when it appears. */}
        <p className="home-status" role="status">
          {noMatch ? `No notes match "${query.trim()}"` : ''}
        </p>

        {noMatch ? (
          <div className="home-status__actions">
            <button type="button" className="text-btn" onClick={clear}>
              Clear
            </button>
          </div>
        ) : results ? (
          <section className="home-section" aria-labelledby="home-results-head">
            <h2 className="section-head" id="home-results-head">
              {results.length === 1 ? '1 note' : `${results.length} notes`}
            </h2>
            <CardList notes={results} today={today} menuFor={menuFor} />
          </section>
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
              <section className="home-section" aria-labelledby="home-recent-head">
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
