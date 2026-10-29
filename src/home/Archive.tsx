import { goBack } from '../app/router';
import { useLibrary } from '../library/LibraryProvider';
import { archivedNotes } from '../library/sections';
import { useCardMenu } from './cardActions';
import { CardList } from './Home';
import './home.css';
import './screens.css';

export function Archive() {
  const { metas, today } = useLibrary();
  const menuFor = useCardMenu();
  const notes = archivedNotes(metas);
  return (
    <main data-screen="archive" className="screen archive">
      <header className="topbar screen-header">
        <a
          className="back-link"
          href="#/"
          aria-label="Back"
          onClick={(e) => {
            e.preventDefault();
            goBack();
          }}
        >
          <span aria-hidden="true">←</span>
        </a>
        <h1 className="screen-header__title">Archive</h1>
      </header>
      <div className="screen__body">
        {notes.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__text">Nothing archived</p>
          </div>
        ) : (
          <CardList notes={notes} today={today} menuFor={menuFor} />
        )}
      </div>
    </main>
  );
}
