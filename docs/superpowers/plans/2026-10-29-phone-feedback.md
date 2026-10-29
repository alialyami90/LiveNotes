# Phone Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix what the first on-device test showed, then verify every feature.
The problems were:

- Places fail to resolve, which leaves maps empty.
- There is no formatting while typing.
- There is no live place search.
- The layout is cramped on phones.

**Spec:** `CLAUDE.md`, updated in place as each task changes behaviour.

## Evidence (from the user's phone screenshots)

- **Resolved:** single-word places (Lisbon, Porto, Coimbra, Sintra, Cascais,
  Pinhão).
- **Shown "not found":** every multi-word place, plus `@dammam`.
- **Map tiles load** (the world map renders), so the empty map is a
  consequence of the unresolved places.
- **Leaflet's attribution draws over the sticky header** (a stacking-context
  bug).
- **The header wraps onto two rows**, and the calendar cells truncate to
  "fly …".
- **Error chips are long and wrap badly.**
- The table's formula column overflows.

## Tasks

### Task 1: Root-cause the geocoding failures

- Run the CI live job (`live-check.yml`).
- Fix the cause with a failing test first.
- Whatever the cause, make lookups robust:
  - queue requests (no bursts)
  - retry transient failures (network, 429, 5xx) with backoff
  - mark a place "not found" only when the API really returns zero results,
    and show transient failures as retryable (tap to retry)

### Task 2: Live place search while typing

**Interfaces:**

- `Services.search(query, near?) → Place[]` (Photon, `limit=5`, `lat`/`lon`
  bias from the row's context place).

**Behaviour:**

- While the caret is inside an `@word` or `@[words` mention, a suggestion
  list appears under the row.
- Places already in `doc.places` that match are shown first (instant and
  offline), followed by debounced (250 ms) Photon results.
- Tap, or `↑`/`↓` then `Enter`, inserts `@[Name]`, or `@Name` for a single
  word. It also stores the chosen place under that key, so no second lookup
  happens.
- `Escape` closes the list.

**Tests:**

- Typing `@lis` shows suggestions.
- Picking one inserts `@[Lisbon]`, stores the place, and moves the caret
  after the mention.
- Arrow keys and `Enter` pick.
- No search runs for fewer than 2 characters.

### Task 3: Formatting while typing

- The editor becomes a highlight overlay: a transparent-text textarea over a
  mirror div with the same font and wrapping.
- The mirror colours place, date and formula tokens. It uses colour and
  background only, never padding, so the caret stays aligned.
- The editor font becomes the same proportional font as the read view
  (no monospace jump).

**Test:** the editor's mirror renders a `.hl-place` span for `@Lisbon` and a
`.hl-formula` span for `{1+1}`.

### Task 4: Phone layout

- **Header:** one row. The actions move into a `⋯` menu below 640 px.
- **Page:** full-bleed on phones.
- **Chips:** wrap with `box-decoration-break: clone`. Error chips show a short
  label, with the detail on tap.
- **Map:** gets its own stacking context (`isolation: isolate`), so it never
  covers the header. With no places it shows a message instead of an empty
  world map. Tiles are darkened in dark mode.
- **Calendar:** an agenda list under narrow container widths (container query),
  with the grid kept for wide ones.
- **Table:** the Place column is hidden in narrow containers, and cells wrap.

### Task 5: Whole-app verification

- A Playwright end-to-end run (stubbed APIs) covers every feature in the
  checklist: editing keys, toolbar, mentions and search, dates, each formula
  built-in, every view, hover, export/import, reset, persistence, and other
  tabs.
- The CI live job confirms the real APIs.
- A fresh reviewer reviews the branch.
