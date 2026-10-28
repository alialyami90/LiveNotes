# LiveNotes Android APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship LiveNotes as a sideloadable debug APK built by GitHub Actions,
with the phone essentials from spec §11.

**Architecture:** Capacitor 8 wraps `dist/` in a WebView. Platform differences
stay in `src/platform/` and CSS. CI builds the APK because the sandbox has no
Android SDK.

**Tech Stack:**

- Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`,
  `@capacitor/filesystem`, `@capacitor/share`)
- GitHub Actions, with JDK 21 and Gradle (via the wrapper from the Capacitor
  template)

**Spec:** `CLAUDE.md` §11

## Global Constraints

- appId `com.livenotes.app`, appName `LiveNotes`, webDir `dist`.
- No fake data. Services are unchanged.
- Gate before every commit: `npm run typecheck && npm test && npm run build`.

## Review Focus

1. **Toolbar buttons tapped while editing** must not blur the editor (the
   keyboard would collapse). Covered by a test in Task 2.
2. **Export on web** must keep the download behaviour. Covered by a test in
   Task 3.
3. **Toolbar actions keep the caret** in the moved or indented row. Covered by
   a test in Task 2.
4. **The toolbar is hidden when nothing is focused.** Covered by a test in
   Task 2.
5. **The CI workflow fails loudly** if tests fail, before Gradle runs. This is
   enforced by step order in Task 4.

---

### Task 1: Capacitor scaffold

**Files:**

- Create: `capacitor.config.ts`, `android/` (via `npx cap add android`)
- Modify: `package.json` (deps and the `android:build` script), `.gitignore`,
  `index.html` (`viewport-fit=cover`)

- [ ] Install the deps.
- [ ] Write the config.
- [ ] Run `npm run build && npx cap add android`.
- [ ] Verify `android/gradlew` and `android/app/src/main/assets/public/index.html` exist.
- [ ] Commit `build: wrap the web app with Capacitor for Android`.

### Task 2: Phone editing toolbar

**Files:**

- Create: `src/ui/MobileToolbar.tsx`
- Modify: `src/ui/App.tsx`, `src/styles.css`
- Test: `src/ui/MobileToolbar.test.tsx`

**Interfaces:**

- **Produces:** `MobileToolbar({ forceVisible?: boolean })`. It renders only
  when `focus` is set and either `(pointer: coarse)` matches or `forceVisible`
  is true.
- **Buttons**, each with an `aria-label`:
  - `Outdent`
  - `Indent`
  - `Move up`
  - `Move down`
  - `Collapse`
  - `Delete bullet`

- [ ] Write the failing tests:
  - Hidden with no focus.
  - Indent nests the focused row, and focus stays on it.
  - Pressing a button does not blur the textarea (`fireEvent.mouseDown` returns `false`, meaning default prevented).
  - Delete bullet removes the row and focuses the previous one.
- [ ] Implement it.
- [ ] Run the tests (PASS) and commit.

### Task 3: Native export

**Files:**

- Create: `src/platform/export.ts`
- Modify: `src/ui/App.tsx`
- Test: `src/platform/export.test.ts`

**Interfaces:**

- **Produces:**
  - `exportDocument(json: string, deps?: ExportDeps): Promise<void>`
  - `ExportDeps = { isNative(): boolean; writeCache(name, data): Promise<string /*uri*/>; share(uri, title): Promise<void>; download(name, data): void }`
- **Default deps** wrap Capacitor, `Filesystem` and `Share`.

- [ ] Write the failing tests:
  - native → writes `livenotes.json`, then shares that URI
  - web → download only
- [ ] Implement it, run the tests (PASS) and commit.

### Task 4: Touch polish and CI

**Files:**

- Modify: `src/styles.css`, `src/ui/views/MapView.tsx`
- Create: `.github/workflows/android.yml`

- [ ] CSS:
  - `(hover: none)` shows the row menus
  - safe-area padding
  - toolbar styles
- [ ] Map: `dragging: !L.Browser.mobile`.
- [ ] Workflow with these steps, in order:
  1. checkout
  2. node 22, then `npm ci`
  3. typecheck, then test, then build
  4. `cap sync android`
  5. JDK 21
  6. `assembleDebug`
  7. upload the artifact
  8. update the rolling `android-latest` pre-release
- [ ] Run the gate, commit and push.
- [ ] Watch the workflow run until it is green.
