# Handoff: LiveNotes

Read this whole file before doing anything. It is the state of the project and
the way of working that kept quality high so far. `CLAUDE.md` is the
engineering spec and working agreement; this file is the "where we are and how
we work" layer on top of it.

Last updated: 2026-10-29. The natural-phrases work is finished, reviewed,
integrated and pushed on branch `ccr-0140cca5-y52lpq`, plus one fix from the
live check (a city's extent no longer shrinks its area, §1).

**Open:**

- `geocode('lisbon')` from CI returns Photon's Lisbon *district* (38.995,
  kind `region`) instead of Open-Meteo's city (38.725). It started with the
  kinds commit, but that commit only parses, so the cause is probably Open-Meteo
  answering the app's `count=1` request differently. The live check now logs
  that raw request (`[om-app lisbon]`): read it on the next run and fix from
  there.

---

## 1. Where things stand

### Done and shipped (on the branch, pushed, CI green)

1. **The single-note app**, an Embark-style outline with:
   - mentions, context inheritance and formulas
   - map, calendar and table views
   - the phone toolbar
   - a debug APK built by GitHub Actions (CLAUDE.md §1–§11)
2. **The notes library**, built over 8 planned tasks plus a final review and
   fixes:
   - a Timeline home with pinned, upcoming buckets on a date rail, recent
     notes, search, archive and delete with undo
   - a note screen with a title and a ⋯ menu
   - per-note storage, with migration from the old single document
   - the Android back button
   - storage-full handling
   - the visual system (Fraunces and Instrument Sans bundled, tokens,
     `DESIGN.md`)

   Spec: `docs/superpowers/specs/2026-10-29-notes-library-design.md`. Plan:
   `docs/superpowers/plans/2026-10-29-notes-library.md`. CLAUDE.md §12
   describes the result.

The APK is at
https://github.com/alialyami90/LiveNotes/releases/download/android-latest/livenotes-debug.apk

### Built, final review done, fix wave applied: natural-language routes and weather, place kinds, area search

Spec (approved by the owner):
`docs/superpowers/specs/2026-10-29-natural-phrases-and-area-search-design.md`.
Plan: `docs/superpowers/plans/2026-10-29-natural-phrases-and-area-search.md`.
All 8 tasks are implemented and passed their per-task reviews (Tasks 1, 4, 6, 7
and 8 after one fix round). The final whole-branch review ran, its fix wave is
applied, and the scoped re-review found every finding addressed. The ledger
folder was removed at the end; git history and this file are the record.

**After the push, the live check found:** Photon gives a city its municipal
boundary as `extent`, and Barcelona's ends just north of El Prat. With the
extent used as the area, "@airport" under a Photon-resolved Barcelona listed El
Prat under Elsewhere. `areaOf` now grows the 30 km box to cover the extent
instead of replacing it (CLAUDE.md §5).

What shipped (CLAUDE.md §3.2, §4.3, §5, §6, §7 describe it):

- **Phrases** (`syntax/phrases.ts`, `scan.ts`): "weather"/"forecast" and
  "<mode> to @X" / "<mode> from @A to @B" are recognised in plain text. Whole
  words only, never inside URLs, emails, compounds or possessives. `\weather`
  escapes. A bullet whose formula already calls `weather(` (or `route(` /
  `travel(`) keeps those phrase words plain, so old notes show one chip. A
  later "to @X" in a bullet starts from the route before it (chained routes).
- **`travel` built-in** (`formula/travel.ts`): drive (OSRM), walk and bike
  (≈, from the road distance, error over 100 km), transit (distance plus a
  Google Maps Directions link), fly (great circle, offline). Phrases run as
  synthetic formulas, so pending, errors and memoising are shared.
- **Chips:** weather chips replace the word (a bullet with no place or no
  date keeps the plain word, with a tooltip); travel chips follow the
  destination with a 4px gap; a Travel column in the table view.
- **Travel-mode popup** (`ui/ModePicker.tsx`, `ui/useModePicker.ts`): after a
  pick or a typed boundary character in "to @X" with no mode word. It opens
  with no row selected: Enter, Tab and Shift+Tab then dismiss it and do their
  normal job; ↓/↑ or a moving pointer select a row. It writes the mode word
  into the text.
- **Place kinds** (`services/kinds.ts`): `Place.kind` and `Place.extent`,
  icons on chips, picker rows and map tooltips.
- **Area search** (`services/http.ts`, `rank.ts`): search and geocode inside the
  parent place's area first; the picker's "Elsewhere" divider; staged
  `onUpdate`. A nearby Open-Meteo town beats an in-area namesake (`@Sitges`
  under Barcelona is the town). No guessed place is stored after a transient
  failure: if Open-Meteo fails, or the area stage fails and the worldwide
  result lies outside the area, geocode throws `TransientError` and retries.
  A region parent without an extent has no area.
- **Sample note:** "— drive from @Lisbon to @Porto" and "Porto weather" replace
  the formulas that showed the same facts. Its places carry kinds, so it shows
  icons, and its "How this works" bullet and the editor legend mention the
  plain-word phrases.
- **Browser check:** `scripts/e2e.cjs` reads its port from `E2E_PORT`; its
  stubs model Photon's `bbox`, `osm_key`/`osm_value`/`extent` and Open-Meteo's
  population and feature codes.

Verification on the branch:

- typecheck clean
- **749** unit/UI tests pass (12 live tests skipped); the test output is
  clean
- build OK
- the browser check passes **80/80** on desktop and Pixel 7, light and dark
- the Android APK workflow is green; `live-check.yml` went red once on the
  extent finding above, which the area fix addresses

### Next steps, in order

1. Confirm `live-check.yml` is green after the area fix, and read
   `[om-app lisbon]` in its log to settle the Lisbon item above.
2. Raise the open owner items in §5.
3. Deferred to a later wave: combobox ARIA wiring on the textarea, PPLX →
   neighbourhood, the ±180° wrap, the test-strength items, `keepEditorFocus`
   dedupe, `travel()` mode case sensitivity, the popup opening in a bullet
   that already has a `{route()}` formula, and the rare stored namesake after
   an area-stage outage (an Open-Meteo town within 75 km should skip the area
   stage).

---

## 2. Standing rules (from the owner and the environment)

- **Branch:** work and push only on `ccr-0140cca5-y52lpq`. It is the repo's
  only and default branch; there is no `main`. **Never open a pull request
  unless the owner asks.**
- **Commits:** end every commit message with exactly these two lines:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JD6t85Z4ycYStp5C55ag6T
  ```

  Put no model names or identifiers anywhere else in the repo: not in code,
  docs or commit bodies.
- **Gate before every commit:** `npm run typecheck && npm test && npm run build`.
  All three must pass, with clean test output (no warnings and no stray
  console). Silence expected `console.warn` in tests with
  `vi.spyOn(console, 'warn').mockImplementation(() => {})`.
- **Push** after work lands. A stop hook complains about unpushed commits and
  uncommitted files. Don't commit a running agent's half-done files to satisfy
  it. Explain instead.
- **The owner's email** is for identification only. Never put it in requests
  or files.
- **Asking the owner:** ask design questions **one at a time**, multiple
  choice, using AskUserQuestion with previews. Read their answers literally:
  twice they answered with something other than the offered options, and the
  design followed what they actually said.
- **UI work:** the owner asked for the **impeccable** skill to guide UI. It is
  at `/root/.claude/skills/synced/4e2dc224-d394-49b0-8222-9d113b5fe122_8b5be831-bcab-4458-b0df-39284bbce347/impeccable/`.
  Run its scripts with `sh <dir>/scripts/impeccable …`, not by executing them
  directly. `PRODUCT.md` and `DESIGN.md` are its context files, and
  `impeccable detect --json <paths>` is the CSS lint.
- **Network:** the sandbox cannot reach Open-Meteo, Photon, OSRM or the Android
  SDK hosts. Tests use fakes; the browser check stubs the APIs. Real API
  behaviour is checked only by `live-check.yml` in CI (`LIVE_SERVICES=1`).
  Never substitute fake data in the shipped app.
- **Free stack only.** The owner chose to stay on free, keyless APIs. Google
  Maps is a recorded later phase that needs their API key (library plan, "Later
  phase").

---

## 3. How the work was run (keep doing this)

The owner wants quality *and* speed. This process gave both:

1. **Superpowers flow:** brainstorming → spec → writing-plans → subagent-driven
   development → final review → finishing-a-development-branch.
2. **Ledger.** Each plan gets a workspace from
   `bash <sdd>/scripts/sdd-workspace PLAN` (git-ignored,
   `.superpowers/sdd/<plan>/`). It holds `progress.md` (the ledger), the task
   briefs, the reports and the review diffs. Write every decision into the
   ledger as `Ruling: what — why — cost if wrong`. After a context compaction,
   trust the ledger and `git log`, not memory.
   - `<sdd>` = `/root/.claude/plugins/synced/4e2dc224-d394-49b0-8222-9d113b5fe122_8b5be831-bcab-4458-b0df-39284bbce347/6ba53849-2ee0-4cf0-957e-31c122ea1dd1/skills/subagent-driven-development`
   - Scripts there: `task-brief PLAN N` (extracts one task to a brief file),
     `review-package PLAN BASE HEAD` (writes the diff file for a reviewer),
     `sdd-workspace PLAN`.
   - Prompt templates: `implementer-prompt.md`, `task-reviewer-prompt.md`,
     `re-review-prompt.md`, and `../requesting-code-review/code-reviewer.md`
     for the final review.
3. **Pre-flight scan.** Before Task 1, write a table to the ledger of every
   cross-task interface and every task's self-consistency, and rule on each
   conflict.
4. **Per task:**
   1. An implementer subagent gets the brief path, the interfaces from earlier
      tasks, your rulings, and a report-file path.
   2. A **separate reviewer** subagent gets the brief, the report and the diff
      file. It returns spec compliance plus quality.
   3. Fix rounds go back to the same implementer (`SendMessage` to its id).
   4. A scoped re-review follows each fix round.

   Never skip the review. Never let an implementer spawn reviewers.
5. **Parallelism** (the owner asked for it):
   - Run tasks with disjoint file sets at the same time, each in its own git
     worktree (Agent tool `isolation: "worktree"`).
   - Integrate one at a time onto the branch by cherry-pick, or by
     fast-forward after the agent rebases onto `ccr-0140cca5-y52lpq`. Run the
     full gate after each.
   - Before integrating, dry-run with `git merge-tree --write-tree --name-only HEAD <sha>`.
   - Tell each agent exactly which files it owns and which ones other agents
     are editing.
   - Split a task into "a" (pure or presentational) and "b" (wiring) when that
     unlocks parallel work.
6. **Worktree gotchas:**
   - Worktree agents cannot write into the main checkout's `.superpowers/`.
     They leave reports in their worktree. Copy them across yourself with
     `cp .claude/worktrees/agent-<id>/.superpowers/sdd/<plan>/<report> .superpowers/sdd/<plan>/`.
   - If `node_modules` is missing in a worktree, tell the agent to run
     `ln -s /home/user/LiveNotes/node_modules node_modules`. If the agent runs
     `npm install`, it replaces the symlink. Run `npm install` in the main
     checkout after integrating any dependency change.
   - `vite.config.ts` limits vitest to `src/**/*.test.{ts,tsx}`, so
     `.claude/worktrees/` is never collected.
   - `.claude/worktrees` is git-ignored. Never `cd` into a worktree in your
     own shell: it changes your session's working directory. Use absolute
     paths, e.g. `cd /home/user/LiveNotes && …`.
7. **Models:** always pass `model` explicitly.
   - **sonnet** for well-specified implementation and most reviews.
   - **opus** for design-heavy, subtle or cross-cutting work: store and
     routing changes, visual system, final review, data-safety re-reviews.
8. **Reviews found real bugs every time.** Examples:
   - a back-button loop
   - `updatedAt` bumped by geocoding
   - a phone layout wider than the screen
   - a hidden crash-screen button
   - a deleted legacy note coming back

   Keep reviewers adversarial. Ask them to trace data-loss paths explicitly,
   and to reproduce with scratch tests in the scratchpad.
9. **Before claiming done:**
   1. Run the gate.
   2. Run the browser check (below).
   3. Look at a screenshot yourself.
   4. Push.
   5. Confirm the GitHub Actions run (`mcp__github__actions_list` with
      `list_workflow_runs` and branch filter `ccr-0140cca5-y52lpq`).

### Browser check

```
npm run build
npx vite preview --port 4176 --strictPort &      # keep its PID; stop it by PID (never pkill -f)
node scripts/e2e.cjs <out-dir>                   # screenshots + results.json; exit code 1 on any failure
```

If 4176 is taken (see §5), serve on another port and pass it in `E2E_PORT`:
`npx vite preview --port 4191 --strictPort &` then
`E2E_PORT=4191 node scripts/e2e.cjs <out-dir>`. Run the preview from the
checkout you are testing, so it serves that build.

Chromium and Playwright are preinstalled (`require('playwright')` works; don't
run `playwright install`). Full-page screenshots switch off touch emulation,
which is why the script takes them last. Add checks for every new
user-visible behaviour.

---

## 4. Decisions to respect (from the library work)

Don't re-litigate these without a new reason:

- **Pure layers** have no React and no `localStorage`/`fetch`: `model`,
  `syntax`, `context`, `formula`, and `library` (everything except
  `LibraryProvider.tsx`). Storage is injected.
- **`updatedAt` changes only on user edits** (text, title, structure, view,
  collapsed). Place-cache writes don't touch it.
- **Redirects use replace navigation.** The note screen's Back and Delete use
  `goBack()`. Android back goes through the same router.
- **Undo window:**
  - 6 s, or until the app hides, a second delete happens, or another note is
    opened.
  - Purge removes only this tab's pending delete.
  - Focus never leaves a field the user is typing in.
- **Legacy key `livenotes:doc:v1`:**
  - It is adopted as a note marked `legacy: true`.
  - Deleting that note removes the key.
  - An identical unmarked note is claimed instead of copied.
  - Construction never throws.
- **Storage full:**
  - A failed save stays dirty and shows a banner.
  - Home alerts once.
  - A delete that cannot be written offers a permanent remove.
- **Pinned notes** show only as chips and are unpinned from the note's menu.
  The owner accepted this.
- **The editor mirror overlay** must stay metric-identical to the textarea:
  highlights change only colour and background.
- **Touch targets** are at least 44 px. Nothing works only on hover.
- **Parked and accepted gaps:**
  - A typed (not picked) mention's geocode result is lost if the note is left
    immediately. The sketch appears after reopening.
  - The index grows with full-text search copies, which is fine at the current
    scale.
  - A pre-library browser tab writing the legacy key after migration has those
    writes discarded. There is no hosted web build, and Android is unaffected.
  - `top`-based screen animation, documented in DESIGN.md.
  - The keyCode 229 guard in NodeEditor.
  - An index rebuild drops pinned, archived and deletedAt.

---

## 5. Open items for the owner

- **Check the Android back button on a real phone:** back from a note goes
  home; back from home exits. It is unit-tested but not tried on a device.
- **Small visual choices left to the owner:**
  - The wordmark is set in Fraunces; it is a one-line revert in
    `src/styles/chrome.css`.
  - impeccable suggested `PRODUCT.md` Platform `android` instead of `web`.
    This is unchanged.
- **Agent worktrees** under `.claude/worktrees/` from the library and phrases
  rounds can be removed with `git worktree remove` (check `git -C <wt> status`
  first). They hold only copies of work already on the branch.

From the natural-phrases work:

- **Try the popup and the Directions link on a real phone** (Gboard). Check
  that typing "to @porto " opens the popup (Gboard may commit the space
  while composing, or autocorrect may commit word and space at once; then it
  won't open, though picking from the place picker still does), that tapping a
  row keeps the keyboard up, and that "Directions ↗" opens Maps or the browser
  from the APK.
- **The weather word becomes the chip (I2).** The fix wave keeps the owner's
  choice that "the word becomes a chip" when there is a forecast to show, and
  shows the plain word (with a tooltip) when the bullet has no place or no
  date. Open question for the owner: keep that, or switch to "keep the word
  and add the chip after it"?
- **A stray `vite preview` on port 4176** from an earlier session (cwd the main
  checkout) still runs. It serves an old build. Stop it by PID, or keep using
  `E2E_PORT`.

---

## 6. File map for the natural-phrases feature

Where each part lives, for the final review and later changes:

- **Phrases:**
  - `src/syntax/scan.ts` finds places, dates, formulas and escapes, and holds
    `Segment` and `placeAt`.
  - `src/syntax/phrases.ts` holds `MODES`, the phrase word rules,
    `recognizePhrases`, `routeWithoutMode` and `insertModeWord`.
  - `src/syntax/tokenize.ts` is `recognizePhrases(scan(text))` plus
    `displayText`. `plain.ts` keeps weather words and drops routes.
- **Context:** `src/context/resolve.ts` gives `prevKey` and
  `inheritedPlaceKey`, unchanged.
- **Formulas:**
  - `src/formula/travel.ts` has `travel`, `directionsUrl` and `phraseSource`.
  - `evaluate.ts` has the `travel` built-in and `.distance`/`.duration`.
  - `values.ts` has the `travel` value; `format.ts` has the chip strings and
    `TRAVEL_ICON`.
- **Services:**
  - `src/services/http.ts`: `openMeteo()`, `photon()` (with `bbox`), the queue,
    `geocode` (area first, transient rules) and staged `search` with
    `onUpdate`.
  - `rank.ts`: `mergeSearch`, `areaPick` (the area step), `isNear`, `isMajor`, `toPlace`.
  - `geo.ts`: `haversine`, `areaOf`, `searchArea` (none for a region without extent), `inArea`.
  - `wmo.ts`: weather codes to condition and icon.
  - `kinds.ts`: `kindOfPhoton`, `kindOfOpenMeteo`, `isStreetTag`,
    `photonExtent`, `placeIcon`.
  - `types.ts`: `Services`, `Found`, `SearchOptions`.
  - `services.test.ts` (fake fetch) and `live.test.ts` (live check).
- **Editor:**
  - `src/ui/NodeEditor.tsx`: the mirror (`.hl-mode`, `.hl-weather`), the
    picker and popup wiring, and the IME guards.
  - `ModePicker.tsx` and `useModePicker.ts`: the travel-mode popup.
  - `PlacePicker.tsx` and `usePlaceSearch.ts`: the picker, its sections and
    the Elsewhere divider.
- **Chips:** `src/ui/RichText.tsx` (phrase segments) and `Chips.tsx` (icons,
  the travel chip and its Directions link).
- **Views:** `src/ui/views/TableView.tsx` (Travel column) and `MapView.tsx`
  (marker tooltip icons).
- **Styles:** `src/styles/chips.css` (`.chip-place::before`, `.chip-link`),
  `touch.css` (picker, divider, popup, 44 px rules) and `outline.css`
  (`.hl-*`). Read `DESIGN.md` before changing styles.
- **Model:** `src/model/types.ts` (`Place.kind`, `Place.extent`,
  `PlaceKind`) and `src/model/sample.ts`.
- **Browser check:** `scripts/e2e.cjs` (`phraseFlow`, `phraseShots`, the
  stubs).
