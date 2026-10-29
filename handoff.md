# Handoff: LiveNotes

Read this whole file before doing anything. It is the state of the project and
the way of working that kept quality high so far. `CLAUDE.md` is the
engineering spec and working agreement; this file is the "where we are and how
we work" layer on top of it.

Last updated: 2026-10-29, at commit `52230d4` (then the commit adding this
file) on branch `ccr-0140cca5-y52lpq`.

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

Verification at the last code commit (`560979f`):

- typecheck clean
- 493 unit/UI tests pass (9 live tests skipped)
- build OK
- the browser check (`scripts/e2e.cjs`) passes **57/57** on desktop and Pixel 7,
  light and dark
- the Android APK workflow is green, including the `@capacitor/app` back-button
  plugin

The APK is at
https://github.com/alialyami90/LiveNotes/releases/download/android-latest/livenotes-debug.apk

### In progress: natural-language routes and weather, place kinds, area search

- **Spec written and committed. It is waiting for the owner to review it:**
  `docs/superpowers/specs/2026-10-29-natural-phrases-and-area-search-design.md`
- All design questions were answered by the owner, one at a time (spec §1
  records each answer).
- **No plan has been written and no code changed yet.**

### Next steps, in order

1. **Get the owner's approval of the spec.** Ask them to review the file. If
   they request changes, edit the spec, re-run the self-review (no TBDs, no
   contradictions, no ambiguity) and commit. Do not start planning before an
   explicit approval of the written spec. The superpowers brainstorming gate
   requires this.
2. Invoke `superpowers:writing-plans` to write
   `docs/superpowers/plans/2026-10-29-natural-phrases-and-area-search.md`.
   Use the same structure as the library plan: Global Constraints, Review
   Focus, and tasks with Interfaces blocks and tests. A sensible task split,
   each owning disjoint files so they can run in parallel:
   - **T1** `syntax/phrases.ts` + tokenizer segments + escapes (pure, TDD).
   - **T2** `services/kinds.ts` + `Place.kind`/`extent` + Photon and
     Open-Meteo parsing (pure, TDD).
   - **T3** `formula/travel.ts` + the `travel` value + `format.ts` strings +
     wiring segments into evaluation (depends on T1).
   - **T4** Area search and geocode order in `services/http.ts`, with
     `onUpdate` staging (depends on T2).
   - **T5** Chips and highlighting: RichText, Chips, mirror colours, icons on
     chips, the table "Travel" column (depends on T1, T2, T3).
   - **T6** The mode popup, `ModePicker` + `useModePicker`, wired into
     NodeEditor (depends on T1).
   - **T7** Place picker: icons and the "Elsewhere" divider (depends on T2,
     T4).
   - **T8** Browser checks added to `scripts/e2e.cjs`, live-check cases in
     `src/services/live.test.ts`, and doc updates (CLAUDE.md §1, §3–§7,
     PRODUCT.md, DESIGN.md).
3. Ask the owner to choose the execution method (subagent-driven or native).
   Last time they chose **subagent-driven** and asked for **parallel subagents
   to speed things up**. Expect the same, but ask.
4. Execute with `superpowers:subagent-driven-development` (see §3).
5. Final whole-branch review on the most capable model, then one fix round and
   a scoped re-review.
6. Push, confirm CI (APK and live check), update the docs, then
   `superpowers:finishing-a-development-branch`.

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
- **Agent worktrees** under `.claude/worktrees/` from the library round can be
  removed with `git worktree remove` (check `git -C <wt> status` first). They
  hold only copies of work already on the branch.

---

## 6. File map for the new feature

The new feature will touch these existing files. Read them first.

- **Tokenizer:**
  - `src/syntax/tokenize.ts` holds `Segment`, `placeAt`, the escapes and
    `displayText`.
  - `src/syntax/dates.ts` is the model for word-level recognition.
- **Context:** `src/context/resolve.ts` gives the effective place and date,
  `prevKey`, `inheritedPlaceKey` and `ownPlaces`.
- **Formulas:**
  - `src/formula/evaluate.ts` has the built-ins `weather`, `route`, `prev`, and
    `FORECAST_DAYS`.
  - `values.ts` and `format.ts` hold the value types and chip strings.
- **Services:**
  - `src/services/http.ts` contains `openMeteo()`, `photon()`, the queue,
    `geocode`, `search` with `onTowns`, and the `isNear`/`isMajor` rules.
  - `types.ts` is the `Services` interface.
  - `services.test.ts` holds the fake-fetch tests.
  - `live.test.ts` is the live check.
- **Editor:**
  - `src/ui/NodeEditor.tsx` covers the mirror, the picker wiring, and the IME
    composition guards.
  - `PlacePicker.tsx` and `usePlaceSearch.ts` are the picker.
  - `syntax/mention.ts` finds the mention under the caret.
- **Chips:**
  - `src/ui/RichText.tsx` renders the read view.
  - `Chips.tsx` holds the place, date and formula chips, the error popover
    portal, and the `.chip-wrap` hit area.
  - `useFormula.ts` re-evaluates formulas.
- **Views:** `src/ui/views/TableView.tsx` (Travel column) and `collect.ts`.
- **Styles:**
  - `src/styles/chips.css` holds `.chip-place::before`, which has the 📍 and
    word joiner.
  - Tokens are in `src/styles/tokens.css`.
  - Read `DESIGN.md` before changing styles.
- **Model:** `src/model/types.ts` (`Place`) and `src/model/storage.ts`
  (`isDoc` validation).
