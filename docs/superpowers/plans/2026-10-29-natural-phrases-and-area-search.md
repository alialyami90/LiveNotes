# Natural Phrases and Area Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Routes and weather written as plain words ("weather", "drive to
@Porto"), with a travel-mode popup, place-kind icons, and place search that
looks inside the parent bullet's place first.

**Architecture:**
- A post-pass in the tokenizer (`syntax/phrases.ts`) turns words into new
  segments. Each phrase segment becomes a synthetic formula source
  (`weather()`, `travel("walk", prev, @[porto])`), so chips, pending states,
  memoisation and "wait for the mention's lookup" reuse the formula engine
  unchanged.
- `services/kinds.ts` maps Photon and Open-Meteo data to a `PlaceKind`, which
  is stored on `Place` together with an optional `extent`.
- `services/http.ts` gains a bbox ("inside the area") Photon stage for both
  `search` and `geocode`.

**Tech Stack:** React 19, TypeScript (strict), Vite 8, Vitest 5 and Testing
Library, Playwright (browser check). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-natural-phrases-and-area-search-design.md`
is the binding authority, plus `CLAUDE.md`, `PRODUCT.md` and `DESIGN.md`.

## Global Constraints

- **Mode words** (spec §2.2). The first word in each list is the one the popup
  writes:
  - drive: drive, driving, car, taxi
  - walk: walk, walking
  - transit: transit, train, bus, metro, tram
  - bike: bike, cycle, cycling
  - fly: fly, flight
- **Weather words:** `weather`, `forecast`. All phrase words are whole-word and
  case-insensitive.
- **Popup rows, fixed order:** 🚗 Drive · 🚶 Walk · 🚆 Public transport ·
  🚲 Bike · ✈ Fly.
- **Speeds:** walk 4.8 km/h, bike 15 km/h. Walk or bike over **100 km** gives
  the error `too far to walk` / `too far to cycle`.
- **Chip copy:**
  - drive: `🚗 3h 05m · 313 km`
  - walk: `🚶 ≈ 1h 10m · 5.8 km`
  - bike: `🚲 ≈ 25 min · 6.1 km`
  - transit: `🚆 313 km`, and the chip appends ` · ` plus a link `Directions ↗`
  - fly: `✈ 503 km`

  Durations and distances use the existing `formatDuration` and
  `formatDistance`.
- **Directions URL:**
  `https://www.google.com/maps/dir/?api=1&origin=<lat>,<lon>&destination=<lat>,<lon>&travelmode=transit`
- **Area:** `extent` is `[west, south, east, north]`. Without a valid extent,
  use a box reaching **30 km** from the place in each direction. Photon `bbox`
  is `west,south,east,north`. Photon's own `properties.extent` is
  `[west, north, east, south]` and must be reordered.
- **Picker caps:** at most 4 saved, 8 inside and 8 elsewhere rows. The
  divider text is `Elsewhere`.
- `Doc.version` stays 1. `Place.kind` and `Place.extent` are optional, and old
  places with neither show 📍.
- **Pure layers stay pure:** `syntax/`, `formula/`, `context/`, `model/` and
  `services/kinds.ts` have no React and no `fetch`.
- **Mirror rule:** `.hl-*` classes change colour and background only, never
  metrics.
- **Touch:** popup rows and the Directions link are at least 44 px on touch
  screens. Popup and picker rows `preventDefault` on pointer/mouse down, so
  the editor keeps focus.
- **Gate before every commit:** `npm run typecheck && npm test && npm run build`,
  with clean output.
- **Commit trailer** (exactly these lines, and no model names anywhere else):

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JD6t85Z4ycYStp5C55ag6T
  ```

### Rulings (gaps in the spec, decided here)

- **R1. The mode word is marked on a text segment.** The mode word stays
  `kind: 'text'` (spec §2.2), with an extra `mode` field, so every existing
  consumer treats it as text and the mirror can still colour it.
- **R2. Route segments carry `raw: ''`.** Concatenating every `raw`/`text`
  still reproduces the input.
- **R3. Whitespace in a phrase is `[^\S\n]+`.** It must be one or more
  whitespace characters and never crosses a line break.
  `drive\nto @Porto` is not a route.
- **R4. `plainText` keeps the weather word and drops route segments.**
  Calendar labels and previews read like the text the user wrote.
- **R5. The table view's Item column hides route chips (shown in Travel) but
  keeps weather chips inline.** The spec adds only a Travel column.
- **R6. A synthetic source is a real formula.** The chip's hover title shows
  it, e.g. `{travel("walk", prev, @[porto])}`, which teaches the precise
  form.
- **R7. "street" has two meanings, kept apart.**
  - For the icon, unknown Photon tags map to kind `street` (📍).
  - For ranking, only `osm_key=highway`, `osm_key=building` or
    `place=house` count as a street ("never beats a settlement"). A hospital
    must not lose to a far-away namesake town.
- **R8. `Services.search` still resolves to a flat array.**
  - Elements are `Found = Place & { elsewhere?: true }`, inside first.
  - `onTowns` becomes `onUpdate(found: Found[])`, called with the whole list
    so far after each stage.
  - The many test fakes (`search: async () => []`) keep compiling.
- **R9. The "Elsewhere" divider shows only when there is a parent place, at
  least one row before it, and at least one elsewhere row.**
- **R10. The mode popup closes on any text change or on Escape.**
  - Android sends keyCode 229 instead of real keys, so "any other key"
    means any change to the text.
  - A dismissed phrase is remembered by its signature
    `${at}|${mentionRaw}`, and that phrase can't re-arm the popup.
- **R11. Directions is a plain link**:
  `<a href target="_blank" rel="noopener noreferrer">` with
  `stopPropagation`. Capacitor sends navigation to other hosts to the system
  browser. Trying it on a real phone is an owner item.

## Review Focus

1. **Ordinary prose must not become phrases.** These stay plain:
   - "into @Porto", "Toronto", "weathered"
   - "drive carefully"
   - "next to @X"
   - `drive\nto @X`

   "Drive To @Porto" (capitals) is recognised. *Test: Task 1.*
2. **Old or imported places with a missing or malformed `kind`/`extent`.**
   - `kind: "spaceship"` shows 📍.
   - `extent: [1, 2]` or any non-finite value falls back to the 30 km box.
   - Nothing crashes.

   *Tests: Task 2 (`placeIcon`), Task 4 (`areaOf`).*
3. **A Photon stage fails mid-search.**
   - If the bbox stage returns 503 but the worldwide stage answers, the picker
     still lists results and a typed mention still resolves.
   - `TransientError` is raised only when every source failed.

   *Test: Task 4.*
4. **Phone use of the mode popup.**
   - A tap on a row inserts the word without blurring the editor.
   - A text change (Android 229 keys) closes the popup instead of leaving it
     stuck open.

   *Test: Task 6.*
5. **A route whose places aren't ready.**
   - "to @Porto" as a first child under a bullet with no place gives
     `no previous place`.
   - A destination that resolves to `null` gives the place's own
     `unknown place: porto`. It never gives a fake distance.

   *Test: Task 3.*

---

## Execution waves (disjoint files within a wave)

| Wave | Tasks | Notes |
|---|---|---|
| A | T1, T2 | T1 owns `syntax/*`. T2 owns `model/types.ts`, `services/kinds.ts`, and the parsing in `services/http.ts`. |
| B | T3, T4, T6 | T3 `formula/*`; T4 `services/http.ts` + `types.ts` + test fakes + minimal `usePlaceSearch.ts`; T6 `NodeEditor.tsx`, `ModePicker.tsx`, `useModePicker.ts`, `outline.css`, popup CSS in `touch.css` |
| C | T5, T7 | T5 `RichText`, `Chips`, `TableView`, `MapView`, `chips.css`, `views.css`; T7 `PlacePicker`, `usePlaceSearch`, picker CSS in `touch.css` |
| D | T8 | `scripts/e2e.cjs`, `live.test.ts`, docs |

---

### Task 1: Phrase recognition (pure)

**Files:**
- Create: `src/syntax/phrases.ts`, `src/syntax/phrases.test.ts`
- Modify: `src/syntax/tokenize.ts` (Segment union, call the post-pass,
  `displayText`), `src/syntax/plain.ts` (R4), `src/syntax/plain.test.ts`

**Interfaces:**
- Produces, in `phrases.ts`:

  ```ts
  export type Mode = 'drive' | 'walk' | 'transit' | 'bike' | 'fly';
  /** Popup order; `word` is what the popup inserts. */
  export const MODES: readonly { mode: Mode; word: string; label: string }[];
  //   [{drive,'drive','Drive'},{walk,'walk','Walk'},{transit,'transit','Public transport'},{bike,'bike','Bike'},{fly,'fly','Fly'}]
  export function modeOf(word: string): Mode | undefined;          // case-insensitive, Global Constraints list
  export function recognizePhrases(segments: Segment[]): Segment[]; // the tokenizer post-pass
  /** Where to insert a mode word if `text` just completed a "to <place>" with no mode, else null. */
  export function routeWithoutMode(text: string, caret: number): { at: number } | null;
  export function insertModeWord(text: string, at: number, mode: Mode, caret: number): { text: string; caret: number };
  ```
- Produces, in `tokenize.ts`, the Segment union becomes:

  ```ts
  | { kind: 'text'; text: string; mode?: Mode }          // mode: a recognised route's mode word (R1)
  | { kind: 'weather'; raw: string }
  | { kind: 'route'; mode: Mode; fromKey?: string; toKey: string; raw: '' }  // R2; sits right after the destination place
  ```
- Produces `displayText(text)`, which also hides a backslash directly before
  any phrase word, whole word (`\weather` → `weather`).

- [ ] **Step 1: Write the failing tests** in `phrases.test.ts`. Use
  `tokenize` and compare `kind`/`mode`/`toKey`/`fromKey` sequences.
  - Every mode word in the Global Constraints, as `<word> to @Porto`, gives
    `[text(word, mode), text(' to '), place(porto), route(mode, toKey 'porto')]`.
  - `weather` and `forecast` give a `weather` segment with `raw` preserved.
    `Weather` and `FORECAST` also match.
  - `drive from @Lisbon to @Porto` gives a route with
    `fromKey: 'lisbon', toKey: 'porto'` after the Porto place.
  - Not phrases:
    - `weathered`, `\weather`, `{weather()}` (stays one formula segment)
    - `drive carefully`, `to @Porto`, `into @Porto`, `next to @Porto`
    - `drive\nto @Porto` (R3)
    - `drive to \@Porto`
  - `Drive To @Porto` is a route.
  - Two routes in one bullet (`drive to @A, then walk to @B`) give two route
    segments, each after its place.
  - The round trip still holds for each case above: concatenating `raw` and
    `text` reproduces the input.
  - `routeWithoutMode`:
    - `'go to @Porto '` with caret 12 gives `{ at: 3 }`
    - `'to @[São Bento]'` with caret at the end gives `{ at: 0 }`
    - `'from @A to @B,'` gives `{ at: 0 }`
    - `'drive to @Porto '` gives `null`
    - `'next to @Porto '`, `'close to @X '` and `'near to @X '` give `null`
    - `'to @Porto x'` with the caret at the end gives `null`
    - `'to @Por'` with the caret mid-word gives `null`
  - `insertModeWord('go to @Porto ', 3, 'walk', 12)` gives
    `{ text: 'go walk to @Porto ', caret: 17 }`. A caret before `at` is
    unchanged.
  - `displayText('\\weather and \\drive')` gives `'weather and drive'`.
  - In `plain.test.ts`, `plainText('Lunch weather')` stays
    `'Lunch weather'`, and `plainText('drive to @Porto')` gives
    `'drive to Porto'`.

- [ ] **Step 2: Run `npx vitest run src/syntax`.** Expected: the new tests
  FAIL (no `phrases.ts`).

- [ ] **Step 3: Implement.**
  - `recognizePhrases` walks the segment list:
    - It splits text segments on weather words and on mode words that
      directly precede a route.
    - Word boundaries are `(?<![\p{L}\d_\\])` and `(?![\p{L}\d])` with the
      `u` and `i` flags.
    - A route needs: text ending `<mode>[^\S\n]+to[^\S\n]+` then a place, or
      text ending `<mode>[^\S\n]+from[^\S\n]+`, a place, text exactly
      `[^\S\n]+to[^\S\n]+`, then a place.
  - `routeWithoutMode`:
    1. Tokenize `text.slice(0, caret)`. The last segment must be a place, or
       a place followed by one text char matching `[\s\p{P}]`.
    2. The raw text before that place must end with whole-word
       `to[^\S\n]+`. If a place and `from[^\S\n]+` come before that,
       `at` is the start of `from`.
    3. Return `null` when the word before `at` is a mode word, or is
       next/close/near (to-form).

  `tokenize` calls `recognizePhrases` on its result. `phrases.ts` imports
  `Segment` as a type only.

- [ ] **Step 4: Run `npx vitest run src/syntax`, then the gate.** Expected:
  all PASS. Existing consumers compile, because the new segment kinds are
  ignored by `if`-chains and by `resolve.ts`.
  - `RichText` and the `Mirror` switch must still typecheck.
  - If the `RichText` switch errors on the new kinds, add `return null` cases
    there now. Task 5 fills them in.

- [ ] **Step 5: Commit** `feat(syntax): recognise weather words and route phrases`.

---

### Task 2: Place kinds and extents (pure + parsing)

**Files:**
- Create: `src/services/kinds.ts`, `src/services/kinds.test.ts`
- Modify:
  - `src/model/types.ts`: `PlaceKind`, plus `Place.kind?` and `Place.extent?`
  - `src/services/http.ts`: response types, Candidate building and
    `toPlace` only. Task 4 owns the rest of this file.
  - `src/services/services.test.ts`: parsing cases

**Interfaces:**
- Produces, in `model/types.ts`:

  ```ts
  export type PlaceKind = 'region' | 'city' | 'village' | 'neighbourhood' | 'restaurant' | 'cafe' | 'bar' | 'shop'
    | 'stay' | 'sight' | 'park' | 'beach' | 'nature' | 'airport' | 'station' | 'street';
  interface Place { name; lat; lon; label?; kind?: PlaceKind; extent?: [number, number, number, number] } // [west, south, east, north]
  ```
- Produces, in `kinds.ts`:

  ```ts
  export const KIND_ICON: Record<PlaceKind, string>;   // spec §5 table
  export function placeIcon(p?: Pick<Place, 'kind'>): string;   // KIND_ICON[kind] ?? '📍' (tolerates junk from imports)
  export function kindOfPhoton(osmKey?: string, osmValue?: string): PlaceKind;
  export function kindOfOpenMeteo(featureCode?: string, population?: number): PlaceKind;
  export function isStreetTag(osmKey?: string, osmValue?: string): boolean;   // R7 ranking meaning
  export function photonExtent(e: unknown): Place['extent'] | undefined;       // [w,n,e,s] → [w,s,e,n]; undefined unless 4 finite numbers
  ```
- In `http.ts`:
  - Candidates and stored places carry `kind` (always set) and `extent` (when
    Photon gave a valid one).
  - `Candidate.street` is `isStreetTag(...)`.
  - `toPlace` keeps `kind` and `extent`, and drops `population` and `street`.
  - Open-Meteo requests are unchanged. `feature_code` is already in its
    response.

- [ ] **Step 1: Write the failing tests.**
  - `kinds.test.ts`: `it.each` over every row of spec §5. Include:
    - `kindOfPhoton('amenity','restaurant')` is `'restaurant'`
    - `('place','town')` is `'city'`
    - `('boundary','administrative')` is `'region'`
    - `('historic','castle')` is `'sight'`
    - `('shop','bakery')` is `'shop'`
    - `('aeroway','aerodrome')` is `'airport'`
    - `('amenity','hospital')` is `'street'`
    - `(undefined, undefined)` is `'street'`

    And these for the other functions:
    - `kindOfOpenMeteo`:
      - `('PPLC')` and `('PPLA2')` are `'city'`
      - `('PPL', 12000)` is `'city'`; `('PPL', 900)` is `'village'`
      - `('ADM1')` and `('PCLI')` are `'region'`
      - `(undefined)` is `'village'`
    - `placeIcon({})` is `'📍'`, and
      `placeIcon({ kind: 'spaceship' as PlaceKind })` is `'📍'`.
      `placeIcon({ kind: 'cafe' })` is `'☕'`.
    - `photonExtent([2.05, 41.47, 2.23, 41.32])` gives
      `[2.05, 41.32, 2.23, 41.47]`. `photonExtent([1, 2])`,
      `photonExtent('x')` and `photonExtent([1, NaN, 2, 3])` give
      `undefined`.
    - `isStreetTag('highway','primary')`, `('building','yes')` and
      `('place','house')` are true. `('amenity','hospital')` is false.
  - `services.test.ts` (fake fetch):
    - A Photon feature with `osm_key: 'amenity', osm_value: 'cafe'` and an
      `extent` geocodes to a place with `kind: 'cafe'` and the reordered
      extent.
    - An Open-Meteo result with `feature_code: 'PPLC'` gives `kind: 'city'`.
    - The existing "street never beats a town" test still passes. Add an
      `amenity=hospital` landmark that **does** beat a far town (R7).

- [ ] **Step 2: Run `npx vitest run src/services`.** Expected: FAIL.

- [ ] **Step 3: Implement** `kinds.ts`, then the `http.ts` parsing.
  - Type `PhotonResponse` properties as
    `Record<string, unknown>`, narrowing strings with `typeof`.
  - Add `feature_code?: string` to `OpenMeteoGeoResponse`.

- [ ] **Step 4: Run the gate.** Expected: PASS. `isDoc` needs no change,
  because places are not deeply validated.

- [ ] **Step 5: Commit** `feat(services): place kinds and extents from Photon and Open-Meteo`.

---

### Task 3: Travel values and phrase evaluation (pure)

**Files:**
- Create: `src/formula/travel.ts`, `src/formula/travel.test.ts`
- Modify: `src/formula/values.ts`, `src/formula/evaluate.ts` (the `travel`
  built-in, plus `.distance`/`.duration` on travel), `src/formula/format.ts`,
  `src/formula/format.test.ts`

**Interfaces:**
- Consumes `Mode`, `MODES` and `Segment` from Task 1.
- Produces, in `values.ts`:

  ```ts
  | { kind: 'travel'; mode: Mode; meters: number; seconds?: number; estimated: boolean; directionsUrl?: string }
  ```
- Produces, in `travel.ts`:

  ```ts
  export const WALK_KMH = 4.8, BIKE_KMH = 15, MAX_ESTIMATE_KM = 100;
  export function directionsUrl(from: Place, to: Place): string;   // Global Constraints URL
  export async function travel(mode: Mode, from: Place, to: Place, services: Services): Promise<Value>; // spec §3 table
  /** The formula a phrase stands for (R6): weather → 'weather()'; route → `travel("walk", prev, @[porto])` or `travel("drive", @[lisbon], @[porto])`. */
  export function phraseSource(seg: Extract<Segment, { kind: 'weather' | 'route' }>): string;
  ```
- In `evaluate.ts`:
  - `travel(mode, from, to)` with a string mode and two places.
  - An unknown mode gives the error `unknown travel mode "x"`.
  - `.distance` on a travel value gives a distance; `.duration` gives a
    duration, or the error `no time for transit` / `no time for fly` when
    there are no seconds.
- In `format.ts`:
  - Produces `TRAVEL_ICON: Record<Mode, string>`:
    drive 🚗, walk 🚶, transit 🚆, bike 🚲, fly ✈.
  - `formatValue` handles travel per the Global Constraints. Transit has no
    link text; the chip adds it.

- [ ] **Step 1: Write the failing tests** in `travel.test.ts`. Use a fake
  `Services` whose `route` counts calls and returns
  `{ seconds: 11100, meters: 313400 }`.
  - drive gives `{ meters: 313400, seconds: 11100, estimated: false }`.
  - walk over a 5800 m route gives `seconds` ≈ 5800 / (4.8 / 3.6) and
    `estimated: true`. bike uses 15 km/h.
  - walk over a 150 km route gives the error `too far to walk`; bike gives
    `too far to cycle`.
  - transit gives the route meters, no seconds, and a `directionsUrl` equal
    to
    `https://www.google.com/maps/dir/?api=1&origin=38.7223,-9.1393&destination=41.1579,-8.6291&travelmode=transit`.
  - fly gives the haversine meters (Lisbon→Porto ≈ 274 km) with
    `route` call count 0.
  - A `route` that rejects with `Error('no route found')`, through
    `evaluate`, gives an error value with that message.
  - `phraseSource` gives `weather()`, `travel("walk", prev, @[porto])` and
    `travel("drive", @[lisbon], @[porto])`.
  - Through `evaluate(parse(phraseSource(seg)))`:
    - With `prevKey` undefined, the result is `no previous place`.
    - With `resolvePlace` returning `null` for porto, the result is
      `unknown place: porto` (Review Focus 5).
    - The same place twice gives drive `0 min` / `0 m`.
  - `format.test.ts` rows for all five modes, exactly as in the Global
    Constraints (transit gives `🚆 313 km`).

- [ ] **Step 2: Run `npx vitest run src/formula`.** Expected: FAIL.

- [ ] **Step 3: Implement** `travel.ts`, the `values.ts` member, and the
  `evaluate.ts` case and props. Add the `format.ts` case: `≈ ` goes before
  the duration when `estimated` is set.

- [ ] **Step 4: Run the gate.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(formula): travel built-in and phrase sources`.

---

### Task 4: Area search and geocode order

**Files:**
- Modify:
  - `src/services/http.ts`: `search`, `geocode`, and a bbox Photon query
  - `src/services/types.ts`: `Found`, `SearchOptions.onUpdate` (R8)
  - `src/services/geo.ts`: `areaOf`, `inArea`
  - `src/ui/usePlaceSearch.ts`: only the `onTowns` → `onUpdate` rename, and
    stripping `elsewhere` before a place is stored
  - `src/services/services.test.ts`
  - every test fake that passes `onTowns`

**Interfaces:**
- Consumes `Place.kind`/`extent` and `Candidate.street` from Task 2.
- Produces, in `types.ts`:

  ```ts
  export type Found = Place & { elsewhere?: true };
  export interface SearchOptions { signal?: AbortSignal; onUpdate?: (found: Found[]) => void }
  search(query: string, near?: Place, opts?: SearchOptions): Promise<Found[]>; // inside rows first, then elsewhere rows
  ```
- Produces, in `geo.ts`:

  ```ts
  export type Box = [number, number, number, number]; // [west, south, east, north]
  export const AREA_KM = 30;
  export function areaOf(p: Place): Box;           // valid extent (4 finite numbers, west<east, south<north) else ±30 km box
  export function inArea(p: Pick<Place, 'lat' | 'lon'>, box: Box): boolean;
  ```
- In `http.ts`:
  - `photon(q, limit, near, priority, signal, box?)` adds
    `&bbox=w,s,e,n` when `box` is given.
  - **`search` stages** (spec §6.2), each followed by `onUpdate` with the
    merged list so far:
    1. Open-Meteo, 5 towns
    2. Photon with the bbox, limit 8, interactive (only with `near`)
    3. Photon biased, limit 5, interactive
  - **Merging the search results:**
    - Inside: everything in `areaOf(near)`, non-streets before streets, then
      nearest to `near` first.
    - Elsewhere: majors, then towns, then landmarks, each flagged
      `elsewhere: true`.
    - Same-name places within 2 km are dropped across sections; the first
      one wins.
    - At most 8 per section.
    - With no `near`, keep today's order, unflagged.
  - **`geocode`** (spec §6.3):
    1. The Open-Meteo top match, if there is no `near`, or it is major, or it
       is `inArea`.
    2. The first non-street bbox Photon result (limit 5, background), when
       there is a `near`.
    3. Today's biased worldwide rule.
  - Raise `TransientError` only when every attempted source failed and at
    least one failure was transient.

- [ ] **Step 1: Write the failing tests** in `services.test.ts`, with fake
  fetch routing by URL; a bbox URL contains `bbox=`.
  - `areaOf` uses a valid extent. It falls back to a box ≈ 0.27° of latitude
    each way for `extent: [1, 2]` (as unknown as Box), for non-finite
    values, and for no extent (Review Focus 2).
  - The bbox query string is `bbox=2.05,41.32,2.23,41.47` for a Barcelona
    `near` with that extent.
  - search `airport` near Barcelona (no extent):
    - The bbox result El Prat (aerodrome, inside) is first and unflagged.
    - Madrid (OM, population 3M) comes after it, flagged `elsewhere`.
    - A town named "Airport" in the US is flagged and comes after Madrid.
  - Inside ordering: a nearer café comes before a farther café, and a
    street comes after both.
  - `onUpdate` is called at least twice, and its last call equals the
    resolved list.
  - The bbox stage returns 503 three times: search still resolves to the
    elsewhere rows, and geocode `airport` falls through to the worldwide
    result (Review Focus 3).
  - Every source returns 503: both `search` and `geocode` reject with
    `TransientError`.
  - geocode `airport` near Barcelona gives El Prat. geocode `madrid` near
    Barcelona gives Madrid (major). geocode `sintra` near Lisbon (OM town
    inside the box) gives the OM match without calling Photon.
  - Deduplication: the same name within 2 km in OM and the bbox gives one
    row.

- [ ] **Step 2: Run `npx vitest run src/services`.** Expected: FAIL.

- [ ] **Step 3: Implement** `geo.ts`, the `types.ts` change and the
  `http.ts` stages. Then:
  - Update `usePlaceSearch.ts` to use `onUpdate` (setRemote with the latest
    list). It stores `toPlace`-equivalent places without `elsewhere`; the
    section display is Task 7.
  - `memo.ts` needs no change: search is a passthrough.

- [ ] **Step 4: Run the gate.** Expected: PASS, including every UI test with
  a fake `search`.

- [ ] **Step 5: Commit** `feat(services): search and geocode inside the parent place's area first`.

---

### Task 5: Chips, icons and the table's Travel column

**Files:**
- Modify:
  - `src/ui/RichText.tsx`: weather and route segments
  - `src/ui/Chips.tsx`:
    - `PlaceChip` gets the kind icon
    - `FormulaChip` gets the travel link
  - `src/ui/views/TableView.tsx`: the Travel column (R5)
  - `src/ui/views/MapView.tsx`: the marker title starts with the icon
  - `src/styles/chips.css`: `content: attr(data-icon) '\2060'`, and the
    Directions link with a 44 px target on `pointer: coarse`
  - `src/styles/views.css`, if the column needs it
- Test: `src/ui/views/views.test.tsx`, `src/ui/Outline.test.tsx` (or a new
  `src/ui/Chips.test.tsx`)

**Interfaces:**
- Consumes:
  - `phraseSource` and `TRAVEL_ICON` (Task 3)
  - `placeIcon` (Task 2)
  - the Task 1 segments
- `PlaceChip` renders `data-icon={placeIcon(place)}`; an unresolved place
  gets 📍.
- **`FormulaChip`** gains a link for a `travel` value with a `directionsUrl`:
  - The chip renders `formatValue(v)`, then ` · `, then
    `<a className="chip-link" href={url} target="_blank" rel="noopener noreferrer" onClick={stopPropagation}>Directions ↗</a>`.
  - The link comes inside a `.chip-wrap`, so it gets the 44 px hit area.
- **`RichText`:**
  - `weather` gives `<FormulaChip source="weather()">`.
  - `route` gives `<FormulaChip source={phraseSource(s)}>`, unless
    `hideFormulas` is set.
  - A text segment with `mode` renders as plain text.
- **`TableView`:** when any row has a route segment, a `Travel` column comes
  after Date. It holds that row's route chips.

- [ ] **Step 1: Write the failing tests** (Testing Library, fake services as
  in the existing UI tests):
  - A row `Day out weather` with a resolved place and date shows a weather
    chip (`☁️`/`°` text from the fake) where the word was.
  - `drive to @Porto` under a bullet with `@Lisbon` shows
    `🚗 3h 05m · 313 km`.
  - `transit to @Porto` shows the `Directions ↗` link, with an `href`
    containing `travelmode=transit`. Clicking it does not focus the row (the
    textarea doesn't appear).
  - A resolved place with `kind: 'cafe'` renders a chip with
    `data-icon="☕"`. A place without `kind` gets `📍`.
  - The table view over rows with one route shows a `Travel` header and the
    chip in that row. The Item cell has no route chip but keeps a weather
    chip.

- [ ] **Step 2: Run `npx vitest run src/ui`.** Expected: FAIL.

- [ ] **Step 3: Implement** the files listed. Read `DESIGN.md` first. Link
  colour comes from the formula ink token, underlined; no new colours.

- [ ] **Step 4: Run the gate, then `impeccable detect --json src/styles/chips.css src/styles/views.css`.**
  Expected: PASS, with no new findings.

- [ ] **Step 5: Commit** `feat(ui): weather and travel chips, place-kind icons, table Travel column`.

---

### Task 6: The mode popup and phrase highlighting

**Files:**
- Create: `src/ui/ModePicker.tsx`, `src/ui/useModePicker.ts`,
  `src/ui/ModePicker.test.tsx`
- Modify:
  - `src/ui/NodeEditor.tsx`:
    - mirror: `hl-weather`, `hl-mode`, and render nothing for `route`
    - popup wiring
  - `src/styles/outline.css`: `.hl-weather, .hl-mode` use the formula
    colours
  - `src/styles/touch.css`: popup rows reuse `.picker` and `.picker-option`;
    at least 44 px on coarse pointers

**Interfaces:**
- Consumes `MODES`, `routeWithoutMode` and `insertModeWord` (Task 1), and
  `TRAVEL_ICON` (Task 3; wave B, so import it after Task 3 lands, or use a
  local copy of the five icons and switch over at integration).
- Produces:

  ```ts
  export function useModePicker(text: string): {
    open: boolean; active: number;
    arm(text: string, caret: number): void;     // opens iff routeWithoutMode(...) and its signature wasn't dismissed (R10)
    dismiss(): void;
    setActive(i: number): void;
    /** Returns the edit to apply, or null; caller applies it. */
    choose(i: number, caret: number): { text: string; caret: number } | null;
    onKeyDown(e: KeyboardEvent): 'choose' | 'handled' | 'pass';
  };
  export function ModePicker(props: { active: number; onPick(i: number): void; onHover(i: number): void }): JSX.Element;
  ```
- **Arming:**
  - after `pick()` in the place picker, with the new text and caret
  - in `onChange`, when the value grew by exactly one character, that
    character (before the caret) matches `[\s\p{P}]`, and `routeWithoutMode`
    matches
- **Closing:**
  - It is open only while `text` equals the text it was armed with (R10).
  - Escape dismisses it.
  - ↑/↓ move, Enter/Tab choose.
  - Any other key closes it and passes the key through.
- The popup is hidden while the place picker is `showing` (the place picker
  wins).

- [ ] **Step 1: Write the failing tests** in `ModePicker.test.tsx`. Render
  the Outline with a doc, as `Outline.test.tsx` does.
  - Typing `go to @porto ` (the place resolved in `doc.places`) opens a
    listbox labelled `Travel mode`. Its rows read: `Drive`, `Walk`,
    `Public transport`, `Bike`, `Fly`.
  - ArrowDown, then Enter: the textarea value is `go walk to @porto `, and the
    caret is 1 after `@porto ` (`selectionStart` = 18).
  - Picking a place from the place picker in `to @por` opens the popup after
    the pick. The place picker and the popup are never both in the DOM.
  - `next to @porto ` does not open it.
  - Escape closes it, and the text is unchanged. Typing `x` then Backspace
    then a space does not reopen it for the same phrase.
  - A `pointerdown` on a row is `defaultPrevented`. A click on `Fly`
    inserts `fly ` while the textarea keeps focus (Review Focus 4).
  - A text change while open (fire `change` with an extra letter, as an
    Android 229 keyboard would) closes it.
  - The mirror renders `drive` inside a `.hl-mode` span and `weather` inside
    `.hl-weather`, and its text content equals the textarea value plus the
    trailing ZWSP.

- [ ] **Step 2: Run `npx vitest run src/ui/ModePicker.test.tsx`.** Expected:
  FAIL.

- [ ] **Step 3: Implement** the hook, the component and the `NodeEditor`
  wiring.
  - `ModePicker` mirrors `PlacePicker`'s markup and `keepEditorFocus`.
  - `NodeEditor` applies a choice with `apply((d) => setText(d, id, next.text), { id, caret: next.caret })`.

- [ ] **Step 4: Run the gate and `impeccable detect --json src/styles/outline.css src/styles/touch.css`.**
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(editor): travel-mode popup and phrase highlighting`.

---

### Task 7: Place picker sections and icons

**Files:**
- Modify:
  - `src/ui/usePlaceSearch.ts`: `Suggestion.section`, caps
  - `src/ui/PlacePicker.tsx`: icon, divider
  - `src/styles/touch.css`: the picker parts only; Task 6 already edited this
    file, so rebase first
- Test: a new `src/ui/PlacePicker.test.tsx`

**Interfaces:**
- Consumes `Found` and `onUpdate` (Task 4), and `placeIcon` (Task 2).
- Produces:

  ```ts
  export interface Suggestion { place: Place; saved: boolean; section: 'saved' | 'inside' | 'elsewhere' }
  ```

  - Caps: saved 4, inside 8, elsewhere 8 (no overall slice).
  - `place` never carries `elsewhere`.
- `PlacePicker`:
  - Each row is `<span class="picker-icon">{placeIcon(place)}</span>`, then
    the name and label.
  - Before the first `elsewhere` row, it renders
    `<li role="presentation" class="picker-divider">Elsewhere</li>`, when
    R9 holds.
  - The divider is not in `items`, so ↑/↓ indices are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - A fake `search` resolves `[elPrat(kind airport), {…madrid, elsewhere: true}]`
    near Barcelona: rows read `✈️ El Prat…`, then the divider `Elsewhere`,
    then `🏙️ Madrid…`.
  - ArrowDown twice then Enter picks Madrid; the divider is skipped. The
    stored place has no `elsewhere` key and has `kind: 'city'`.
  - With no parent place there is no divider, even with flagged rows.
  - `onUpdate` with an early partial list renders those rows before the
    promise resolves.

- [ ] **Step 2: Run `npx vitest run src/ui/PlacePicker.test.tsx`.** Expected:
  FAIL.

- [ ] **Step 3: Implement** the changes. Check the picker's max height on a
  phone: with up to 20 rows it must scroll inside itself, not grow the page.

- [ ] **Step 4: Run the gate and `impeccable detect --json src/styles/touch.css`.**
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(picker): place-kind icons and an Elsewhere section`.

---

### Task 8: Browser checks, live checks and docs

**Files:**
- Modify:
  - `scripts/e2e.cjs`:
    - the stubs return `osm_key`/`osm_value`/`extent`
    - bbox-aware Photon stubs
    - new checks
  - `src/services/live.test.ts`
  - `CLAUDE.md` §1, §2.1, §3.1, §3.2, §4.3, §5, §6 and §7
  - `PRODUCT.md`, `DESIGN.md`, `handoff.md`

**Interfaces:** consumes everything above. It produces no code interfaces.

- [ ] **Step 1: Add the browser checks**, desktop and phone where the
  interaction differs:
  - A new note with `@Lisbon Nov 3 weather` shows a weather chip after blur.
  - Typing `to @Porto ` opens the popup. Choosing Drive gives
    `drive to @Porto` and, after blur, a `🚗` travel chip.
  - Walk shows `≈`.
  - Public transport shows a `Directions ↗` link with `travelmode=transit`.
  - Under a bullet `@Barcelona`, typing `@airport` lists the in-area result
    first with `✈️`, then the `Elsewhere` divider.
  - On the phone: tapping a popup row keeps the keyboard focus (the textarea
    is still `document.activeElement`).
  - Screenshots of the popup and the picker in light and dark.

- [ ] **Step 2: Run the browser check.**

  ```
  npm run build
  npx vite preview --port 4176 --strictPort &   # stop it by PID afterwards
  node scripts/e2e.cjs <scratchpad>/e2e
  ```

  Expected: every check passes (57 old plus the new ones). Look at the new
  screenshots.

- [ ] **Step 3: Add the live checks** (they run only with `LIVE_SERVICES=1`):
  - `search('airport', barcelona)`: the first result has kind `airport` and
    is `inArea`.
  - `search('cafe', lisbon)`: some result has kind `cafe`.
  - A Photon city result has a valid `extent` after reordering (south < north,
    west < east).

- [ ] **Step 4: Update the docs.**
  - CLAUDE.md: the sections listed, plus the file layout (`phrases.ts`,
    `travel.ts`, `kinds.ts`, `ModePicker.tsx`, `useModePicker.ts`).
  - PRODUCT.md capabilities.
  - DESIGN.md: chip icons, the Directions link, the popup, the divider.
  - handoff.md: state and next steps.

- [ ] **Step 5: Run the gate, then commit**
  `test(e2e): phrase, popup and area-search browser checks; docs`. Push, and
  confirm the Android and live-check workflows are green.
