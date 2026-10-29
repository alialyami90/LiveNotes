# Natural-language routes and weather, place kinds, area search: design

Status: approved by the owner (2026-10-29). Product truth: `PRODUCT.md`.
Engineering spec: `CLAUDE.md`.

## 1. What the owner asked for (confirmed answers)

| Question | Answer |
|---|---|
| Goal | Routes and weather without `{…}` brackets ("cumbersome"). Natural-language detection as much as possible. Easier place lookup. |
| How automatic | **Plain words.** Writing ordinary words triggers it; nothing appears unless written. |
| Travel modes | **When a route is typed, show a popup menu of travel modes**, most common on top. |
| Mode order | **Fixed:** Driving, then Walking, then Public transport, then the others (Bike, Fly). |
| What each mode shows | **Real where possible.** Drive: real route and time. Walk/Bike: time estimated from the route distance, marked ≈. Public transport/Fly: distance only, plus a link to Google Maps directions in that mode. |
| Where the mode is kept | **As a word in the text:** "to @Porto" becomes "drive to @Porto". Typing the mode word yourself skips the popup. |
| Weather | **The word becomes a chip:** "weather" or "forecast" shows the forecast for the bullet's place and date. |
| Place lookup rule | **A bullet under a mention searches inside that place.** Under @Barcelona, "airport" shows Barcelona airports. |
| Outside the area | **Inside first:** results inside the parent's area, nearest first, then an "Elsewhere" divider and the rest. Typed (unpicked) mentions resolve inside the area. |
| Place kinds | **Different icons** for cities, neighbourhoods and places such as restaurants and shops. |

`{formulas}` keep working unchanged. This adds a friendlier way, it does not
remove the precise one.

## 2. Recognising phrases (`syntax/phrases.ts`, pure)

Recognition runs in `tokenize`, after places and formulas are found. It never
looks inside `{…}`, and escaped text (`\@`) is never part of a phrase. All words
match whole words, case-insensitively. A backslash right before a phrase word
(`\weather`, `\drive`) keeps it plain text. `displayText` hides that backslash,
the same way it hides the existing `\@` and `\{` escapes.

### 2.1 Weather words

`weather` or `forecast` becomes a segment:

```ts
{ kind: 'weather'; raw: string }
```

### 2.2 Route phrases

A **mode word**, then optional spaces, then one of:

- `to <place>`: from the previous stop to the place
- `from <place> to <place>`: between two named places

The mode words (the first word in each row is the one the popup writes):

| Mode | Words |
|---|---|
| `drive` | drive, driving, car, taxi |
| `walk` | walk, walking |
| `transit` | transit, train, bus, metro, tram |
| `bike` | bike, cycle, cycling |
| `fly` | fly, flight |

The place segments stay exactly as they are (normal chips). The route becomes
an extra, zero-width segment placed right after the destination place:

```ts
{ kind: 'route'; mode: Mode; fromKey?: string; toKey: string }
type Mode = 'drive' | 'walk' | 'transit' | 'bike' | 'fly';
```

`fromKey` is absent for "to @X". Evaluation then uses the previous stop: the
same `prev` rule as formulas (the previous sibling's effective place, else the
parent's place).

The mode word stays a plain text segment. The editor's mirror colours it like a
formula, so the user can see it was recognised.

### 2.3 What is not a route

- "to @X" with no mode word is plain text and shows no route chip. It can open
  the mode popup (§4.3).
- "next to @X", "close to @X" and "near to @X" never open the popup.
- A mode word that is not directly before "to"/"from" ("drive carefully") is
  plain text.

## 3. Evaluating phrases (`formula/travel.ts`, pure)

Phrases are evaluated by the existing formula engine. The tokenizer's segments
become synthetic calls, so pending, error chips, memoisation and "wait for the
mention's lookup" all work exactly as for formulas:

| Segment | Evaluated as |
|---|---|
| weather | `weather()` (here, date) |
| route | `travel(mode, from ?? prev, to)`, a new built-in |

`travel` returns a new `Value`:

```ts
{ kind: 'travel'; mode: Mode; meters: number; seconds?: number; estimated: boolean; directionsUrl?: string }
```

| Mode | `meters` | `seconds` | `estimated` | `directionsUrl` |
|---|---|---|---|---|
| drive | OSRM route distance | OSRM route time | false | none |
| walk | OSRM route distance | meters ÷ 4.8 km/h | true | none |
| bike | OSRM route distance | meters ÷ 15 km/h | true | none |
| transit | OSRM route distance | none | — | Google Maps `travelmode=transit` |
| fly | great-circle distance (no network) | none | — | none |

The directions URL is
`https://www.google.com/maps/dir/?api=1&origin=<lat>,<lon>&destination=<lat>,<lon>&travelmode=transit`.
It is a plain link: no key and no API call.

Walk and bike use the driving route's distance, because the free OSRM server
only routes cars. That is a close-enough estimate for a note, and it is marked
≈ so it is never mistaken for real walking directions.

A walk or bike route longer than 100 km shows the error chip "too far to walk"
or "too far to cycle" instead of a silly estimate.

Errors follow the existing rules: no previous place → "no previous place";
unknown place → the place's own error; routing failure → "no route found" or
"routing unavailable". Nothing is faked.

Formatting (`formula/format.ts`):

| Mode | Example |
|---|---|
| drive | `🚗 3h 05m · 313 km` |
| walk | `🚶 ≈ 1h 10m · 5.8 km` |
| bike | `🚲 ≈ 25 min · 6.1 km` |
| transit | `🚆 313 km · Directions ↗` |
| fly | `✈ 503 km` |

## 4. Editor and chips (`ui/`)

### 4.1 Chips (unfocused rows)

- A weather segment is shown as a weather chip in place of the word, e.g.
  `☀ Sunny 22°/14°`. Pending and error states look like formula chips. The
  error popover (tap) works the same way.
- A route segment is shown as a travel chip right after the destination chip.
  "Directions ↗" is a separate link inside the chip, at least 44 px on phones.
  It opens in a new tab on the web; on Android it goes to the system browser or
  Maps app.

### 4.2 Highlighting while typing (focused rows)

The mirror colours mode words and weather words the same way as formulas.
Colour only, never metrics (CLAUDE.md §7).

### 4.3 The mode popup (`ui/ModePicker.tsx`, `ui/useModePicker.ts`)

**When it opens.** The caret has just completed a "to <place>" (or "from …
to <place>") that has no mode word in front. "Just completed" means one of:

- the user picked the place from the place picker, or
- the user typed a space or punctuation right after a typed mention.

It never opens for "next to", "close to" or "near to".

**What it shows.** It is anchored under the caret like the place picker, with
rows in this fixed order:

1. 🚗 Drive
2. 🚶 Walk
3. 🚆 Public transport
4. 🚲 Bike
5. ✈ Fly

**Choosing.**

- Tap a row, or use ↑/↓ then Enter or Tab.
- Choosing inserts the mode's word and a space before "to" (or "from").
- The caret keeps its place relative to the text.
- The phrase is then recognised (§2.2).

**Dismissing.**

- Escape, or typing any other key, closes the popup and the text stays plain.
- It does not reopen for that phrase until the user edits that mention again.
- Only one popup is open at a time: the place picker always wins while it is
  open.
- On phones its rows are at least 44 px, and it stays above the keyboard the
  same way the place picker does.

### 4.4 Views

- The map's dashed visit line is unchanged.
- The table view gains a "Travel" column when any row in it has a route
  phrase. The column shows the travel chip.
- The calendar is unchanged.

## 5. Place kinds and icons (`services/kinds.ts`, pure)

`Place` gains two optional fields. Old documents stay valid; `version` stays 1.

```ts
interface Place {
  name: string; lat: number; lon: number; label?: string;
  kind?: PlaceKind;                       // what it is, for the icon
  extent?: [number, number, number, number]; // [west, south, east, north], when the map data has one
}
```

`kindOf(source)` maps the data to a kind:

- Photon: `osm_key` / `osm_value`
- Open-Meteo: `feature_code` (all are settlements: PPLC/PPLA* → city; PPL with
  population ≥ 10k → city; otherwise town/village)

| Kind | Icon | From |
|---|---|---|
| `region` | 🗺️ | place=country/state/region/province, boundary=administrative |
| `city` | 🏙️ | place=city/town |
| `village` | 🏘️ | place=village/hamlet |
| `neighbourhood` | 🏠 | place=suburb/neighbourhood/quarter/borough, district |
| `restaurant` | 🍽️ | amenity=restaurant/fast_food/food_court |
| `cafe` | ☕ | amenity=cafe/ice_cream |
| `bar` | 🍷 | amenity=bar/pub/biergarten |
| `shop` | 🛍️ | shop=*, amenity=marketplace |
| `stay` | 🛏️ | tourism=hotel/hostel/guest_house/apartment/motel |
| `sight` | 🏛️ | tourism=attraction/museum/gallery/viewpoint/artwork, historic=* |
| `park` | 🌳 | leisure=park/garden, landuse=forest |
| `beach` | 🏖️ | natural=beach |
| `nature` | ⛰️ | natural=peak/volcano, boundary=protected_area |
| `airport` | ✈️ | aeroway=aerodrome/terminal |
| `station` | 🚉 | railway=station/halt, amenity=bus_station, public_transport=station |
| `street` | 📍 | highway=*, place=house, building=*, anything unknown |

Rules:

- The icon replaces the 📍 on place chips. It is also shown on place-picker rows
  and in map marker tooltips. Chips keep the word joiner after the icon (the
  e2e fix from the library round).
- `kind` and `extent` are saved in `doc.places` with the place, so they work
  offline.
- Places saved before this change have no `kind` and keep 📍. No lookups are
  made just to backfill them; re-picking a place updates it.
- The existing "a Photon street never beats a town" rule becomes "a `street`
  never beats a settlement".

## 6. Searching inside the parent's area (`services/http.ts`)

### 6.1 The area

The parent place is the bullet's inherited place (the existing
`inheritedPlaceKey`, unchanged).

- If the parent has an `extent`, use it.
- Otherwise use a box reaching 30 km from it in each direction.
- An extent larger than about 400 km across (a country or region) is used as
  is. Photon handles large boxes.

### 6.2 Picker search (`search`)

The search runs in stages, and every stage updates the list as it arrives. The
existing `onTowns` callback generalises to `onUpdate`.

1. **Towns (Open-Meteo), as today.**
2. **Inside the area.** Photon with `bbox=<west>,<south>,<east>,<north>` and
   `limit=8`, on the interactive queue.
3. **Elsewhere.** The existing location-biased Photon search, on the
   interactive queue. It still runs when stage 2 fails.

The list has two sections:

- **Inside:** towns and landmarks inside the area, nearest first. Settlements
  and named places come before streets.
- A non-interactive divider **"Elsewhere"**.
- **Elsewhere:** major cities first (so @Madrid under Barcelona is still one
  tap away), then the rest.

Duplicates within 2 km that have the same name are dropped, across sections.
At most 8 inside and 8 elsewhere rows are shown. With no parent place there is
no section split: the list behaves as it does today, plus icons.

### 6.3 Typed mentions (`geocode`)

Order of preference:

1. An Open-Meteo top match that is a major city (population ≥ 100k), or a town
   inside the area. This keeps the @Dammam-under-Riyadh rule.
2. The best non-`street` Photon result inside the area (bbox query).
3. The existing biased worldwide Photon result, subject to the existing street
   and far-namesake rules.

So @airport under @Barcelona becomes Barcelona–El Prat, not a town called
"Airport".

### 6.4 Network discipline

Every existing rule stays:

- Photon's one-at-a-time queue at about 1/s, with interactive searches ahead of
  background ones and abandoned searches skipped.
- 8 s timeouts.
- Two retries on 429, 5xx and network errors.
- `TransientError` against `null`: "not found" only when every source answered
  with nothing.

The extra bbox request is one more queued Photon call per picker search. The
250 ms debounce and cancellation already limit how often that happens.

## 7. Errors and edge cases

| Situation | Behaviour |
|---|---|
| "weather" in a bullet with no place, or no date | Error chip "no place here" / "no date here", same as `weather()` today. |
| A forecast more than about 16 days ahead | "no forecast yet" |
| A route to the same place as the previous stop | Travel chip with 0 m; drive shows "0 min". |
| "from @A to @B" where A or B is unresolved | Pending `…`, then the place's own error. |
| Several route phrases in one bullet | Each gets its own chip after its destination. |
| "weather" inside `{…}` or written as `\weather` | Not recognised. `\` escapes the word the same way it escapes `@` and `{`. |
| A mode popup while the place picker is open | Only the place picker shows. The mode popup can open after the pick. |
| Offline | Weather and drive/walk/bike/transit chips show the existing "unavailable", retrying error. Fly works offline once both places are known. |

## 8. Testing

**Unit tests (TDD, pure layers):**

- `phrases.test.ts`:
  - every mode word and both weather words
  - case and whole-word matching
  - "from…to"
  - zero-width route segment placement
  - never inside `{…}`
  - escapes
  - "next/close/near to"
  - several phrases in one bullet
- `travel.test.ts`:
  - each mode's value
  - the ≈ estimates at 4.8 and 15 km/h
  - the too-far limits
  - the directions URL
  - fly with no network call
  - error propagation
- `kinds.test.ts`: the table in §5, plus unknown → `street`.
- `services.test.ts` (fake fetch):
  - bbox from an extent and from the 30 km fallback
  - inside before elsewhere, nearest first
  - the divider position
  - majors leading elsewhere
  - dedupe across sections
  - geocode order (airport → in-area landmark; Madrid under Barcelona → Madrid)
  - a failed bbox stage still showing elsewhere
- `format.test.ts`: the travel and weather chip strings.

**UI tests (Testing Library):**

- The mode popup:
  - opens after picking a place in "to @…"
  - does not open for "next to"
  - order of rows
  - choosing inserts "drive " and keeps the caret
  - Escape leaves plain text and doesn't reopen
  - keyboard and tap
- Chips: weather and travel chips, the Directions link, icons.
- The place picker: the divider and icons.

**Browser checks:** add these to `scripts/e2e.cjs`:

- a weather chip
- "to @Porto" → popup → Drive → travel chip
- Walk shows ≈
- Public transport shows Directions
- "airport" under Barcelona lists the in-area result first, with ✈️

**Live check:** add these to `src/services/live.test.ts` (run by
`live-check.yml`):

- "airport" near Barcelona → an aerodrome inside the box first
- "cafe" near Lisbon → a café with kind `cafe`
- `kind` and `extent` present on Photon results

**Gate:** `npm run typecheck && npm test && npm run build`, then the e2e
script, then CI (APK and live check) green.

## 9. Docs to update when this is built

CLAUDE.md:

- §1 table (LiveNotes form)
- §3.1 (`Place.kind`, `Place.extent`)
- §3.2 (new segments)
- §4.3 (`travel`, phrases)
- §5 (area search, geocode order, kinds)
- §6 (table Travel column)
- §7 (mode popup, highlighting)

Also: PRODUCT.md (capabilities), and DESIGN.md (chip icons, the popup).

## 10. Out of scope

- Real transit or flight times.
- Walking and cycling routing.
- Other languages for the phrase words.
- Back-filling kinds for places already saved.
- A Google Maps provider: still the later phase in the library plan.
