# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The same web app ships as an Android APK through a Capacitor WebView (see
`CLAUDE.md` §11). Its design language is web, tuned for touch.

## Users

One person (the owner) keeps their own notes on their Android phone and in a
browser. They write everyday notes. They also plan things that happen at a time
and place: trips, outings, events, errands. Notes start loose and become a plan
as dates and places are added.

## Product Purpose

LiveNotes is a notes app where an ordinary bulleted outline becomes a dynamic
document. It is modeled on Ink & Switch's *Embark*.

- **Mentions:** `@Place` and dates such as `Nov 3` are recognised in plain text.
- **Phrases:** plain words do the common things without brackets. "weather"
  shows the forecast, and "drive to @Porto" shows the drive.
- **Formulas:** `{weather()}`, `{route(prev, here)}` and others pull in live
  data. They remain the precise way.
- **Views:** a map, calendar or table of any part of the outline.

Success means the owner can keep many notes and find them quickly. A plan's
dates, places, weather and travel times stay current inside the note without
switching apps.

## Positioning

Unlike a general notes app, a note *understands* its places and dates:
- children inherit their parent's place and date
- formulas compute from the outline itself
- any subtree can be seen as a map, calendar or table

Unlike a trip planner, there is no form or schema. It stays a plain outline
until the owner adds structure.

## Operating Context

- Used mostly on an Android phone (soft keyboard, one hand, sometimes on the
  move), and also in a desktop browser.
- Local-first. Notes live on the device (localStorage) and are exported or
  imported as JSON.
- The only network calls go to free, keyless data APIs: Open-Meteo, Photon,
  OSRM and OpenStreetMap tiles. Their failures must be visible and must not
  break the note.
- Notes vary widely. Some are plain notes with a few lines. Others are
  multi-day plans with many places, dates, formulas and views.

## Capabilities and Constraints

- **Many notes.** There is a home screen to browse them.
  - Home sections: notes with upcoming dates (soonest first), then recent
    notes (most recently edited first).
  - Each note appears as a rich card: title, date range, a few places, and a
    small route sketch when it has places. Plain notes show a text preview
    instead.
- **New notes** open blank, with the cursor on the title.
- **Managing notes:** search (titles, text, place names), pin to top, archive
  (hidden but kept, in an Archive section), and delete with an undo bar.
- **Existing data must carry over.** The single note already on the owner's
  phone (`livenotes:doc:v1`) becomes their first note.
- **Note editor:** the existing outline editor. It keeps mentions, the place
  picker, formulas, views, the phone toolbar and export via the share sheet.
- **Weather and travel in plain words.**
  - "weather" or "forecast" becomes a chip with the forecast for the bullet's
    place and date.
  - A mode word before "to @Place" or "from @A to @B" becomes a travel chip:
    drive (real time and distance), walk and bike (time estimated from the
    road distance, marked ≈), public transport (distance and a Google Maps
    "Directions ↗" link), fly (straight-line distance, works offline).
  - Typing or picking "to @Place" without a mode word opens a popup: Drive,
    Walk, Public transport, Bike, Fly. The choice is written into the text as
    a word.
  - A table view gains a Travel column when its rows have routes.
- **Finding places inside the parent's place.** Under a bullet with @Barcelona,
  "@airport" suggests Barcelona's airport first, then an "Elsewhere" section.
  A typed, unpicked mention resolves inside that area too.
- **Place-kind icons** on chips, picker rows and map tooltips: cities,
  villages, neighbourhoods, restaurants, cafés, bars, shops, hotels, sights,
  parks, beaches, nature, airports and stations.
- **Technical:** React 19, TypeScript, Vite, Capacitor 8 for Android, and
  debug APKs built by GitHub Actions. No backend and no accounts. Fonts and
  assets must ship with the app, because it must work offline.

## Brand Commitments

These confirmed traits must be kept:
- the warm paper background (light and warm-dark)
- the orange accent (✦ mark, map route line and markers)
- coloured mention chips (blue places, purple dates, green formula results)
- dark mode that follows the system

The owner asked to keep this feel but make it bolder and more distinctive, not
to redesign it.

## Evidence on Hand

- The sample "Portugal road trip" note (`src/model/sample.ts`) has real
  coordinates. It is example content, labelled as a sample.
- There are no testimonials, users or metrics, and none must be invented.

## Product Principles

1. The text is primary. A note is always a readable outline. Structure comes
   from recognising what's written, never from forms.
2. Gradual enrichment. Plain notes stay simple. Smart parts appear only when
   used.
3. Plans surface themselves. Notes with upcoming dates rise to the top of home
   without manual filing.
4. Honest about the network. A place, weather or route that can't load says so
   and retries. Nothing is faked.
5. Phone first, desktop welcome. Every action works one-handed on a phone
   with a soft keyboard.

## Accessibility & Inclusion

- Touch targets are at least 44 px on phones.
- Text and chips stay legible in light and dark.
- Everything works without hover. Calendar and map information is also
  available as text (agenda list, place names).
