# Notes Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn LiveNotes from a single note into a library of notes. It gets a
Timeline home page (upcoming plans on a date rail, recent cards, pinned,
archive, search, delete with undo), a note screen with a title, the remaining
review fixes, and a bolder version of the existing visual world.

**Architecture:**
- The library logic is pure TypeScript in `src/library/`: summaries, sections,
  sketch projection, and storage over an injected `Storage`.
- A `LibraryProvider` exposes the index and its actions.
- Hash routing chooses between the `Home` and `NoteScreen` screens.
- Each note is edited in its own `DocProvider`, keyed by note id and persisted
  to `livenotes:note:<id>`. Persistence is extracted from `store.tsx` into
  `usePersistence.ts`.

**Tech Stack:**
- React 19, TypeScript (strict), Vite 8, Vitest 5 and Testing Library
- Capacitor 8
- `@fontsource-variable/fraunces` and `@fontsource-variable/instrument-sans`
  (both 5.3.0)

**Spec:** `docs/superpowers/specs/2026-10-29-notes-library-design.md`
(the binding authority), plus `PRODUCT.md` and `CLAUDE.md`.

## Global Constraints

- **Storage keys:**
  - `livenotes:index:v1` holds `{ version: 1, notes: NoteMeta[] }`
  - `livenotes:note:<id>` holds each note's `Doc`
  - legacy `livenotes:doc:v1` is migrated, then removed after the first
    successful index write
- `Doc` gains an optional `title?: string` and stays `version: 1`.
- **Routes:** `#/` (home), `#/note/<id>` and `#/archive`.
- **Upcoming buckets:** Today · This week (through Sunday) · Next week · Later.
  The upcoming test is `to ≥ today`, sorted by `from`, and an ongoing plan
  counts as Today.
- Undo bar shows for **6 s** with the text `Note deleted` and an `Undo` button.
- Summary caps: `places` holds at most **8**, and `preview` is at most **140**
  characters.
- **Fonts:** Fraunces for titles, stamps and section heads; Instrument Sans for
  UI and body. Both are bundled, with no network fonts.
- **Motion:** 160 ms fade and 8 px rise between screens. None under
  `prefers-reduced-motion: reduce`.
- **Kept traits:** warm paper grounds, the orange accent, chip colours (blue
  places, purple dates, green formulas) and dark mode via
  `prefers-color-scheme`.
- **Touch targets:** at least 44 px on phones. No action may be reachable only
  by hover or long press.
- **Pure layers stay pure:** `src/library/`, `model/`, `syntax/`, `context/`
  and `formula/` import neither React nor `localStorage` directly.
- **Gate before every commit:**
  `npm run typecheck && npm test && npm run build`

## Review Focus

1. **The owner's existing note survives the upgrade.** A legacy
   `livenotes:doc:v1` with edits becomes note #1 with identical content, and
   the legacy key is not deleted until the index write succeeds. Covered by a
   test in Task 2.
2. **Week-boundary dates.** A plan starting this Sunday is "This week" and one
   starting next Monday is "Next week", including when today is Sunday.
   Covered by a test in Task 1.
3. **A deleted note whose undo expires.** The deletion is permanent after
   reload, and a note deleted then undone is fully intact. Covered by a test in
   Task 2.
4. **Leaving a brand-new empty note.** No "Untitled" ghost is left in Recent,
   but a new note with only a title is kept. Covered by a test in Task 3.
5. **Two tabs.** Editing note A in one tab and note B in another loses
   neither, and the home list reflects the other tab's edits after a `storage`
   event. Covered by a test in Task 3.

---

### Task 1: Library core (pure)

**Files:**
- Create: `src/library/types.ts`, `src/library/summarize.ts`,
  `src/library/sections.ts`, `src/library/sketch.ts`, `src/library/text.ts`
- Modify: `src/model/types.ts` (add `title?: string` to `Doc`)
- Test: `src/library/summarize.test.ts`, `src/library/sections.test.ts`,
  `src/library/sketch.test.ts`

**Interfaces:**
- Consumes: `resolveContexts(doc, today)` and `tokenize(text)`.
- Produces `NoteSummary` and `NoteMeta`, exactly as in spec §2. `NoteMeta`
  also gets `deletedAt?: number`.
- Produces `foldText(s: string): string` in `text.ts`: lowercase, NFD with
  diacritics stripped, whitespace collapsed.
- Produces `summarizeNote(doc: Doc, today: ISODate): NoteSummary`.
- Produces
  `homeSections(metas: NoteMeta[], today: ISODate, query = ''): HomeSections`,
  where:

  ```ts
  type Bucket = 'today' | 'thisWeek' | 'nextWeek' | 'later';

  interface HomeSections {
    pinned: NoteMeta[];
    upcoming: { bucket: Bucket; notes: NoteMeta[] }[];
    recent: NoteMeta[];
    archivedCount: number;
    results?: NoteMeta[];
  }
  ```

  `results` is set only when `query` is non-empty. Then `pinned`, `upcoming`
  and `recent` are empty.
- Produces `archivedNotes(metas: NoteMeta[]): NoteMeta[]`, sorted by
  `updatedAt` descending.
- Produces `relativeDays(from: ISODate, to: ISODate, today: ISODate): string`.
  Values: `today`, `tomorrow`, `in N days`, `ends today`, `ends tomorrow`,
  `ends in N days` (for an ongoing plan).
- Produces
  `projectSketch(places: {lat:number;lon:number}[], w: number, h: number, pad = 6): {x:number;y:number}[]`.
  It is equirectangular with the aspect kept, and centres a single point.

- [ ] **Step 1: Write the failing tests:**
  - `summarizeNote`:
    - Uses `doc.title` when set. Otherwise it uses the first top-level bullet's
      plain text (via `plainText`-style folding of chips to names). Otherwise
      `''`.
    - Takes `from`/`to` from own dates anywhere in the tree (a nested
      `Nov 5` counts).
    - Lists `places` in document order, resolved only, de-duplicated, capped
      at 8.
    - `placeNames` includes unresolved names as written.
    - `preview` excludes the title line, is plain text and is at most 140
      characters.
    - `searchText` matches `foldText('Évora')` → `'evora'`.
  - `homeSections`, with today = `2026-10-28`, a Wednesday:
    - A plan `2026-11-01..02` (Sunday) is `thisWeek`.
    - `2026-11-02` (Monday) is `nextWeek`.
    - `2026-11-10` is `later`.
    - An ongoing `2026-10-27..30` is `today`.
    - With today = Sunday `2026-11-01`, a plan on `2026-11-02` is `nextWeek`.
    - A past plan goes to `recent`.
    - `recent` is sorted by `updatedAt` descending.
    - Pinned notes appear only in `pinned`.
    - Archived and deleted notes are excluded.
    - `archivedCount` counts non-deleted archived notes.
    - The query `'lisb'` matches a note whose `placeNames` include `Lisbon`.
  - `relativeDays`: one case per wording.
  - `projectSketch`:
    - Two points map to opposite padded corners.
    - A single point maps to the centre.
    - Aspect is kept: a tall set of points doesn't fill the width.
- [ ] **Step 2:** Run `npx vitest run src/library`. Expected: FAIL (modules
  missing).
- [ ] **Step 3:** Implement. `homeSections` takes week boundaries from ISO day
  numbers. The week is Monday–Sunday: "This week" ends on the Sunday on or
  after today; "Next week" is the following Monday–Sunday.
- [ ] **Step 4:** Run `npx vitest run src/library`. Expected: PASS. Then run
  the gate.
- [ ] **Step 5:** Commit `feat(library): note summaries, home sections, route sketch projection`.

### Task 2: Library storage and migration (pure, injected storage)

**Files:**
- Create: `src/library/storage.ts`
- Test: `src/library/storage.test.ts`

**Interfaces:**
- Consumes: the Task 1 types and `summarizeNote`; `isDoc`/`parseImport` from
  `model/storage.ts` (export `isDoc`); `sampleDoc()`.
- Produces `INDEX_KEY = 'livenotes:index:v1'`,
  `noteKey(id: string): string` (→ `livenotes:note:<id>`) and
  `LEGACY_KEY = 'livenotes:doc:v1'`.
- Produces
  `createLibrary(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>, opts: { now?: () => number; today?: () => ISODate; newId?: () => string }): Library`,
  where:

  ```ts
  interface Library {
    list(): NoteMeta[];                    // non-purged metas, including soft-deleted
    read(id: string): Doc | null;
    create(doc?: Doc): NoteMeta;           // default: empty doc with one empty bullet, no title
    save(id: string, doc: Doc): NoteMeta;  // writes the note key, recomputes summary, bumps updatedAt
    setPinned(id: string, on: boolean): void;
    setArchived(id: string, on: boolean): void;
    softDelete(id: string): void;          // sets deletedAt
    undoDelete(id: string): void;
    purgeDeleted(): void;                  // removes every soft-deleted note key and meta
    remove(id: string): void;              // immediate hard delete (used for discarding empty new notes)
    importDoc(json: string): NoteMeta | null;
    reload(): void;                        // re-read the index after another tab wrote it
  }
  ```

- Construction runs migration when there is no index:
  1. A valid legacy doc becomes a note (`createdAt = updatedAt = now`).
  2. Otherwise a `sampleDoc()` titled `Portugal road trip (sample)` is created.
  3. The index is written.
  4. Only then is `LEGACY_KEY` removed.

  An index that fails validation is rebuilt by scanning for
  `livenotes:note:*` keys, if `storage` supports `key()`/`length`. Otherwise it
  is treated as missing.
- Construction also purges notes soft-deleted more than 6 s before `now`, so an
  undo window that ended in a crash or reload is final.

- [ ] **Step 1: Write the failing tests** (with an in-memory `Map`-backed
  storage):
  - The legacy doc migrates with an identical doc (`toEqual`), and the legacy
    key is gone afterwards.
  - If `setItem(INDEX_KEY)` throws, the legacy key remains (Review Focus 1).
  - A first launch creates exactly one sample note with that title.
  - `save` updates `summary.title` and `updatedAt`.
  - Pin and archive persist across a new `createLibrary` on the same storage.
  - `softDelete` then `undoDelete` leaves the doc intact.
  - `softDelete` then `purgeDeleted` removes the note key and meta.
  - A note soft-deleted 7 s earlier is purged on the next construction
    (Review Focus 3).
  - `importDoc` rejects invalid JSON with `null`, and accepts a valid doc as a
    new note.
  - `remove` deletes the key and meta immediately.
- [ ] **Step 2:** Run `npx vitest run src/library/storage.test.ts`. Expected:
  FAIL.
- [ ] **Step 3:** Implement. Every mutating method rewrites the index. Write
  failures (quota) throw to the caller.
- [ ] **Step 4:** Run it again (PASS), then run the gate.
- [ ] **Step 5:** Commit `feat(library): storage, migration from the single-note app, soft delete`.

### Task 3: Routing, LibraryProvider, per-note DocProvider

**Files:**
- Create: `src/app/router.ts`, `src/library/LibraryProvider.tsx`,
  `src/ui/usePersistence.ts`, `src/app/Root.tsx`
- Modify:
  - `src/ui/store.tsx`: move persistence into `usePersistence`; add
    `storageKey` and `onSaved` props
  - `src/main.tsx`: render `<Root/>`
  - `src/ui/App.tsx`: becomes `NoteScreen` content in Task 5; for now Root
    renders it for a note route
- Test: `src/app/Root.test.tsx`

**Interfaces:**
- Produces `useRoute(): Route` and `navigate(to: string): void`, where
  `Route = { name: 'home' } | { name: 'archive' } | { name: 'note'; id: string }`.
  They listen to `hashchange`, and an unknown hash maps to home.
- Produces `goBack(): void`. It calls `history.back()` when
  `history.length > 1` and the previous entry is in-app (tracked by a session
  counter), otherwise `navigate('#/')`.
- Produces `LibraryProvider({ children, storage?, today? })` and
  `useLibrary(): { metas: NoteMeta[]; library: Library; today: ISODate; refresh(): void }`.
  It refreshes on the `storage` event for `INDEX_KEY` (Review Focus 5).
- `DocProvider` gains these props:
  - `storageKey?: string`, defaulting to `STORAGE_KEY`, which keeps
    single-doc tests working
  - `onSaved?: (doc: Doc) => void`, called after each successful flush
  - `initialDoc` stays

  Persistence (debounce 300 ms, flush on `pagehide` and hidden, follow other
  tabs for that key) lives in `usePersistence(storage, storageKey, doc, onExternal)`.
- `Root` renders:
  - `home` and `archive`: a placeholder `<main data-screen="home">` with a
    list of note titles as links, plus a `New note` button
    (`library.create()`, then `navigate('#/note/<id>')`). Task 4 replaces it.
  - `note`: `<DocProvider key={id} storageKey={noteKey(id)} initialDoc={library.read(id)} onSaved={(d) => { library.save(id, d); refresh(); }}>`
    around the current note UI.
  - an unknown or deleted id: navigates home.
- **Discard on leave:** when leaving a note route whose doc has no title and
  all-empty text, and whose meta was created in this session,
  `library.remove(id)` runs.

- [ ] **Step 1: Write the failing UI tests** (in-memory storage):
  - Start at `#/` → `New note` opens `#/note/<id>`.
  - Leave immediately (`navigate('#/')`) → that note is not in the list
    (Review Focus 4).
  - Create a note, type a title-less bullet `hello`, go back → `hello` appears
    in the list.
  - A note with only a title is kept.
  - A `storage` event for `INDEX_KEY` with a new index updates the home list
    (Review Focus 5).
  - Editing note A writes only `livenotes:note:A`.
- [ ] **Step 2:** Run `npx vitest run src/app`. Expected: FAIL.
- [ ] **Step 3:** Implement. All existing tests keep passing unchanged, because
  `storageKey` defaults to the legacy key.
- [ ] **Step 4:** Run the gate (PASS).
- [ ] **Step 5:** Commit `feat(app): hash routing, library provider, per-note documents`.

### Task 4: Home: Timeline

**Files:**
- Create: `src/home/Home.tsx`, `src/home/Timeline.tsx`,
  `src/home/NoteCard.tsx`, `src/home/RouteSketch.tsx`,
  `src/home/PinnedRow.tsx`, `src/home/CardMenu.tsx`, `src/home/UndoBar.tsx`,
  `src/home/Archive.tsx`, `src/home/home.css`
- Modify: `src/app/Root.tsx` (render `Home`/`Archive`)
- Test: `src/home/Home.test.tsx`

**Interfaces:**
- Consumes: `useLibrary`, `homeSections`, `archivedNotes`, `relativeDays`,
  `projectSketch`, `navigate`.
- `RouteSketch({ places, width = 112, height = 72 })` renders an `<svg>`:
  - `role="img"` with `aria-label="Route: A → B → C"`
  - the orange dashed polyline
  - the first stop as a filled circle and the last as a ring
  - a single place as a dot with a halo
  - nothing at all when there are no places
- `NoteCard({ meta, variant: 'timeline' | 'recent', today })` renders:
  - the title (`Untitled` when empty)
  - meta lines (date range like `Nov 3–6` via an `formatRange(from, to)`
    helper in `src/home/format.ts`; `relativeDays`; up to 3 place names)
  - the sketch or the preview
  - a `⋯` button with `aria-label="Note actions"`

  The whole card is a link to `#/note/<id>`. The menu stops propagation.
- `CardMenu` items: `Pin`/`Unpin`, `Archive`/`Unarchive`, `Delete`.
- `UndoBar({ onUndo, onExpire })` shows `Note deleted` and an `Undo` button.
  It auto-expires after 6000 ms, then calls `library.purgeDeleted()`.
- `Home` layout, top to bottom:
  - header: wordmark, `<input type="search" aria-label="Search notes">`, and a
    `⋯` menu with `Import note` and `Add sample note`
  - pinned row
  - Upcoming, with buckets labelled `Today`, `This week`, `Next week`, `Later`
  - Recent
  - an `Archive (n)` link
  - the FAB `New note` (`aria-label="New note"`)
  - a first-launch hint card when the library holds only the sample note:
    "Tap + to start a note. Type @ for places, dates like Nov 3."
  - search results replace the sections; with no results it shows
    `No notes match "<q>"` and a `Clear` button
- `Archive`: the same cards with `Unarchive`, a back link, and the empty copy
  `Nothing archived`.

- [ ] **Step 1: Write the failing UI tests** (seed the library with metas via
  `createLibrary` on in-memory storage, today `2026-10-28`):
  - Renders bucket headings only for non-empty buckets.
  - A timeline card shows `Nov 3–6` and `in 6 days`.
  - Recent order is by `updatedAt`.
  - Typing `lisb` in search shows only the Lisbon note.
  - Typing `zzz` shows the no-match copy, and `Clear` restores the sections.
  - Pin moves a note into the pinned row.
  - Archive hides it and `Archive (1)` appears; unarchive brings it back.
  - Delete removes the card and shows `Note deleted`; `Undo` restores it.
  - With fake timers, 6 s after delete the note is purged from storage.
  - The `RouteSketch` aria-label lists the places.
  - A note with no places renders a preview and no svg.
- [ ] **Step 2:** Run `npx vitest run src/home`. Expected: FAIL.
- [ ] **Step 3:** Implement. The structure and its CSS live in `home.css` and
  use the existing tokens. Task 7 owns fonts and the type scale.
- [ ] **Step 4:** Run the gate (PASS).
- [ ] **Step 5:** Commit `feat(home): timeline home with pinned, recent, search, archive, undo delete`.

### Task 5: Note screen chrome and title

**Files:**
- Create: `src/note/NoteScreen.tsx`, `src/note/TitleField.tsx`
- Modify: `src/ui/App.tsx` (removed; its pieces move into `NoteScreen`),
  `src/ui/Outline.tsx`, `src/model/ops.ts` (`setTitle`), `src/app/Root.tsx`
- Test: `src/note/NoteScreen.test.tsx`; `ops.test.ts` gets a `setTitle` case

**Interfaces:**
- Produces `setTitle(doc, title): OpResult`.
- `NoteScreen({ id, isNew })` renders:
  - a top bar with `← ` (`aria-label="Back"`, calls `goBack()`)
  - a `⋯` menu (`aria-label="Note menu"`) with `Pin`/`Unpin`,
    `Archive`/`Unarchive`, `Export`, and `Delete`. Delete soft-deletes,
    navigates home, and Home shows the undo bar via a
    `?deleted=<id>` hash query or library state.
  - `TitleField`
  - `Outline`
  - `MobileToolbar`
  - the legend footer, kept on desktop and hidden at 640 px or below
- `TitleField`:
  - a `<textarea rows=1 aria-label="Title" placeholder="Title">` bound to
    `doc.title`
  - autofocused when `isNew`
  - Enter focuses the first bullet at caret 0, creating one if the outline is
    empty, and never inserts a newline
  - for migrated notes without `doc.title`, the field shows empty with the
    placeholder, and the card falls back to the first bullet (Task 1)

- [ ] **Step 1: Write the failing tests:**
  - A new note's title field has focus.
  - Typing `Weekend` then Enter focuses the first bullet editor.
  - Back navigates home and the card shows `Weekend`.
  - The menu Archive removes the note from home.
  - Delete navigates home and shows `Note deleted`.
  - `setTitle` returns a new doc without mutating the old one.
- [ ] **Step 2:** Run the tests and see them FAIL.
- [ ] **Step 3:** Implement them, then run the gate (PASS).
- [ ] **Step 4:** Commit `feat(note): note screen with title, back and note menu`.

### Task 6: Remaining review fixes

**Files:**
- Modify: `src/ui/Chips.tsx`, `src/ui/NodeEditor.tsx`,
  `src/ui/views/CalendarView.tsx`, `src/ui/views/MapView.tsx`,
  `src/ui/views/collect.ts`
- Test: additions in `src/ui/Outline.test.tsx` and
  `src/ui/views/views.test.tsx`

**Interfaces:**
- `FormulaChip` with an error: clicking it stops propagation and toggles a
  `role="status"` popover holding the full message. Outside tap or `Escape`
  closes it.
- `NodeEditor`:
  - On `compositionstart` it adds the class `is-composing` to `.editor-wrap`.
    CSS makes the textarea text visible and hides the mirror.
  - `compositionend` removes the class.
- `CalendarView`:
  - It measures its own width with a `ResizeObserver`. Narrow means 520 px or
    less, and jsdom falls back to wide.
  - When narrow, the grid cells render dots as `<span aria-hidden>` with no
    buttons, and the agenda list holds the buttons.
  - When wide, there is no agenda list.
  - Prop `forceNarrow?: boolean` exists for tests.
- `unresolvedPlaces` returns `{ key, name }[]`, where `name` is as first
  written. MapView lists the names.

- [ ] **Step 1: Write the failing tests:**
  - Clicking an error chip shows the popover with the message and does not
    open the editor.
  - A `compositionstart` event adds `is-composing`; `compositionend` removes
    it.
  - Calendar with `forceNarrow`: the grid has 0 buttons and the agenda has N.
    Without it, there is no `.agenda`.
  - `unresolvedPlaces` returns `[{ key: 'atlantis', name: 'Atlantis' }]`.
- [ ] **Step 2:** Run them and see them FAIL. Implement. Run the gate (PASS).
- [ ] **Step 3:** Commit `fix: error detail on tap, IME composition, accessible narrow calendar, real place names`.

### Task 7: Visual push and DESIGN.md

**Files:**
- Modify: `package.json` (font deps), `src/main.tsx` (font imports),
  `src/styles.css` (tokens, type scale, motion), `src/home/home.css`
- Create: `DESIGN.md`

**Interfaces:**
- Tokens added on `:root`, with dark values where colour applies:
  - `--font-display: 'Fraunces Variable', Georgia, serif`
  - `--font-ui: 'Instrument Sans Variable', system-ui, sans-serif`
  - the scale: `--fs-display` (32/36), `--fs-title` (22/28), `--fs-body`
    (16/26), `--fs-meta` (13/18), `--fs-micro` (11/14, small caps)
  - spacing: `--sp-1`…`--sp-6` (4, 8, 12, 16, 24, 32)
  - radii: `--r-card: 14px`, `--r-chip: 6px`
  - shadows: a two-layer `--shadow-card`
- Uses:
  - Fraunces: note titles, card titles, timeline stamps (tabular numerals),
    section heads (small caps)
  - Instrument Sans: everything else
- Motion:
  - `[data-screen]` enters with a 160 ms fade and 8 px rise
  - the undo bar slides up
  - everything is disabled under `prefers-reduced-motion`
- `DESIGN.md` records the world, the tokens, the two signature moves (route
  sketch and timeline stamps on the orange rail), component rules and the
  kept traits.

- [ ] **Step 1:** Install the fonts, import them in `main.tsx`, add the tokens,
  and apply them across home, note and chips.
- [ ] **Step 2:** Run the gate.
- [ ] **Step 3:** Run the impeccable detector once:
  `sh <impeccable>/scripts/impeccable detect --json src/styles.css src/home src/note`.
  Fix what it flags in one batch.
- [ ] **Step 4:** Commit `style: Fraunces + Instrument Sans type system, tokens, motion; DESIGN.md`.

### Task 8: End-to-end verification, docs, ship

**Files:**
- Modify: the scratchpad `e2e.cjs` (not committed), `CLAUDE.md` (sections 2.1,
  3.1, 7 and new §12 Library), `src/model/sample.ts` (title)

- [ ] **Step 1:** Update the Playwright script.
  - Every existing check first opens the sample note from home.
  - Add a library flow:
    - new note → title → bullet with `@lis` pick → back
    - the card shows the place and sketch
    - search, pin, archive/unarchive
    - delete → undo
    - phone FAB
    - Android-style back (`history.back()`) from a note returns home
  - Take phone light, phone dark and desktop screenshots of home and a note.
- [ ] **Step 2:** Run it against `vite preview`. Expected: all checks PASS.
  Fix what fails, root cause first.
- [ ] **Step 3:** Update `CLAUDE.md`, then run the gate, commit and push.
- [ ] **Step 4:** Confirm the Android APK and Live API check workflows are
  green, and the `android-latest` asset is updated.

---

## Later phase (not in this build): Google Maps provider

The owner wants Google Maps for more accurate places, maps and routes, as
Embark did, once a Google Maps Platform key with billing exists. This build
stays on the free services. The design is recorded here so the later phase
starts from a decision rather than a blank page.

- **Provider switch:**
  - `src/services/google.ts` implements the existing `Services` interface:
    - `geocode` and `search` use Places API (New) Text Search and
      Autocomplete, biased by `near`
    - `route` uses the Routes API `computeRoutes`, with modes driving,
      walking, bicycling and transit, plus traffic-aware durations
    - `weather` stays on Open-Meteo
  - `src/services/index.ts` picks `google` when `import.meta.env.VITE_GOOGLE_MAPS_KEY`
    is set, otherwise today's free stack. No other code changes, because
    everything already goes through `Services`.
- **Map view:** `MapView` gets a Google Maps JavaScript API renderer behind the
  same props. It draws the real route geometry from `computeRoutes`. Leaflet
  and OpenStreetMap remain the keyless fallback.
- **Formulas:**
  - `route(a, b, "transit"|"walk"|"bike")` gains a mode argument.
  - `place.rating`, `place.hours` and `place.address` property access is
    backed by Place Details fields.
  - The formula grammar is unchanged.
- **Key handling:**
  - The key lives only in a GitHub Actions secret `GOOGLE_MAPS_KEY`. It is
    injected at build time as `VITE_GOOGLE_MAPS_KEY` and never committed.
  - The key is restricted in Google Cloud to the needed APIs, and to the
    `https://localhost` referrer for the WebView.
  - A Capacitor-native Google SDK would allow Android-app key restriction. It
    is a possible follow-up.
- **Cost guard:**
  - Session tokens for Autocomplete.
  - Field masks on Place Details and Routes.
  - The existing per-session memo and the `doc.places` cache, which give one
    lookup per name ever.
- **Tests:** fake-fetch unit tests like `services.test.ts`, plus a
  `live-check` job that runs only when the secret is present.
