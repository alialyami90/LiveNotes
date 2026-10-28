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

The app is **local-first**: the document lives in the browser, and the only
network calls are to free, keyless data APIs.

**Rule of isolation:** `model/`, `syntax/`, `context/` and `formula/` are pure
TypeScript with **no React and no `fetch`**. Everything that touches the network
goes through the `Services` interface, so tests inject fakes. UI components stay
thin.

### 2.1 Directory layout

```
src/
  model/      types.ts  tree.ts (parent index, traversal)  ops.ts (pure edits)
              reducer.ts  storage.ts  sample.ts (seed trip doc)
  syntax/     tokenize.ts (text → segments)  dates.ts (date recognition)
  context/    resolve.ts (effective place/date per node)
  formula/    lexer.ts  parser.ts  evaluate.ts  values.ts  format.ts
  services/   types.ts  geocode.ts  weather.ts  routing.ts  geo.ts  memo.ts
  ui/         App.tsx  Outline.tsx  NodeRow.tsx  NodeEditor.tsx  RichText.tsx
              Chips.tsx  NodeMenu.tsx  hover.ts  useFormula.ts  usePlaces.ts
              views/MapView.tsx  views/CalendarView.tsx  views/TableView.tsx
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
| `date` | `2026-11-03`, `Nov 3`, `3 Nov`, `November 3, 2026`, `Nov 3 2026` | Without a year, the year comes from the nearest ancestor date, else the current year (resolved in `context/`). |
| `formula` | `{ … }` | Braces nest-count. An unclosed `{` is plain text. |
| escape | `\@`, `\{` | Stays literal text (backslash hidden when rendered by `displayText`). |

Text inside `{…}` is formula source and is **not** scanned for date mentions.
Inside a formula, `@Name` is a place literal.

### 3.3 Context inheritance (`context/resolve.ts`)

Each node has an **effective context** `{ place?, date? }`:

- `place` is the **last** place mentioned in the node's own text. If the node has
  none, it inherits the parent's effective place.
- `date` follows the same rule. This also supplies the year for yearless dates.

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
  geocode(name: string): Promise<Place | null>;
  weather(p: Place, isoDate: string): Promise<Weather>;
  route(a: Place, b: Place): Promise<Route>;
}
```

| Service | Endpoint (all free, no API key) |
|---|---|
| Geocoding | `https://photon.komoot.io/api/?q=…&limit=1` (OSM-based Photon: finds points of interest like "Belém Tower", not just towns) |
| Weather | `https://api.open-meteo.com/v1/forecast?latitude&longitude&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date&end_date` |
| Routing | `https://router.project-osrm.org/route/v1/driving/{lon,lat};{lon,lat}?overview=full&geometries=geojson` |
| Map tiles | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with OSM attribution shown |

Rules:

- Failures surface as `error` values or chips. **Never substitute fake data** in
  the shipped app. Fakes exist only in tests.
- Geocoding results are written into `doc.places` (one network hit per name,
  ever). Mentions in the row being edited are geocoded only after it loses
  focus, so half-typed names (`@Lis`) are never looked up.
- Formulas get places through an async `resolvePlace(key)`, so a formula is
  simply *pending* while its place is being geocoded.
- `memo.ts` deduplicates in-flight and completed calls for the session.

---

## 6. Views (`ui/views/`)

A view is attached to a node (`node.view`) and renders that node's **subtree**
directly beneath it. The user toggles it with the row's hover buttons
(🗺️ 📅 ▦), or by ending the node's text with `/map`, `/calendar`, `/table`
or `/none` and pressing Enter. The command is stripped from the text.

| View | Shows |
|---|---|
| **Map** | One numbered marker per resolved place mention in the node and its subtree, in document order. Markers are joined by a dashed line in visit order, and the map fits its bounds. Clicking a marker focuses its node. |
| **Calendar** | A Monday-first grid covering only the weeks between the first and last date in the subtree. Each day lists the nodes whose *own* text mentions that date, with the date itself stripped from the label. Clicking an entry focuses the node. |
| **Table** | One row per direct child: text (rendered, without formulas), place, date, then one column per formula in that row. A light, grid-like lens on the list. |

**Linked hover (`ui/hover.ts`).** A tiny shared store holding the hovered
`NodeId`. Hovering a node row highlights its marker and calendar entry. Hovering
a marker or entry highlights the row.

---

## 7. Editor behavior (`ui/`)

- **Focused node:** raw text in an auto-growing `<textarea>`, showing the real
  `@`/`{}` source.
- **Unfocused node:** `RichText`. Places become chips (dashed while unresolved,
  red if not found), dates become chips, and formulas become result chips. The
  raw formula appears on hover.
- **Keys:**
  - `Enter` splits the node at the caret, or creates a new sibling.
  - `Tab` and `Shift+Tab` indent and outdent.
  - `Backspace` on an empty node deletes it. At the start of a non-empty node,
    it merges into the previous visible node.
  - `↑` and `↓` on the first or last line move focus between nodes.
  - `Alt+Shift+↑` and `Alt+Shift+↓` move the node.
  - `Ctrl/Cmd+.` toggles collapse.
- **Bullets:** clicking the bullet collapses or expands. A small triangle shows
  that hidden children exist.
- **Persistence:** saves are debounced (300 ms) to `localStorage["livenotes:doc:v1"]`.
  The header has Export/Import JSON buttons and a "Reset to sample" button.
- **First launch:** seeds a sample Portugal trip from `model/sample.ts` that
  exercises every feature.

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
- Network APIs are never hit in tests.

## 9. Conventions

- TypeScript `strict`. No `any` in pure layers. Discriminated unions for
  `Segment`, `Expr` and `Value`.
- Pure functions return new objects. The model is never mutated in place.
- Small files with one purpose each. If a file passes about 250 lines, split it.
- Comments explain *why*, not *what*.
- CSS lives in `styles.css` with CSS variables, and supports light and dark via
  `prefers-color-scheme`.

## 10. Roadmap

1. **Foundation:** scaffold, model and ops, outline editor, persistence, sample
   doc.
2. **Mentions:** tokenizer, date recognition, place chips with geocoding,
   context resolution.
3. **Formulas:** lexer, parser and evaluator, built-ins, live result chips.
4. **Views:** map, calendar, table, linked hover.
5. *Later:*
   - Document-level undo.
   - Re-pick a place from candidates.
   - Side-panel (pinned) views.
   - Date ranges ("Nov 3–5") as calendar spans.
   - Sync via Automerge for true local-first collaboration.
   - Live transit or walking routes.
