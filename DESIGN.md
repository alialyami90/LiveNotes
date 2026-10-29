---
name: LiveNotes
description: A phone-first notes app where a plain outline becomes a live plan.
colors:
  paper-ground: "#f7f5f0"
  paper-sheet: "#fffdf9"
  ink: "#23211c"
  ink-soft: "#6b665c"
  hairline: "#e6e1d6"
  ember: "#c2410c"
  on-ember: "#ffffff"
  hover-cream: "#fff3d6"
  place-wash: "#e8f1fb"
  place-ink: "#1d4f86"
  date-wash: "#f3eafc"
  date-ink: "#6233a0"
  formula-wash: "#e9f6ee"
  formula-ink: "#1f6b3e"
  error-wash: "#fdecea"
  error-ink: "#b42318"
  night-ground: "#161513"
  night-sheet: "#1e1d1a"
  night-ink: "#ece8df"
  night-ink-soft: "#a29c90"
  night-hairline: "#34312b"
  night-ember: "#fb923c"
  night-on-ember: "#161513"
  night-hover: "#3a3320"
  night-place-wash: "#1b2b3f"
  night-place-ink: "#9cc7f5"
  night-date-wash: "#2b2140"
  night-date-ink: "#c9a8f5"
  night-formula-wash: "#183324"
  night-formula-ink: "#8ddcac"
  night-error-wash: "#3a1a17"
  night-error-ink: "#f8a39a"
typography:
  display:
    fontFamily: "'Fraunces Variable', Georgia, serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Fraunces Variable', Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  section-head:
    fontFamily: "'Fraunces Variable', Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "0.06em"
    fontFeature: "all-small-caps"
  body:
    fontFamily: "'Instrument Sans Variable', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.625rem"
  meta:
    fontFamily: "'Instrument Sans Variable', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  micro:
    fontFamily: "'Instrument Sans Variable', system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "0.875rem"
    letterSpacing: "0.08em"
rounded:
  chip: "6px"
  inner: "10px"
  card: "14px"
  pill: "999px"
spacing:
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-5: "24px"
  sp-6: "32px"
components:
  note-card:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "14px 56px 14px 16px"
  chip-place:
    backgroundColor: "{colors.place-wash}"
    textColor: "{colors.place-ink}"
    rounded: "{rounded.chip}"
    padding: "1px 5px"
  chip-date:
    backgroundColor: "{colors.date-wash}"
    textColor: "{colors.date-ink}"
    rounded: "{rounded.chip}"
    padding: "1px 5px"
  chip-formula:
    backgroundColor: "{colors.formula-wash}"
    textColor: "{colors.formula-ink}"
    rounded: "{rounded.chip}"
    padding: "1px 5px"
  pinned-chip:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
  undo-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-ground}"
    rounded: "{rounded.pill}"
  stamp:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
---

# Design System: LiveNotes

## Overview

**Creative North Star: "The Annotated Field Notebook"**

LiveNotes looks like a good paper notebook that has learned to read. The ground is warm
paper, the ink is warm near-black, and the one bright thing is an ember orange that marks
where you are going: the ✦ mark, the route lines, the date rail. Places, dates and
formulas the app has recognised are marked with soft coloured washes, like a careful
reader's highlighters. Everything else stays quiet so the owner's own words lead.

This is an Operate surface: notes are read and edited on a phone with one hand, often on
the move. So the type is calm and steady, the density is comfortable, and expression
lives in a few precise places: a warm serif for titles, and two signature moves (the route
sketch and the timeline's stamps on the orange rail). Nothing else becomes ornament.

The system was pushed bolder in October 2026 without changing its world: same paper, same
ember, same chip colours, same system-driven dark mode. What is new is a real type system
(Fraunces and Instrument Sans), a spacing and radius scale, a soft two-layer card shadow
and two short, calm motions.

**Key Characteristics:**
- Warm paper grounds in light, warm charcoal in dark; never pure white or pure black.
- One accent, ember orange, used for direction and "now" only.
- Recognised text is highlighted by colour wash, never by weight or size.
- Fraunces for titles, stamps and section heads; Instrument Sans for everything else.
- Hairline borders plus a soft shadow; cards lift a little, never float.
- Phone first: 44 px targets, full-bleed note page, toolbar above the keyboard.

## Colors

A warm neutral paper palette with one ember accent and three highlighter washes. Values
live in `src/styles/tokens.css`; the `night-*` entries above are the same roles under
`prefers-color-scheme: dark`.

### Primary
- **Ember** (`--accent`): the ✦ wordmark mark, the route sketch line and dots, map markers
  and route line, the timeline rail and its stamps' weekday, relative times ("in 5 days"),
  focus rings, the caret, and selection (as a 22% wash, `--accent-wash`).
- **On Ember** (`--on-accent`): text on an ember fill (map marker numbers). White in
  light; near-black in dark, because the dark ember is light.

### Neutral
- **Paper Ground** (`--bg`): the page. On phones the note page sits directly on it.
- **Paper Sheet** (`--paper`): cards, the desktop note sheet, menus, the phone toolbar.
- **Ink** (`--ink`) and **Soft Ink** (`--ink-soft`): text and secondary text.
- **Hairline** (`--line`): 1 px borders and dividers.
- **Hover Cream** (`--hover`): the hovered row, and its linked marker/entry/table row.

### Highlighters (chip colours, kept)
- **Place** blue (`--place-bg` / `--place-ink`), **Date** purple (`--date-bg` /
  `--date-ink`), **Formula** green (`--formula-bg` / `--formula-ink`), **Error** red
  (`--error-bg` / `--error-ink`).

### Named Rules
**The Ember Means Direction Rule.** Orange marks where you are going or what is now:
routes, the rail, today, relative time, focus. It is never a background for large areas
and never decoration.

**The No Fading Rule.** Status is never shown by lowering opacity on text. Pending and
unreachable chips use a dashed outline; outside-range calendar days lose their paper,
not their contrast. (A pending place chip at opacity 0.6 measured 2.9:1.)

### Contrast (WCAG, computed from the token values)

| Pair | Light | Dark |
|---|---|---|
| ink on paper / bg | 15.83 / 14.76 | 13.79 / 14.92 |
| ink-soft on paper / bg / hover | 5.62 / 5.24 / 5.17 | 6.18 / 6.69 / 4.60 |
| ink-soft on place wash (picker detail) | 5.00 | 5.26 |
| accent on paper / bg | 5.10 / 4.75 | 7.45 / 8.06 |
| place / date / formula / error chip | 7.32 / 7.19 / 5.84 / 5.75 | 8.13 / 7.46 / 8.43 / 7.98 |
| date-ink on paper / bg | 8.27 / 7.71 | 8.35 / 9.04 |
| error-ink on paper / bg | 6.47 / 6.03 | 8.59 / 9.30 |
| on-accent on accent (map marker) | 5.18 | 8.06 |
| undo bar (bg on ink) | 14.76 | 14.92 |

Every text pair clears 4.5:1 in both themes. Check any new pair before shipping it.

## Typography

**Display Font:** Fraunces Variable (with Georgia, serif), the `opsz` build: weight and
optical-size axes, so it tightens at 32 px and opens up at 11 px on its own.
**Body Font:** Instrument Sans Variable (with system-ui, sans-serif).

Both are bundled from `@fontsource-variable/*` through `src/styles.css`, so the Android
APK renders them offline. No network fonts, ever.

**Character:** a warm, soft-shouldered serif for the things you name (notes, days,
sections) over a clear, slightly narrow grotesque for the things you read and tap.

### Hierarchy
- **Display** (Fraunces 600, 32/36, -0.01em): the note title field and the stamp's day
  number. `--fs-display` / `--lh-display`, class `.t-display`.
- **Title** (Fraunces 600, 22/28): card titles, the wordmark, section heads (as small
  caps). `--fs-title` / `--lh-title`, class `.t-title`.
- **Body** (Instrument Sans 400, 16/26): outline text, UI text, table cells. The editor
  depends on this line height.
- **Meta** (Instrument Sans 400, 13/18): dates, relative time, places, hints, captions,
  empty states. Class `.t-meta`.
- **Micro** (Instrument Sans or Fraunces 600, 11/14, +0.08em, capitals): stamp weekday,
  calendar weekday letters, table headers, the "in this doc" tag. Class `.t-micro`.

Sizes and line heights are `rem`, so Android's font-size setting scales size and leading
together.

### Named Rules
**The Small Caps Are Title Size Rule.** Fraunces has no real small-caps glyphs (checked:
with synthesis off, `all-small-caps` renders at lowercase width), so the browser
synthesises them at about 70% of the cap height. Section heads therefore use
`font-variant-caps: all-small-caps` at title size (22 px, rendering about 15 px). At micro
size, "small caps" means capitals set at 11 px with +0.08em tracking. Synthesised small
caps at 11 px would shrink to about 5 px.

**The Tabular Numbers Rule.** Stamps, dates, chips, calendar numbers, agenda dates and
card date lines use `font-variant-numeric: tabular-nums` so digits stack and do not
jitter as they change.

**The Highlight Changes Colour Only Rule.** In the editor, a transparent textarea sits
over a mirror that draws the same characters with `.hl-*` highlights. Both layers take
one font through `font: inherit` and pin every text-layout property in a single shared
rule. Highlights may change only `color`, `background` and `border-radius`: never weight,
size, padding, border or letter-spacing. Any font change must go on the shared parent or
on both layers in the same rule.

## Layout

- **Spacing scale:** `--sp-1`…`--sp-6` = 4, 8, 12, 16, 24, 32 px. Tight inside a group
  (4–8), generous between groups (24–32). There is more space above a section head
  (32) than below it (12).
- **Desktop:** the note is a paper sheet, at most 860 px wide, centred with a 32 px top
  margin.
- **Phones (≤ 640 px):** the note page is full-bleed (no border, radius or shadow). The
  header is one row with a 44 px `⋯` menu, and the outline indent drops from 26 to 18 px.
- **Phones (≤ 440 px):** the route sketch shrinks to 72×48 and the rail column to 48 px,
  so a 22 px card title keeps room.
- **Touch (`pointer: coarse`):** every tappable thing is at least 44 px tall: toolbar
  buttons, picker options, travel-mode popup rows, the Directions link (by its hit area),
  agenda entries, add-bullet, card menu, pinned chips.
- **Safe areas:** body and header honour `env(safe-area-inset-*)` (Capacitor
  `viewport-fit=cover`).

## Elevation & Depth

Paper on paper. Surfaces are separated by a 1 px hairline first and a soft shadow
second. Shadows are warm-tinted (brown, not grey) in light and plain black in dark, and
always offset downward with a soft blur. There are no halos and no hard offsets.

### Shadow Vocabulary
- **Card** (`--shadow-card`: `0 1px 2px rgb(70 45 20 / .06), 0 6px 18px -6px rgb(70 45 20 / .14)`):
  note cards and the desktop note sheet.
- **Floating** (`--shadow`: `0 1px 2px rgb(70 45 20 / .05), 0 10px 28px -6px rgb(70 45 20 / .16)`):
  menus, the place picker, the error popover, the undo bar.
- **Toolbar**: an upward version of the card shadow on the phone toolbar.

## Shapes

Soft rectangles that get rounder as they get smaller and more tappable.

- **Chips and rows** (`--r-chip`, 6px): mention chips, hovered rows, calendar days, row
  buttons. Editor highlights use 3px, because they have no padding.
- **Inner surfaces** (`--radius`, 10px): views, menus, the picker, header buttons,
  toolbar buttons.
- **Cards** (`--r-card`, 14px): note cards and the desktop sheet.
- **Pills** (999px): pinned chips and the undo bar.

## Components

### Chips (mentions and results)
- **Style:** highlighter wash background with matching ink, 1px 5px padding, 6px radius,
  0.94em, wrapping across lines with `box-decoration-break: clone`.
- **Place icons:** a place chip starts with its kind's icon at 0.8em, drawn by
  `.chip-place::before` from `data-icon`, then a word joiner so the icon never wraps away
  from the name: 🏙️ city, 🏘️ village, 🏠 neighbourhood, 🗺️ region, 🍽️ restaurant,
  ☕ café, 🍷 bar, 🛍️ shop, 🛏️ stay, 🏛️ sight, 🌳 park, 🏖️ beach, ⛰️ nature,
  ✈️ airport, 🚉 station. Streets, unknown kinds and places saved before kinds keep 📍.
  Picker rows and map marker tooltips show the same icon.
- **Phrase chips:** weather and travel results are formula chips (green). A weather word
  is replaced by its chip (`⛅ 22° / 14°`). A travel chip follows the destination and
  starts with the mode icon: `🚗 3h 05m · 313 km`, `🚶 ≈ 1h 10m · 5.8 km`,
  `🚲 ≈ 25 min · 6.1 km`, `🚆 313 km · Directions ↗`, `✈ 503 km`. "≈" marks an estimate.
- **Directions link** (`.chip-link`): inside the transit chip, in the chip's own ink,
  underlined with a 2px offset. On touch its `::before` makes a 44px-tall hit area
  without changing the chip's line box.
- **States:** pending shows a dashed outline in the chip's own ink, and for formulas a
  dashed border. Unreachable shows a dashed red outline plus ⟳. Not found shows the error
  wash with a wavy underline. An error formula is a one-line red chip that opens a popover
  on tap.

### Place picker and travel-mode popup
- **Shape:** both are the same floating list (`.picker`): paper, hairline border, 10px
  radius, floating shadow, anchored under the row being edited.
- **Rows:** a 1.5em icon column, then the name (body 600) over the label (meta, soft ink).
  The active row takes the place wash and ink. A saved row adds the "in this doc" micro
  tag. On touch, rows are at least 44px.
- **Elsewhere divider** (`.picker-divider`): a non-interactive row with a hairline top
  border and the word "Elsewhere" in micro capitals, soft ink. It separates the rows
  inside the parent's area from the rest.
- **Travel-mode popup** (`.picker-modes`): five one-line rows, mode icon then label
  (🚗 Drive, 🚶 Walk, 🚆 Public transport, 🚲 Bike, ✈ Fly). The active row takes the
  formula wash and ink, like the mode word it writes.
- **Editor highlight:** a recognised mode word (`.hl-mode`) and a weather word
  (`.hl-weather`) take the formula wash, colour only.

### Note card
- **Shape:** 14px radius, paper sheet, hairline border, card shadow. The hover border is
  ember. The focus ring is a 2px ember outline.
- **Content:** a Fraunces title (22/28, clamped to 2 lines), a meta line (the date range
  in ink 600, the relative time in ember 600), places in soft ink, and the route sketch on
  the right. The `⋯` menu (44px) is pinned to the top-right corner.

### Inputs / fields
- **Title field:** Fraunces display, transparent, with an ember caret. The placeholder is
  `--ink-soft` at full opacity. One line is 44px tall (36px line height plus 4px padding).
- **Outline editor:** transparent textarea over a highlight mirror (see the Highlight
  Changes Colour Only Rule). The caret is ember. Selection is the ember wash.

### Navigation
- **Header:** the ✦ mark in ember and the "LiveNotes" wordmark in Fraunces title. On
  desktop, Export, Import and Reset are 36px meta buttons. On phones they move into a
  `⋯` menu with 44px rows.
- **Phone toolbar:** fixed to the bottom on touch while a row is focused. 44px buttons on
  `--bg`; a pressed view toggle sits on the ember wash.

### Section head (`.section-head`)
Fraunces 600 at title size, `all-small-caps`, +0.06em tracking, soft ink. 32px above,
12px below, and no top margin as a first child. Use it for "Pinned", "Today",
"This week", "Next week", "Later", "Recent" and "Archive". The calendar's month label
and `.pinned-row__label` share the treatment.

```html
<h2 class="section-head">This week</h2>
```

### Date stamp (`.stamp`), signature move
A weekday (or month, in "Later") in micro capitals in ember, over a Fraunces day number
at display size. Numerals are tabular lining, so "11" and "18" share a width down the
rail. The stamp's ground is `var(--rail-ground, var(--bg))`, which knocks the rail line
out behind it. Add `.is-today` to turn the day number ember: large text, 4.75:1 in light
and 8.06:1 in dark.

```html
<div class="stamp is-today"><span class="stamp__weekday">Thu</span><span class="stamp__day">29</span></div>
<div class="stamp"><span class="stamp__weekday">Dec</span><span class="stamp__day">20</span></div>
```

### The rail (`.rail`), signature move
An ordered list. Each `.rail__item` is a two-column grid: the stamp in a 56px column
(48px at ≤ 440px), and `.rail__cards` holding one or more note cards. A continuous 2px
ember line runs down the stamp column and ends in an 8px ember ring, the same end mark as
the route sketch, so even a one-item rail reads as finished. Use one rail per bucket,
under that bucket's section head. If the rail ever sits on `--paper` instead of `--bg`,
set `--rail-ground: var(--paper)` on it.

```html
<h2 class="section-head">Next week</h2>
<ol class="rail">
  <li class="rail__item">
    <div class="stamp"><span class="stamp__weekday">Tue</span><span class="stamp__day">3</span></div>
    <div class="rail__cards"><!-- NoteCard(s) --></div>
  </li>
</ol>
```

### Route sketch, signature move
A small inline SVG on each card with places. The note's places are projected into the
box, joined by a 2px ember dashed line (4 4, round caps, non-scaling stroke). The first
stop is a filled dot and the last is a ring on paper. A single place is a dot with an 18%
ember halo. No tiles, no network.

### Undo bar
An ink pill with paper text, bottom-centre above the safe area, `width: max-content`. The
Undo action is underlined paper text (14.8:1), because ember on ink is only 3.1:1. It
slides up 24px with a fade, 220ms `--ease-out`.

### Motion
- **Screen entry** (`[data-screen]`): put `data-screen="home"` (or `"note"`,
  `"archive"`) on each screen's root element. It enters with a fade and an 8px rise over
  160ms `cubic-bezier(0.16, 1, 0.3, 1)` (`--dur-screen`, `--ease-out`). It animates `top`
  on a relative box rather than `transform`, because a transformed ancestor would capture
  the fixed FAB, toolbar and undo bar for those 160ms. The animation runs once per
  element, so each screen's root must be a new element (render it per route, or key it);
  changing `data-screen` on an existing element does not replay it. Animating `top` is
  layout work on the main thread; if it janks on low-end phones, move the rise to a
  `translate` on an inner wrapper that holds no fixed chrome.
- **Feedback:** 120ms (`--dur-fast`) border and opacity transitions on cards, pinned chips,
  header buttons and row menus.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, the screen entry and the
  undo-bar slide are removed, and so are the card, pinned-chip, header-button, row-menu
  and map-marker transitions.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, space, radius and shadow from `src/styles/tokens.css`.
- **Do** use Fraunces only for note titles, card titles, the wordmark, stamps and
  section heads. Everything else is Instrument Sans.
- **Do** keep 44px touch targets on phones, and check 4.5:1 (3:1 at 24px and up) for any
  new text colour in both themes.
- **Do** keep fixed-position chrome (FAB, toolbar, undo bar) working during the
  `[data-screen]` entry. Animate `opacity` and `top`, not `transform`, on screen roots.
- **Do** keep the outline readable as plain notes. Highlights are washes, not badges.

### Don't:
- **Don't** add a second accent or tint large surfaces ember. Orange is direction and now.
- **Don't** fade text to signal state. Use outline style, a wash or a label.
- **Don't** give `.hl-*` editor spans weight, padding, borders or letter-spacing, or
  change the font of only one editor layer.
- **Don't** load fonts from a network. The APK must work offline.
- **Don't** add ornament beyond the route sketch and the stamp-and-rail: no gradients,
  glass or coloured side borders on cards.
- **Don't** set synthesised small caps at micro size.
