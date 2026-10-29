# Notes library, home timeline and visual push: design

Status: approved (2026-10-29) · Product truth: `PRODUCT.md` · Engineering spec: `CLAUDE.md`

## 1. What the owner asked for (confirmed answers)

| Question | Answer |
|---|---|
| Main use | A mix: everyday notes, plus plans with time and place |
| Home organisation | **Upcoming + recent**: notes with coming dates first (soonest first), then everything else (most recently edited first) |
| Note cards | **Rich card**: title, date range, a few places, a small route sketch; plain notes show a text preview |
| New note | **Blank, cursor on the title** |
| Managing notes | **Search**, **delete with undo**, **pin to top**, **archive** |
| Visual style | **Keep the feel, push it further**. Keep: warm paper, orange accent, coloured chips, dark mode |
| Home layout | **Timeline**: upcoming plans hang off a date line (Today / This week / Next week / Later); recent notes as cards below |

Also in scope: the remaining issues from the last review (§7).

## 2. Data model and storage

```ts
interface NoteMeta {
  id: string;
  createdAt: number;           // epoch ms
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  deletedAt?: number;          // soft delete, see below
  summary: NoteSummary;        // recomputed on every save, so home never parses every note
}

interface NoteSummary {
  title: string;               // Doc.title, else first top-level bullet as plain text, else ''
  from?: ISODate; to?: ISODate;// earliest / latest own date anywhere in the note
  places: { name: string; lat: number; lon: number }[]; // resolved, document order, max 8
  placeNames: string[];        // as written, for search (includes unresolved)
  preview: string;             // first ~140 chars of plain text after the title line
  searchText: string;          // lowercased, accent-folded title + text + places
}
```

- **`Doc` gains an optional `title?: string`.** It stays `version: 1`, since the
  new field is optional and old docs remain valid.
- **Storage keys:**
  - `livenotes:index:v1` holds `{ version: 1, notes: NoteMeta[] }`.
  - `livenotes:note:<id>` holds each note's `Doc`.

  Per-note keys keep each save small, and keep two tabs editing different
  notes from clobbering each other.
- **Migration** runs once, when there is no index:
  - A legacy `livenotes:doc:v1` becomes the first note, keeping all the owner's
    edits. The legacy key is left in place until the first successful index
    write, then removed.
  - On a first-ever launch, the sample trip is created as a note titled
    "Portugal road trip (sample)".
- **Pure functions** live in `src/library/`, with no React and no storage
  access:
  - `summarizeNote(doc, today)`
  - `homeSections(metas, today, query)`
  - `migrate(storage)`
  - CRUD helpers over an injected storage
- **Delete is soft first.** The meta is marked `deletedAt` and hidden. An
  "Undo" bar shows for 6 s. After that, or when the app hides, the note key and
  meta are removed. Undo restores both.

## 3. Navigation

- **Hash routes:**
  - `#/` is home
  - `#/note/<id>` is a note
  - `#/archive` is archived notes

  The hash keeps working inside the Capacitor WebView and survives reloads.
- **Back:** Android's back button and gesture go back through browser history
  (note → home, then exit). In-app back arrows use `history.back()` when there
  is history, otherwise they navigate to `#/`.
- **Leaving a brand-new empty note** (no title, no text) deletes it silently,
  so stray empty notes don't pile up.

## 4. Home: the Timeline

**Shell, top to bottom:**
- Header: the ✦ LiveNotes wordmark, then a search field (full width on phones,
  inline on desktop) and a `⋯` menu (Import note, Add sample note).
- **New note:** a floating orange button bottom-right on phones; a header
  button on desktop.

**Sections:**
1. **Pinned.** Only shown when there are pinned notes. Compact chips in a row
   (title, plus the date if it has one). They wrap to two lines, then scroll
   horizontally.
2. **Upcoming.** Notes with `to ≥ today`, sorted by `from` (an ongoing plan
   counts as Today).
   - Buckets: **Today · This week** (through Sunday) **· Next week · Later**.
     Empty buckets are hidden.
   - A vertical date rail runs down the left. Each note hangs off a date
     *stamp* (weekday plus day number, or "Dec 20" in Later).
   - Each card shows:
     - the title
     - the date range ("Nov 3–6") and relative time ("in 5 days", "today",
       "ends tomorrow")
     - up to 3 place names
     - the route sketch on the right
3. **Recent.** Every other non-archived note, most recently edited first.
   - Each is a card with the title, an "edited 2h ago" line, and the route
     sketch or the text preview.
   - Past plans land here with their date range shown quietly.
4. **Footer:** an "Archive (n)" link to `#/archive`.

**Route sketch** (signature move): a small inline SVG, with no map tiles and no
network.
- The note's resolved places are projected into the box (equirectangular,
  padded, aspect kept).
- The dots are joined by the orange dashed route line in document order. The
  first stop is a filled dot and the last a ring.
- One place draws a single dot with a soft halo. No places means no sketch.

**Card actions:**
- Tapping a card opens the note.
- A `⋯` button on each card (44 px target) offers Pin/Unpin, Archive/Unarchive
  and Delete.
- No hidden long-press-only actions.

**Search** filters live as you type:
- Matching is accent-insensitive across titles, text and place names.
- The sections collapse into one flat result list, ordered upcoming then recent.
- With no results: "No notes match "…"" and a Clear button.

**States:**

| State | What it shows |
|---|---|
| First launch | The sample note, plus a one-line hint card: "Tap + to start a note. Type @ for places, dates like Nov 3." |
| No notes at all | Empty state with the New note button |
| Archive view | Same cards, Unarchive in the menu, empty-state copy |
| Undo bar | Bottom, above the FAB, 6 s, "Note deleted · Undo" |

## 5. Note screen

- **Top bar:** ← back, then the note's `⋯` menu with Pin, Archive, Delete,
  Export (the share sheet on Android) and the view toggles as today.
- **Title** field above the outline: large serif, placeholder "Title". New
  notes open with the caret here, and Enter moves to the first bullet.
- **Outline:** the editor, mentions, picker, formulas, views and phone toolbar
  are unchanged.
- **Saving:**
  - Each note has its own `DocProvider`, keyed by note id and backed by its
    note key.
  - On save, the library meta (`updatedAt`, `summary`) is updated.
  - The existing other-tab, flush-on-hide and validation logic moves to
    per-note keys.

## 6. Visual push (same world, bolder)

The world stays as it is: warm paper, orange accent, chip colours, dark mode.
What changes:

- **Typography**
  - Titles, timeline stamps and section heads use **Fraunces** (variable,
    optical size), a warm soft serif.
  - UI and body text use **Instrument Sans** (variable).
  - Both are bundled with `@fontsource-variable/*`, so the APK works offline.
  - Numerals in stamps and dates are tabular.
  - Real type scale: display, title, body, meta and micro sizes, set as tokens.
- **Signature moves:** the route sketch, and the timeline's date stamps on the
  orange rail. Nothing else becomes ornament.
- **Surfaces:** cards on paper with a hairline border and a soft two-layer
  shadow. The note page stays full-bleed on phones. Section heads are small
  caps in Fraunces.
- **Motion:**
  - A short, calm transition between home and note (fade and 8 px rise, 160 ms).
  - The undo bar slides up.
  - All motion respects `prefers-reduced-motion`.
- **Tokens:** the new type, spacing and radius tokens are added to the
  `:root` variables. `DESIGN.md` is written to record the system.

## 7. Remaining issues fixed in this round

1. **Formula errors on phones.** Tapping an error chip shows the message in a
   small popover. It no longer opens the editor.
2. **Android keyboard composition.** While the keyboard is composing a word
   (`compositionstart`/`compositionend`), the editor shows the plain textarea
   text, so Android's composing underline is visible. Colour comes back when
   composition ends.
3. **Calendar on narrow screens.** The dot grid becomes decorative
   (`aria-hidden`, no buttons), and the agenda list is the accessible, tappable
   version. Narrow vs wide is decided by measured width, not only CSS.
4. **"Couldn't find" under the map** lists names as written, not lowercased
   keys.

## 8. Testing

- **Unit tests:**
  - `summarizeNote`: title fallback, date range across nested nodes, places
    order and cap, preview, accent-folded search text
  - `homeSections`: bucket boundaries around week ends, ongoing plans, pinned,
    archived and deleted exclusion, search
  - migration from `livenotes:doc:v1` and first launch
  - soft delete and undo
  - route sketch projection
- **UI tests:**
  - create note → title focused → back → appears in Recent
  - search filters
  - pin, archive and unarchive
  - delete then undo
  - an empty new note is discarded
  - the composition fallback
  - the error popover
- **End-to-end (Playwright, phone and desktop):**
  - the existing 31 checks, adapted to open the sample note first
  - plus a library flow
- **Gate:** `npm run typecheck && npm test && npm run build`. CI builds the
  APK, and the live API check keeps running.

## 9. Out of scope

Sync between devices, folders or tags, sharing, note templates, and trash
beyond the 6-second undo.
