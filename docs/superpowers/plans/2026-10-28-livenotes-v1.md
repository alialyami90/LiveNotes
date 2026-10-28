# LiveNotes v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Embark-style dynamic outliner, covering Roadmap phases 1–4 in
`CLAUDE.md`: an outline editor with place and date mentions, inline formulas
with live data, and map, calendar and table views.

**Architecture:** Pure TypeScript layers (`model`, `syntax`, `context`,
`formula`) sit under a thin React UI. All network access goes through an
injected `Services` interface. The document is a normalized tree persisted to
localStorage.

**Tech Stack:**

- Vite 8, React 19, TypeScript (strict)
- Vitest 5, @testing-library/react, jsdom
- Leaflet 1.9

**Spec:** `CLAUDE.md` (sections §1–§9)

## Global Constraints

- **Pure layers stay pure.** `model/`, `syntax/`, `context/` and `formula/`
  import neither React nor `fetch`.
- **Errors are values.** Formulas never throw to the UI. Every failure becomes
  `{ kind: 'error', message }`.
- **No fake data in the shipped app.** Fakes appear only in `*.test.ts(x)`.
- **Storage key:** `livenotes:doc:v1`, with saves debounced by 300 ms.
- **Endpoints:** exactly those in spec §5.
- **Gate:** `npm run typecheck && npm test && npm run build` must pass before
  every commit.

## Review Focus

1. **A `{` the user is still typing**, such as `{route(prev`, renders as text
   and does not crash. Covered by a test in Task 2.
2. **A yearless date under a parent with a year in a different year** (for
   example `Jan 2` under `Dec 30 2026`) takes the parent's year, not the
   current year. Covered by a test in Task 3.
3. **`prev` on a first child** falls back to the parent's place, and a missing
   place yields an error chip, not a crash. Covered by a test in Task 5.
4. **Corrupt or old JSON in localStorage** falls back to the sample document
   instead of a blank screen. Covered by a test in Task 1.
5. **Backspace merge into a node that has children** keeps the children and
   loses nothing. Covered by a test in Task 1.

---

### Task 1: Scaffold, model and ops, storage

**Files:**

- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/model/{types,tree,ops,storage,sample}.ts`
- Test: `src/model/ops.test.ts`, `src/model/storage.test.ts`

**Interfaces:**

- **Produces, types:** `Doc`, `OutlineNode`, `Place` and `ViewKind` (spec §3.1).
- **Produces, tree functions:**
  - `parentOf(doc, id): NodeId | null`
  - `visibleOrder(doc): NodeId[]` (depth-first, skips collapsed subtrees)
  - `subtree(doc, id): NodeId[]` (pre-order, excludes `id`)
  - `ancestors(doc, id): NodeId[]` (nearest first, excludes root)
- **Produces, ops:** each returns `{ doc, focus?: { id, caret } }`.
  - `insertAfter(doc, id, text = '')`
  - `splitNode(doc, id, caret)`
  - `indent(doc, id)` and `outdent(doc, id)`
  - `removeOrMerge(doc, id)`
  - `moveUp(doc, id)` and `moveDown(doc, id)`
  - `setText(doc, id, text)`
  - `toggleCollapse(doc, id)` and `setView(doc, id, view | undefined)`
  - `setPlace(doc, key, place)`
- **Produces, storage:** `loadDoc(storage: Pick<Storage, 'getItem'>): Doc` and
  `saveDoc(storage, doc)`.
- **Produces, sample:** `sampleDoc(): Doc`.

- [ ] Step 1: Run `npm init`. Add scripts `dev`, `build`, `typecheck` (`tsc -b --noEmit`) and `test` (`vitest run`). Install deps.
- [ ] Step 2: Write the failing tests:
  - `splitNode at caret 3 of "abcdef" → "abc" + new next sibling "def"`
  - `indent makes node last child of previous sibling; no-op for first child`
  - `outdent moves node to just after its parent; its later siblings stay under the old parent`
  - `removeOrMerge on empty node deletes it and focuses previous visible node at end`
  - `removeOrMerge on non-empty node appends text to previous visible node, caret at join point, and re-parents its children to that node`
  - `ops never mutate input doc` (deep-freeze the input)
  - `loadDoc returns sampleDoc for missing, invalid JSON, or version !== 1`
- [ ] Step 3: Implement. Ids come from `crypto.randomUUID()`.
- [ ] Step 4: Run `npm test`. Expected: PASS.
- [ ] Step 5: Commit `feat(model): document tree, edit ops, storage`.

### Task 2: Tokenizer and date recognition

**Files:**

- Create: `src/syntax/{tokenize,dates}.ts`
- Test: `src/syntax/{tokenize,dates}.test.ts`

**Interfaces:**

- **Produces:**

  ```ts
  type Segment =
    | { kind: 'text'; text: string }
    | { kind: 'place'; key: string; name: string; raw: string }
    | { kind: 'date'; raw: string; month: number; day: number; year?: number }
    | { kind: 'formula'; source: string; raw: string };
  ```

- **Produces:** `tokenize(text): Segment[]` (the concatenated `raw`/`text`
  values equal the input), `parseDateAt(text, i): { len, month, day, year? } | null`,
  and `placeKey(name): string`.

- [ ] Step 1: Write the failing tests:
  - `"arrive @Lisbon, then @[Time Out Market]"` → place segments keyed `lisbon` and `time out market`. The comma stays in the text.
  - `"Nov 3"`, `"3 Nov"`, `"November 3, 2026"` and `"2026-11-03"` all parse as dates. `"Nova"` and `"3 Novels"` do not.
  - `"{route(prev, here)} on Nov 3"` → one formula segment, then a date. The date-like text inside the braces is not a date.
  - `"{route(prev"` → text only (Review Focus 1).
  - Round-trip: the concatenation of the segments equals the input for 6 mixed strings.
- [ ] Step 2: Implement with a single left-to-right scanner. Month names are
  matched as 3-letter or full English names, followed by a word boundary.
- [ ] Step 3: Run the tests. Expected: PASS. Commit `feat(syntax): mentions, dates, formula segments`.

### Task 3: Context resolution

**Files:**

- Create: `src/context/resolve.ts`
- Test: `src/context/resolve.test.ts`

**Interfaces:**

- **Consumes:** `tokenize`, `ancestors` and `parentOf`.
- **Produces:**
  - `type ISODate = string` (`YYYY-MM-DD`)
  - `interface NodeContext { placeKey?: string; date?: ISODate; ownPlaces: string[]; ownDates: ISODate[]; prevPlaceKey?: string }`
  - `resolveContexts(doc, today: ISODate): Map<NodeId, NodeContext>`, a
    single top-down pass that resolves years.

- [ ] Step 1: Write the failing tests:
  - A child with no mentions inherits the parent's place and date.
  - A node's own last place overrides the inherited one.
  - `Jan 2` under `Dec 30 2026` → `2026-01-02`, the parent's year (Review Focus 2; the year comes from the nearest dated ancestor).
  - A yearless date with no dated ancestor uses `today`'s year.
  - `prevPlaceKey` is the previous sibling's effective place. On a first child it is the parent's place (Review Focus 3).
- [ ] Step 2: Implement, run the tests (PASS), and commit `feat(context): inherited place/date`.

### Task 4: Formula lexer, parser and values

**Files:**

- Create: `src/formula/{lexer,parser,values,format}.ts`
- Test: `src/formula/{parser,format}.test.ts`

**Interfaces:**

- **Produces:**

  ```ts
  type Expr =
    | { t: 'num'; value: number; unit?: 'km' | 'm' | 'h' | 'min' | 'd' }
    | { t: 'str'; value: string }
    | { t: 'place'; key: string; name: string }
    | { t: 'date'; iso: string }
    | { t: 'ident'; name: string }
    | { t: 'call'; name: string; args: Expr[] }
    | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: Expr; r: Expr }
    | { t: 'neg'; e: Expr }
    | { t: 'prop'; e: Expr; name: string };
  ```

- **Produces:**
  - `parse(src): Expr | { error: string }`
  - `Value`, the union from spec §4.2:
    - `{kind:'number',value}`
    - `{kind:'duration',seconds}`
    - `{kind:'distance',meters}`
    - `{kind:'speed',mps}`
    - `{kind:'date',iso}`
    - `{kind:'place',place}`
    - `{kind:'string',value}`
    - `{kind:'weather',...Weather}`
    - `{kind:'route',...Route}`
    - `{kind:'error',message}`
  - `formatValue(v): string`

- [ ] Step 1: Write the failing tests:
  - `parse("1 + 2 * 3")` respects precedence.
  - `parse("route(prev, @[Porto Airport]).duration")` → a `prop` wrapping a `call`.
  - `parse("2h + 30min")` produces units.
  - `parse("1 +")` → `{ error }`.
  - `formatValue`: duration 11100 s → `"3h 05m"`, distance 313400 m → `"313 km"`, distance 850 m → `"850 m"`, weather → `"☀️ 21° / 14°"`.
- [ ] Step 2: Implement it as a recursive-descent parser. Run the tests (PASS) and commit `feat(formula): parser and value formatting`.

### Task 5: Evaluator, services and memo

**Files:**

- Create: `src/formula/evaluate.ts`
- Create: `src/services/{types,geo,memo,geocode,weather,routing}.ts`
- Test: `src/formula/evaluate.test.ts`, `src/services/geo.test.ts`

**Interfaces:**

- **Produces:**
  - `Services` (spec §5)
  - `Weather { code; condition; icon; high; low }`
  - `Route { seconds; meters; geometry?: [number, number][] }`
  - `haversine(a, b): meters`
  - `memoize(services): Services`
  - `httpServices(fetchFn = fetch): Services`
  - `interface Env { here?: Place; date?: ISODate; prev?: Place; today: ISODate; lookupPlace(key): Place | undefined }`
  - `evaluate(expr, env, services): Promise<Value>`

- [ ] Step 1: Write the failing tests. They use a fake `Services` that records
  its calls.
  - `{weather()}` uses `env.here` and `env.date`.
  - `{route(prev, here).duration}` returns a duration.
  - `{prev}` with no previous place → an error value whose message is `no previous place` (Review Focus 3).
  - `2h + 30min` = 9000 s.
  - `distance(@Lisbon, @Porto)` uses `lookupPlace`. An unresolved key → error `unknown place: lisbon`.
  - `days(2026-11-03, 2026-11-07)` = 4.
  - `1 + @Lisbon` → error, without throwing.
  - A service that rejects → an error value.
  - `memoize` calls the underlying `route` once for two identical calls.
- [ ] Step 2: Implement. In the weather service, map WMO codes to an icon and
  label, using a small table: 0 clear, 1–3 partly cloudy, 45/48 fog,
  51–67 rain, 71–77 snow, 80–82 showers and 95+ storm. A date outside the
  forecast window → `no forecast yet`.
- [ ] Step 3: Run the tests (PASS) and commit `feat(formula): evaluator with live services`.

### Task 6: Outline editor UI

**Files:**

- Create: `src/main.tsx`, `src/styles.css`
- Create: `src/ui/{App,Outline,NodeRow,NodeEditor,RichText,Chips,NodeMenu}.tsx`
- Create: `src/ui/{store,useFormula,usePlaces,hover}.ts`
- Test: `src/ui/Outline.test.tsx`

**Interfaces:**

- **Consumes:** all of the above.
- **Produces:**
  - `DocProvider` / `useDocStore()`. The store holds `{ doc, focus, dispatch(op) }`
    and `contexts` (memoized `resolveContexts`).
  - `useHover(): [NodeId | null, set]`

- [ ] Step 1: Write the failing UI tests:
  - Typing in a node and pressing Enter creates a second row with focus.
  - Tab indents the row, so it has a nested `ul`.
  - An unfocused node `"Visit @Lisbon"` renders a place chip.
  - Typing `/map` + Enter sets the view, so a `[data-view="map"]` container appears.
- [ ] Step 2: Implement.
  - `usePlaces` geocodes unresolved keys through the services and dispatches
    `setPlace`.
  - `useFormula` evaluates and caches by `(source, context)` key.
  - In the store, `services` defaults to `memoize(httpServices())` and can be
    overridden through a prop for tests.
- [ ] Step 3: Run the tests (PASS), run `npm run build`, and commit `feat(ui): outline editor with mentions and formula chips`.

### Task 7: Views and linked hover

**Files:**

- Create: `src/ui/views/{MapView,CalendarView,TableView}.tsx`
- Modify: `src/ui/NodeRow.tsx` to render `node.view`
- Test: `src/ui/views/views.test.tsx`

**Interfaces:**

- **Consumes:** `subtree`, `contexts`, `doc.places` and `useHover`.
- **Produces:**
  - `collectPlaces(doc, contexts, id): { nodeId, place, index }[]`
  - `collectDates(doc, contexts, id): Map<ISODate, NodeId[]>`
  - Both are pure functions, exported from `src/ui/views/collect.ts`.

- [ ] Step 1: Write the failing tests:
  - `collectPlaces` returns resolved own places in document order and skips unresolved ones.
  - `collectDates` groups nodes by their own dates.
  - `CalendarView` for Nov 3 and Nov 5 renders a November grid with two entries.
  - `TableView` renders one row per child.
- [ ] Step 2: Implement.
  - `MapView` uses Leaflet imperatively in a `useEffect`, with numbered
    `divIcon` markers, a dashed polyline and `fitBounds`. It is excluded from
    the jsdom test.
  - Hovering a row sets the hover store; the matching marker and calendar
    entry get the class `is-hovered`.
- [ ] Step 3: Run the full gate, commit `feat(views): map, calendar, table, linked hover`, and push.
