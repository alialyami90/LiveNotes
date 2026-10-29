# LiveNotes

A notes app where an ordinary outline becomes a **dynamic document**. It is
modeled on Ink & Switch's *Embark* research prototype
(<https://www.inkandswitch.com/embark/>, Sonnentag, Obenauer & Litt, LIVE 2023).

You start with a loose bulleted plan, such as a trip. You then layer computation
onto it gradually, without leaving the document and without being forced into a
fixed schema.

This file is the design spec and the working agreement for anyone (human or
Claude) building the app. Keep it current when the design changes.

---

## 1. The Embark conceptual model (what we are reproducing)

Embark adds three primitives to a plain text outline:

| Primitive | What it is | Embark example | LiveNotes form |
|---|---|---|---|
| **Mentions** | Inline references to structured data that live inside free text | A place ("Lisbon") or a date ("Nov 3") | `@Lisbon`, `@[São Bento Station]`, and auto-detected dates such as `Nov 3` or `2026-11-03` |
| **Formulas** | Spreadsheet-like expressions that run inside the outline, read from it, and pull in live data. Their results feed further calculations | Weather forecast for a day, route and travel time between two stops | `{weather()}`, `{route(prev, here)}`, `{distance(@Lisbon, @Porto) * 2}` |
| **Views** | Rich renderings (map, calendar, …) of **any subtree**, shown inline in the document | A map of every place in "Day 2"; a calendar of the whole trip | Per-node `view: map \| calendar \| table`, rendered under the node |

Principles we take from Embark:

1. **The text is primary.** The outline stays readable as plain notes. Structure
   comes from recognizing things in the text, not from a form the user fills in.
2. **Gradual enrichment.** Every feature is optional and added in place. A note
   with no mentions is still a valid, useful note.
3. **The outline is the scope.** Hierarchy carries meaning. A date or place on a
   parent applies to its children (§3.3), and a view covers its node's subtree.
4. **One document, many lenses.** Map, calendar and table are projections of the
   same nodes, not copies. Hovering an item in one place highlights it in the
   others.
5. **Keep the process.** Alternatives, discarded options and reasoning stay in the
   document next to the computed parts. That is the advantage over juggling
   separate apps.

> Source note: the essay's host was blocked by the build environment's network
> policy, so this summary comes from search abstracts of the essay and project
> page plus prior knowledge of the prototype. The concrete syntax (`@`, `{}`),
> the context-inheritance rules and the function names are **LiveNotes design
> decisions**, not quotations from Embark.

---

## 2. Architecture

```
   #/ · #/archive → Home / Archive (src/home)   ·   #/note/<id> → NoteScreen (src/note)
            ┌──────── LibraryProvider (src/library): index of notes ────────┐
            │  one DocProvider per open note, persisted to its own key      │
            └───────────────────────────────┬────────────────────────────────┘
                                            ▼
            ┌──────────────── React UI (src/ui) ────────────────┐
 keyboard → │ Outline → NodeRow → NodeEditor (raw text, focused)│
            │                    → RichText (chips, unfocused)   │
            │ Views: MapView · CalendarView · TableView          │
            └──────▲──────────────────────┬──────────────────────┘
                   │ state                 │ actions
            ┌──────┴──────────────────────▼──────────────────────┐
            │ model/  Doc (normalized tree) + pure ops + reducer │
            │         storage (localStorage, JSON import/export) │
            └──────▲─────────────────────────────────────────────┘
                   │ text
            ┌──────┴───────────┐   ┌────────────────────────────┐
            │ syntax/ tokenize │──▶│ context/ resolve place/date │
            │  places·dates·{} │   │  per node (inheritance)     │
            └──────────────────┘   └─────────────┬──────────────┘
                                                 ▼
                                  ┌───────────────────────────────┐
                                  │ formula/ lex → parse → eval   │
                                  │ (async, pure given Services)  │
                                  └─────────────┬─────────────────┘
                                                ▼
                                  ┌───────────────────────────────┐
                                  │ services/ geocode · weather · │
                                  │ routing (HTTP, memoized)      │
                                  └───────────────────────────────┘
```

**Stack:** Vite + React + TypeScript (strict). Leaflet with OpenStreetMap tiles
for maps. Vitest + Testing Library for tests. No backend.

The app is **local-first**: the notes live in the browser, and the only
network calls are to free, keyless data APIs.

**Rule of isolation:** `model/`, `syntax/`, `context/`, `formula/` and the pure
parts of `library/` (everything but `LibraryProvider.tsx`) are pure
TypeScript with **no React and no `fetch`**. Everything that touches the network
goes through the `Services` interface, so tests inject fakes. UI components stay
thin.

### 2.1 Directory layout

```
src/
  app/        router.ts (hash routes, replace-navigation, goBack)  Root.tsx (providers,
              screen switch, discard-on-leave)  NoteRoute.tsx (one DocProvider per note)
  home/       Home.tsx  Timeline.tsx  Archive.tsx  HomeMenu.tsx  NoteCard.tsx  CardMenu.tsx
              PinnedRow.tsx  UndoBar.tsx  RouteSketch.tsx  cardActions.tsx  format.ts
              home.css  screens.css
  note/       NoteScreen.tsx (top bar, note menu)  TitleField.tsx  note.css  screen.css
  library/    types.ts (NoteMeta, NoteSummary)  summarize.ts  sections.ts (home buckets,
              search)  sketch.ts  text.ts (accent folding)  storage.ts + records.ts
              (index, note keys, migration, soft delete)  blank.ts  memoryStorage.ts
              LibraryProvider.tsx (React: index state, undo delete)
  model/      types.ts  tree.ts (parent index, traversal)  ops.ts (pure edits)
              storage.ts (validate, load/save)  sample.ts (seed trip doc)
  syntax/     tokenize.ts (text → segments, escapes)  dates.ts (date recognition)
              mention.ts (mention under the caret)  plain.ts (chips → plain text)
  context/    resolve.ts (effective place/date per node, dayNumber)
  formula/    lexer.ts  parser.ts  evaluate.ts  values.ts  format.ts
  services/   types.ts  http.ts (Open-Meteo · Photon · OSRM)  geo.ts  memo.ts
  platform/   export.ts (download on web, share sheet on Android)
  ui/         store.tsx (DocProvider: state, focus, frozen viewDoc)
              usePlaceLookups.ts (top-down geocoding, retries)  usePersistence.ts
              ErrorBoundary.tsx  Outline.tsx  NodeRow.tsx  NodeEditor.tsx
              PlacePicker.tsx  usePlaceSearch.ts  MobileToolbar.tsx
              RichText.tsx  Chips.tsx  NodeMenu.tsx  hover.ts  useFormula.ts
              views/ViewHost.tsx  views/collect.ts  views/MapView.tsx (lazy)
              views/CalendarView.tsx  views/TableView.tsx
  styles/     tokens.css  base.css  chrome.css  outline.css  chips.css  views.css
              touch.css  screens.css   (imported by styles.css, with the fonts)
  main.tsx  styles.css
```

Tests sit next to their source (`foo.ts` → `foo.test.ts`).

---

## 3. Data model

### 3.1 Document (normalized tree)

```ts
type NodeId = string;
type ViewKind = 'map' | 'calendar' | 'table';

interface OutlineNode {
  id: NodeId;
  text: string;          // raw source, including @mentions and {formulas}
  children: NodeId[];
  collapsed?: boolean;
  view?: ViewKind;       // a view renders this node's subtree
}

interface Place { name: string; lat: number; lon: number; label?: string }

interface Doc {
  version: 1;
  title?: string;                    // the note's title; absent on notes from before the library
  rootId: NodeId;                    // invisible root; its children are top-level bullets
  nodes: Record<NodeId, OutlineNode>;
  places: Record<string, Place>;     // geocode results, keyed by normalized mention name
}
```

- Parent links are **derived** by `tree.ts`, never stored, so the tree cannot
  drift out of sync.
- `places` is a resolution cache that lives *in the document*. Resolved mentions
  therefore survive reloads and work offline. A later "re-pick location" UI only
  has to overwrite one entry.

### 3.2 Inline syntax (`syntax/tokenize.ts`)

`tokenize(text) → Segment[]`, where `Segment` is one of the following:

| Segment | Source syntax | Notes |
|---|---|---|
| `text` | anything else | |
| `place` | `@Word` or `@[Multi Word Name]` | `@Word` stops at whitespace or punctuation. The key is lowercased and trimmed. |
| `date` | `2026-11-03`, `Nov 3`, `3 Nov`, `November 3, 2026`, `Nov 3 2026` | Without a year, the year is inferred in `context/` (§3.3). |
| `formula` | `{ … }` | Braces nest-count. An unclosed `{` is plain text. |
| escape | `\@`, `\{` | Stays literal text (backslash hidden when rendered by `displayText`). |

Text inside `{…}` is formula source and is **not** scanned for date mentions.
Inside a formula, `@Name` is a place literal.

### 3.3 Context inheritance (`context/resolve.ts`)

Each node has an **effective context** `{ place?, date? }`:

- `place` is the **last** place mentioned in the node's own text. If the node has
  none, it inherits the parent's effective place.
- `date` follows the same rule.
- **Yearless dates look forward.** The reference date is the previous date in
  the same node, else the inherited date, else today. A yearless date takes the
  reference's year, unless that would put it more than ~6 months before the
  reference, in which case it takes the next year. So `Jan 2` under
  `Dec 30 2026` resolves to `2027-01-02`.

This makes the following work:

```
- Lisbon trip
  - Nov 3 — arrive @Lisbon
    - Lunch at @[Time Out Market] {weather()}   ← Time Out Market, Nov 3
  - Nov 5 — train to @Porto {route(prev, here)} ← Lisbon → Porto
```

`prev` is the effective place of the **previous sibling**, or the parent's place
when the node is the first child. That gives "how do I get here from the last
stop" without explicit references.

---

## 4. Formula language (`formula/`)

### 4.1 Grammar

```
expr     := additive
additive := mult (('+' | '-') mult)*
mult     := unary (('*' | '/') unary)*
unary    := '-' unary | postfix
postfix  := primary ('.' IDENT)*
primary  := NUMBER [UNIT] | STRING | PLACE | DATE | IDENT | call | '(' expr ')'
call     := IDENT '(' [expr (',' expr)*] ')'
PLACE    := '@' word | '@[' … ']'
DATE     := ISO date literal (2026-11-03)
UNIT     := km | m | h | min | d          (e.g. 2h, 30min, 12km)
```

Identifiers and function names are case-insensitive.

### 4.2 Values (`values.ts`)

`number`, `string`, `place`, `date`, `duration` (seconds), `distance` (meters),
`weather`, `route`, `error`.

Arithmetic is unit-aware:

- duration ± duration, distance ± distance
- number × duration/distance
- distance ÷ duration → speed, shown as km/h
- date − date → duration in days; date ± duration → date

Anything else is an `error` value, never a thrown exception. Errors render as red
chips with the message in a tooltip.

### 4.3 Built-ins

| Name | Meaning |
|---|---|
| `here`, `place` | effective place of this node |
| `date` | effective date of this node |
| `prev` | effective place of the previous sibling (see §3.3) |
| `today` | current date |
| `weather(place = here, date = date)` | daily forecast: condition, high, low. Uses Open-Meteo, which covers about 16 days ahead. Further out, the error says "no forecast yet". |
| `route(from, to)` | driving route via OSRM: `.duration`, `.distance`. Displays "3h 05m · 313 km". |
| `distance(a, b)` | great-circle distance (haversine) |
| `days(a, b)` | whole days between two dates |
| `hours(x)`, `minutes(x)`, `km(x)` | unit conversion to a plain number |

Property access: `route(a,b).duration`, `weather().high`, `here.name`.

### 4.4 Evaluation

`evaluate(ast, env, services): Promise<Value>` is pure apart from the injected
`services`.

- Services are memoized by argument key, so re-rendering never refetches.
- The UI hook `useFormula(nodeId)` re-evaluates when the node's text or its
  resolved context changes. It shows a pending chip (`…`) while promises are
  outstanding.

---

## 5. Services (`services/`)

```ts
interface Services {
  geocode(name: string, near?: Place): Promise<Place | null>; // best match for a mention
  search(query: string, near?: Place): Promise<Place[]>;      // candidates for the @ picker
  weather(p: Place, isoDate: string): Promise<Weather>;
  route(a: Place, b: Place): Promise<Route>;
}
```

| Service | Endpoint (all free, no API key) |
|---|---|
| Towns and cities | `https://geocoding-api.open-meteo.com/v1/search?name=…&count=…&language=en` (GeoNames, ranked by population, so "lisbon" is Lisbon, Portugal, not Lisbon, Iowa) |
| Landmarks | `https://photon.komoot.io/api/?q=…&limit=…&lang=en[&lat=…&lon=…]` (OSM-based, finds points of interest; biased toward the parent bullet's place) |
| Weather | `https://api.open-meteo.com/v1/forecast?latitude&longitude&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date&end_date` |
| Routing | `https://router.project-osrm.org/route/v1/driving/{lon,lat};{lon,lat}?overview=full&geometries=geojson` |
| Map tiles | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with OSM attribution shown |

**How a mention is resolved (`geocode`).**

1. Ask Open-Meteo for the top match.
2. Use that match if any of these hold:
   - there is no parent place
   - it is within 75 km of the parent bullet's place
   - it is a major city (population ≥ 100k), so `@Dammam` under Riyadh means
     the city, not a local namesake (a live check found exactly this)
3. Otherwise ask Photon, biased to the parent place. A Photon street
   (`osm_key=highway`) never beats a town. The far Open-Meteo match is used
   only once Photon has actually answered.

`search` merges both sources in this order:

1. major cities
2. landmarks near the parent place
3. the remaining towns
4. far landmarks

Duplicates within 2 km are dropped. `onTowns` delivers the fast Open-Meteo
results first.

Photon's queue serves searches you type before background lookups, and skips
searches cancelled because you kept typing.

**Network discipline** (proven necessary by the CI live check: Photon's public
server answers 503 to bursts, then refuses connections):

- Photon requests are queued one at a time, about 1 per second.
- Every request has an 8 s timeout.
- 429, 5xx and network errors retry twice with backoff.
- A request that still fails raises `TransientError`. `null` ("not found") is
  returned only when every source answered with no results.

Rules:

- Failures surface as `error` values or chips. **Never substitute fake data** in
  the shipped app. Fakes exist only in tests.
- Geocoding results are written into `doc.places` (one network hit per name,
  ever). The store deduplicates in-flight lookups per key.
- **Mentions resolve top-down.** A mention waits until its parent bullet's place
  is known, so the lookup can be biased to it.
- **Place status** is `pending`, `missing` (the services answered "no results")
  or `error` (couldn't reach them). An `error` key is retried after 3 s, 10 s,
  30 s, 60 s and 180 s, then every 180 s. It is also retried at once when the
  device comes back `online`, when the app becomes visible again, and when
  the chip is tapped. Its chip shows a dashed outline with ⟳.
- Formulas wait for a mentioned key's (biased) lookup instead of starting their
  own.
- **The focused row is frozen for everyone else.** While a row is being edited,
  the store's `viewDoc` holds that row's text as it was when editing began.
  Contexts, formulas in other rows, views and geocoding all read `viewDoc`, so
  a half-typed name (`@Lis`) is never looked up. It is resolved on blur.
- Replacing the document (Import, Reset, another tab) clears the session's
  lookup bookkeeping, so its places resolve again.
- Formulas get places through an async `resolvePlace(key)`, so a formula is
  simply *pending* while its place is being geocoded.
- `memo.ts` deduplicates in-flight and completed calls for the session.

---

## 6. Views (`ui/views/`)

A view is attached to a node (`node.view`) and renders that node's **subtree**
directly beneath it. The user toggles it with the row's hover buttons
(🗺️ 📅 ▦), or by ending the node's text with `/map`, `/calendar`, `/table`
or `/none` and pressing Enter. The command must be its own word
(`dinner/table` is just text) and is stripped from the text.

| View | Shows |
|---|---|
| **Map** | One numbered marker per resolved place mention in the node and its subtree, in document order. Markers are joined by a dashed line in visit order, and the map fits its bounds. Clicking a marker focuses its node. |
| **Calendar** | A Monday-first grid covering only the weeks between the first and last date in the subtree. Each day lists the nodes whose *own* text mentions that date, with the date itself stripped from the label. Clicking an entry focuses the node. In narrow containers (≤ 520 px, via a container query) the grid shrinks to dots and an agenda list (date, then entries) appears below it. |
| **Table** | One row per direct child: text (rendered, without formulas), place, date, then one column per formula in that row. A light, grid-like lens on the list. In narrow containers the Place column is hidden, since it repeats the chip in the text. |

The **map** has its own stacking context, so Leaflet's panes never draw over the
sticky header.
- With no resolved places it hides itself and shows "Finding places…" or "No
  places to show yet".
- Unresolved names are listed under it.
- In dark mode the tiles are darkened with a CSS filter.

**Linked hover (`ui/hover.ts`).** A tiny shared store holding the hovered
`NodeId`. Hovering a node row highlights its marker and calendar entry. Hovering
a marker or entry highlights the row.

---

## 7. Editor behavior (`ui/`)

- **Focused node:** raw text in an auto-growing `<textarea>`, showing the real
  `@`/`{}` source.
  - **Formatting while typing.** The textarea's text is transparent and sits
    over a mirror `div` that renders the same characters with mentions, dates
    and formulas coloured. Both use the read view's font. Highlights change
    only colour and background, never metrics, so the caret stays aligned.
  - **Place picker.** While the caret is in an `@word` or `@[words` mention,
    a list shows:
    - places already in this document that match (instant and offline)
    - debounced (250 ms) `search` results from 2 characters up, biased to the
      bullet's inherited place

    Tap, or `↑`/`↓` then `Enter`/`Tab`, inserts `@Name` (or `@[Name]`) and
    stores that exact place, so no blind lookup happens. Picking again
    re-picks. `Escape` closes the list; a second `Escape` leaves the row.
- **Unfocused node:** `RichText`. Places become chips (dashed while unresolved,
  red if not found), dates become chips, and formulas become result chips. The
  raw formula appears on hover.
- **Keys:**
  - `Enter` splits the node at the caret, or creates a new sibling. At the
    very start of a non-empty node it inserts an empty bullet *above*, so the
    node keeps its children and context.
  - `Tab` and `Shift+Tab` indent and outdent.
  - `Backspace` on an empty node deletes it. At the start of a non-empty node,
    it merges into the previous visible node.
  - `↑` and `↓` on the first or last line move focus between nodes.
  - `Alt+Shift+↑` and `Alt+Shift+↓` move the node.
  - `Ctrl/Cmd+.` toggles collapse.
- **Bullets:** clicking the bullet collapses or expands. A small triangle shows
  that hidden children exist.
- **Persistence** (`usePersistence.ts`): each note saves, debounced 300 ms, to
  its own key `localStorage["livenotes:note:<id>"]` (§12).
  - Pending saves are flushed on `pagehide`, when the tab becomes hidden, and
    when the note is left (the provider unmounts), so leaving within 300 ms of
    typing loses nothing.
  - A `storage` event from another tab for the same note replaces its document,
    keeping focus when that row still exists.
  - Loaded and imported JSON is validated as a full tree: every child exists,
    there are no cycles or shared children, `places` is an object and `title`,
    if present, is a string. A note that fails validation is not opened; the
    app goes home instead.
  - If site data is blocked, the app runs on in-memory storage for the session.
  - A top-level `ErrorBoundary` offers "Download saved data" (every
    `livenotes:*` key, raw, so even unparseable data is kept) and "Back to
    notes" instead of a blank page. It never wipes the library.
- **First launch:** the library seeds the sample Portugal trip from
  `model/sample.ts`, titled "Portugal road trip (sample)". It exercises every
  feature, and its places ship with real coordinates, so it works instantly
  and offline.

---

### 7.1 Running it

```
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck
npm run build
```

## 8. Testing & verification

- **TDD for pure layers.** Write tests first for `syntax`, `context`, `formula`
  and `model/ops`. These carry the logic and must be thoroughly unit-tested with
  fake `Services`.
- **UI tests** (Testing Library + jsdom) cover keyboard tree editing and the
  rendering of chips and views at a smoke level.
- Before every commit:

  ```
  npm run typecheck && npm test && npm run build
  ```

  All three must pass.
- Network APIs are never hit by `npm test`.
- `src/services/live.test.ts` runs only with `LIVE_SERVICES=1`, in the
  `live-check.yml` workflow. It calls the real APIs and logs what they return,
  and is the first stop when a data feature misbehaves on a device.

## 9. Conventions

- TypeScript `strict`. No `any` in pure layers. Discriminated unions for
  `Segment`, `Expr` and `Value`.
- Pure functions return new objects. The model is never mutated in place.
- Small files with one purpose each. If a file passes about 250 lines, split it.
- Comments explain *why*, not *what*.
- CSS uses the design tokens in `src/styles/tokens.css` (type scale, spacing,
  radii, shadows, colours) and supports light and dark via
  `prefers-color-scheme`. `DESIGN.md` records the visual system; read it before
  changing styles.

## 10. Roadmap

1. **Foundation:** scaffold, model and ops, outline editor, persistence, sample
   doc.
2. **Mentions:** tokenizer, date recognition, place chips with geocoding,
   context resolution.
3. **Formulas:** lexer, parser and evaluator, built-ins, live result chips.
4. **Views:** map, calendar, table, linked hover.
5. **Library:** many notes, Timeline home, search, pin, archive, delete with
   undo, note titles, visual system (§12, `DESIGN.md`).
6. *Later:*
   - Document-level undo.
   - Re-pick a place from candidates.
   - Side-panel (pinned) views.
   - Date ranges ("Nov 3–5") as calendar spans.
   - Sync via Automerge for true local-first collaboration.
   - **Google Maps provider** (planned; needs a Google Maps Platform key with
     billing). It would cover Places search and details, Routes API (transit,
     walking and traffic) and Google map tiles, behind the existing `Services`
     interface, with the free stack as the keyless fallback. See the "Later
     phase" in `docs/superpowers/plans/2026-10-29-notes-library.md`.

---

## 11. Android app (Capacitor)

The same web app ships as an Android APK. It is wrapped with **Capacitor 8**,
which hosts the Vite build in a WebView. No logic forks for Android: platform
differences live in `src/platform/` and in CSS.

| Piece | Decision |
|---|---|
| Wrapper | `capacitor.config.ts`: appId `com.livenotes.app`, appName `LiveNotes`, `webDir: 'dist'`. The generated `android/` project is committed. Its built web assets are git-ignored. |
| Build | The sandbox can't reach Google's Android SDK hosts, so APKs are built by **GitHub Actions** (`.github/workflows/android.yml`). |
| Output | A **debug APK** for sideloading. |
| Data & network | `localStorage` persists in the WebView. The data APIs are HTTPS with permissive CORS, so they work from Capacitor's `https://localhost` origin unchanged. |
| Phone toolbar | Soft keyboards have no Tab, and Backspace is unreliable. When a row is focused on a touch device (`pointer: coarse`), a toolbar sits at the bottom of the screen with outdent, indent, move up, move down, collapse and delete bullet, plus the view toggles. Its buttons `preventDefault` on pointer/mouse down so the editor keeps focus and the keyboard stays up. |
| Export | Blob downloads don't work in a WebView. On native, `src/platform/export.ts` writes `livenotes.json` to the cache directory (`@capacitor/filesystem`) and opens the Android share sheet (`@capacitor/share`). On the web it downloads as before. Import uses `<input type=file>`, which Capacitor supports natively. |
| Touch UI | On touch-only screens, the row view buttons move into the editing toolbar as 🗺️ 📅 ▦ toggles for the focused row, so rows keep their full width. Below 640 px the header is one row, and Export/Import/Reset sit behind a `⋯` menu. The page is full-bleed. Maps pan with two fingers so one-finger scrolling still scrolls the page. The page honours safe-area insets (`viewport-fit=cover`). |

**CI workflow:** on every push and on manual dispatch it runs:

1. `npm ci`
2. typecheck, tests and build
3. `npx cap sync android`
4. JDK 21
5. `./gradlew assembleDebug`

It uploads `app-debug.apk` as a workflow artifact and also attaches it to a
rolling GitHub pre-release, `android-latest`, so it can be downloaded directly
on a phone.

**Known limit:** OpenStreetMap's tile servers may reject requests from apps
without a proper Referer. If tiles don't load in the APK, switch to a tile
provider that permits app use.

Local build, given an Android SDK: `npm run android:build`
(build, sync, then `./gradlew assembleDebug`).

---

## 12. Notes library

Design spec: `docs/superpowers/specs/2026-10-29-notes-library-design.md`.
Visual system: `DESIGN.md`.

**Storage** (`library/storage.ts`, pure over an injected `Storage`):

| Key | Holds |
|---|---|
| `livenotes:index:v1` | `{ version: 1, notes: NoteMeta[] }` |
| `livenotes:note:<id>` | that note's `Doc` |

- A `NoteMeta` carries `id`, `createdAt`, `updatedAt`, `pinned?`, `archived?`,
  `deletedAt?` and a `summary`. The summary holds the title, the date range,
  up to 8 resolved places, the place names, a 140-character preview and the
  folded search text. It is recomputed on every save, so home never parses
  notes.
- **Migration** runs once, when there is no index. The old single document
  (`livenotes:doc:v1`) becomes the first note, and its key is removed only
  after the index write succeeds. A failed write keeps the note in memory and
  retries next launch. An index that fails validation is rebuilt by scanning
  the note keys.
- **`updatedAt` means "edited".** Only changes the user wrote (text, title,
  structure, view, collapsed) touch it. Place-cache writes from geocoding
  update the summary but not `updatedAt`, so just opening a note never
  reorders Recent.
- **Two tabs:** every index write first re-reads the stored index, so a stale
  tab never overwrites another tab's notes. Home refreshes on `storage`
  events for the index.
- **Delete is soft first.** `deleteWithUndo` sets `deletedAt` and shows the
  undo bar ("Note deleted · Undo") for 6 s on Home and Archive. Expiry, a
  second delete, opening another note, or the app hiding (`pagehide`, or the
  tab becoming hidden) purges it. Focus moves to Undo, then back to the
  restored card, without ever leaving a field the user is typing in. Construction
  also purges anything deleted more than 6 s ago.
- **Leaving a brand-new empty note discards it.** This applies to notes
  created this session with no title and no text. Blankness is judged on the
  editor's in-memory doc, so a failed save never deletes typed text.

**Routes** (`app/router.ts`, hash-based so they work in the WebView):
- `#/` is home, `#/note/<id>` a note, and `#/archive` archived notes.
- In-app back uses `history.back()` when there is in-app history, otherwise it
  replaces the entry with home.
- Redirects (an unknown or deleted note, the crash screen) replace rather than
  push, so Android's back button always reaches home and then exits.

**Home** (`home/`):
- Sections, from `homeSections`:
  - Pinned chips.
  - Upcoming: notes whose `to ≥ today`, sorted by `from`, in Today / This
    week (through Sunday) / Next week / Later. Each hangs off a date stamp on
    the orange rail.
  - Recent: most recently edited first.
  - An `Archive (n)` link.
- Search folds accents and filters titles, text and place names into one list,
  upcoming first.
- New note is a floating button on phones and a header button on desktop. The
  header `⋯` menu has Import note and Add sample note.
- Cards show the route sketch, an inline SVG of the note's places in order
  (no tiles, no network). Each card's `⋯` menu offers Pin, Archive and Delete.
  Pinned notes show only as compact chips; they are unpinned from the note's
  own menu. Menus share `ui/useMenu.ts` (outside tap, Escape, arrow keys).

**Note screen** (`note/`):
- Back, the title field (new notes open with the caret there; Enter moves to
  the first bullet), then the outline.
- The `⋯` menu has Pin, Archive, Export (named after the title; the share
  sheet on Android) and Delete.
