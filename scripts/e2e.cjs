// Whole-app browser check (Playwright). Data APIs are stubbed, so it runs offline.
// Usage: npm run build && npx vite preview --port 4176 --strictPort &  then  node scripts/e2e.cjs <out-dir>
// Another port: start the preview on it and set E2E_PORT, e.g. E2E_PORT=4191 node scripts/e2e.cjs <out-dir>.
// Writes screenshots and results to <out-dir>; exits non-zero if any check fails.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = `http://localhost:${process.env.E2E_PORT || 4176}/`;
const OUT = process.argv[2];
const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push(['PASS', name, detail ?? '']);
  } catch (e) {
    results.push(['FAIL', name, String(e.message).split('\n')[0]]);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// [lat, lon, admin1, country, population, GeoNames feature code]
const TOWNS = {
  lisbon: [38.7167, -9.1333, 'Lisbon District', 'Portugal', 517802, 'PPLC'],
  porto: [41.1496, -8.611, 'Porto District', 'Portugal', 249633, 'PPLA'],
  dammam: [26.4344, 50.1033, 'Eastern Province', 'Saudi Arabia', 768602, 'PPLA'],
  khobar: [26.2794, 50.2083, 'Eastern Province', 'Saudi Arabia', 165799, 'PPL'],
  sintra: [38.8029, -9.3817, 'Lisbon District', 'Portugal', 25000, 'PPL'],
  barcelona: [41.3888, 2.159, 'Catalonia', 'Spain', 1620343, 'PPLA'],
  madrid: [40.4165, -3.7026, 'Madrid', 'Spain', 3255944, 'PPLC'],
  // A far namesake: "@airport" under Barcelona must not become this town.
  airport: [37.6305, -120.9758, 'California', 'United States', 1300, 'PPL'],
};
// Photon features. `extent` is in Photon's own order, [west, north, east, south].
const POIS = [
  { name: 'Corniche', lat: 26.30, lon: 50.22, city: 'Khobar', country: 'Saudi Arabia' },
  { name: 'Barcelona–El Prat Josep Tarradellas Airport', lat: 41.2971, lon: 2.0785, city: 'El Prat de Llobregat', country: 'Spain', osm_key: 'aeroway', osm_value: 'aerodrome', extent: [2.0525, 41.3205, 2.1147, 41.2829] },
  { name: 'Adolfo Suárez Madrid–Barajas Airport', lat: 40.4936, lon: -3.5668, city: 'Madrid', country: 'Spain', osm_key: 'aeroway', osm_value: 'aerodrome', extent: [-3.6127, 40.5363, -3.5263, 40.4517] },
  // An in-area namesake: "@Madrid" under Barcelona must still be the city.
  { name: 'Madrid', lat: 41.3915, lon: 2.165, city: 'Barcelona', country: 'Spain', osm_key: 'amenity', osm_value: 'bar' },
];
let flaky = true;

const km = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const nameMatches = (name, q) => name.toLowerCase().startsWith(q) || name.toLowerCase().split(/[\s–-]+/).some((w) => w.startsWith(q));

async function stub(page) {
  await page.route(/geocoding-api\.open-meteo\.com/, (r) => {
    const q = new URL(r.request().url()).searchParams.get('name').toLowerCase();
    if (q === 'flakyville' && flaky) return r.fulfill({ status: 503, body: 'busy' });
    const hits = Object.entries(TOWNS).filter(([k]) => k.startsWith(q) || q === 'flakyville');
    const results = q === 'flakyville' ? [{ name: 'Flakyville', latitude: 10, longitude: 10, admin1: 'X', country: 'Y' }]
      : hits.map(([k, [lat, lon, a, c, population, code]]) => ({ name: k[0].toUpperCase() + k.slice(1), latitude: lat, longitude: lon, admin1: a, country: c, population, feature_code: code }));
    r.fulfill({ json: results.length ? { results } : {} });
  });
  await page.route(/photon\.komoot\.io/, (r) => {
    const params = new URL(r.request().url()).searchParams;
    const q = params.get('q').toLowerCase();
    if (q === 'flakyville' && flaky) return r.fulfill({ status: 503, body: 'busy' });
    // bbox is west,south,east,north; like the real server, only what lies inside comes back.
    const box = params.get('bbox')?.split(',').map(Number);
    const inBox = (p) => !box || (p.lon >= box[0] && p.lon <= box[2] && p.lat >= box[1] && p.lat <= box[3]);
    const bias = params.has('lat') ? { lat: Number(params.get('lat')), lon: Number(params.get('lon')) } : null;
    const hits = POIS.filter((p) => nameMatches(p.name, q) && inBox(p))
      .sort((a, b) => (bias ? km(a, bias) - km(b, bias) : 0))
      .slice(0, Number(params.get('limit') || 15));
    r.fulfill({ json: { features: hits.map(({ lat, lon, ...properties }) => ({ geometry: { coordinates: [lon, lat] }, properties })) } });
  });
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => r.fulfill({ json: { daily: { weather_code: [1], temperature_2m_max: [22.4], temperature_2m_min: [14.2] } } }));
  // Road distance is 1.3 × the great circle at 85 km/h, so a short hop stays walkable.
  await page.route(/project-osrm/, (r) => {
    const [a, b] = new URL(r.request().url()).pathname.split('/').pop().split(';').map((c) => c.split(',').map(Number)).map(([lon, lat]) => ({ lat, lon }));
    const distance = Math.round(km(a, b) * 1300);
    r.fulfill({ json: { code: 'Ok', routes: [{ duration: Math.round(distance / (85 / 3.6)), distance }] } });
  });
  await page.route(/tile\.openstreetmap/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
}

const rowText = (page, text) => page.locator('li[data-node-id] > .row', { hasText: text }).first();

const SAMPLE = 'Portugal road trip (sample)';
const INDEX_KEY = 'livenotes:index:v1';
const LEGACY_KEY = 'livenotes:doc:v1';

const home = (page) => page.locator('[data-screen="home"]');
const noteScreen = (page) => page.locator('[data-screen="note"]');
const card = (page, title) => page.locator('.note-card-wrap', { hasText: title });
const cardLink = (page, title) => card(page, title).locator('a.note-card');
const noteIdFromUrl = (page) => decodeURIComponent(new URL(page.url()).hash.replace(/^#\/note\//, ''));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());
  // The 503s from the flaky stub are logged by the browser itself; they are expected.
  return () => errors.filter((e) => !/Failed to load resource/.test(e));
}

/** Mobile Chrome widens the layout viewport (and zooms out) to fit overflow, so scrollWidth alone can't see it. */
async function noWiderThanScreen(page) {
  const w = page.viewportSize().width;
  const m = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  assert(m[0] === w && m[1] <= w, `screen ${w}px, layout ${m[0]}px, content ${m[1]}px`);
}

/** Android's back: history.back(), fired after evaluate returns so a cross-document step can't kill the call. */
async function historyBack(page) {
  const moved = page.waitForEvent('framenavigated', { timeout: 3000 }).then(() => true, () => false);
  await page.evaluate(() => void setTimeout(() => history.back(), 0));
  const ok = await moved;
  await page.waitForLoadState();
  return ok;
}

/** Screenshots wait out the 160 ms screen fade, or they catch a half-transparent page. */
async function shot(page, file, opts = {}) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await page.screenshot({ path: path.join(OUT, file), ...opts });
}

async function gotoHome(page) {
  // A history.back() that leaves the app may still be in flight; let it finish, then go home.
  try {
    await page.goto(APP);
  } catch (e) {
    if (!/interrupted by another navigation/.test(e.message)) throw e;
    await page.waitForLoadState();
    await page.goto(APP);
  }
  await home(page).waitFor();
}

async function openNote(page, title) {
  await cardLink(page, title).first().click();
  await noteScreen(page).waitFor();
}

async function openSample(page) {
  await gotoHome(page);
  await openNote(page, SAMPLE);
  // The sample ships resolved places; wait for its formulas to settle.
  await page.locator('.chip-formula').first().waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('.chip-formula')].some((c) => c.textContent.trim() === '…'), null, { timeout: 5000 });
}

async function back(page) {
  await page.getByRole('button', { name: 'Back' }).click();
  await home(page).waitFor();
}

async function noteMenu(page, item) {
  await page.getByRole('button', { name: 'Note menu' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function cardMenu(page, title, item) {
  await card(page, title).getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** New note → title → Enter → bullet with a picked place → back. Returns the note id. */
async function createNoteWithPlace(page, title) {
  await page.getByRole('button', { name: 'New note' }).click();
  await noteScreen(page).waitFor();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  assert(focused === 'Title', `focus on ${focused}`);
  await page.keyboard.type(title, { delay: 10 });
  await page.keyboard.press('Enter');
  await page.locator('textarea.editor').waitFor();
  await page.keyboard.type('dinner @lis', { delay: 20 });
  const opt = page.locator('.picker-option', { hasText: 'Lisbon' }).first();
  await opt.waitFor({ timeout: 3000 });
  await opt.click();
  const v = await page.locator('textarea.editor').inputValue();
  assert(v.startsWith('dinner @Lisbon'), `text: ${v}`);
  const id = noteIdFromUrl(page);
  await back(page);
  return id;
}

async function libraryFlow(page, tag) {
  const T = `Lisbon dinner ${tag}`;
  let id;
  await gotoHome(page);

  await check(`${tag} library: new note → title → bullet with picked @lis → back shows card`, async () => {
    id = await createNoteWithPlace(page, T);
    await card(page, T).waitFor();
    const sketch = await card(page, T).locator('svg.route-sketch').getAttribute('aria-label');
    assert(sketch && sketch.includes('Lisbon'), `sketch label: ${sketch}`);
    const stored = await page.evaluate((k) => localStorage.getItem(k), `livenotes:note:${id}`);
    assert(stored && JSON.parse(stored).title === T, 'note not stored under its key');
    return sketch;
  });

  await check(`${tag} library: search filters, "zzz" shows no match, Clear restores`, async () => {
    const search = page.getByRole('searchbox', { name: 'Search notes' });
    // Only words the sample lacks: search matches every word anywhere in a note.
    await search.fill(`dinner ${tag}`);
    await page.getByRole('heading', { name: '1 note' }).waitFor();
    await card(page, T).waitFor();
    assert((await card(page, SAMPLE).count()) === 0, `sample still listed for "dinner ${tag}"`);
    await search.fill('zzz');
    await page.getByText('No notes match "zzz"').waitFor();
    await page.getByRole('button', { name: 'Clear' }).click();
    assert((await search.inputValue()) === '', 'query not cleared');
    await card(page, T).waitFor();
    await card(page, SAMPLE).waitFor();
  });

  await check(`${tag} library: pin shows the note in Pinned (unpin from the note)`, async () => {
    await cardMenu(page, T, 'Pin');
    const chip = page.locator('.pinned-row .pinned-chip', { hasText: T });
    await chip.waitFor();
    await chip.click();
    await noteScreen(page).waitFor();
    await noteMenu(page, 'Unpin');
    await back(page);
    assert((await page.locator('.pinned-row').count()) === 0, 'still pinned');
    await card(page, T).waitFor();
  });

  await check(`${tag} library: archive hides the note, Archive (1), unarchive restores`, async () => {
    await cardMenu(page, T, 'Archive');
    await page.getByRole('link', { name: 'Archive (1)' }).waitFor();
    assert((await card(page, T).count()) === 0, 'archived note still on home');
    await page.getByRole('link', { name: 'Archive (1)' }).click();
    await page.locator('[data-screen="archive"]').waitFor();
    await cardMenu(page, T, 'Unarchive');
    await page.getByText('Nothing archived').waitFor();
    await page.getByRole('link', { name: 'Back' }).click();
    await home(page).waitFor();
    await card(page, T).waitFor();
    assert((await page.getByRole('link', { name: /^Archive/ }).count()) === 0, 'archive link remains');
  });

  await check(`${tag} library: delete from card → "Note deleted" → Undo restores`, async () => {
    await cardMenu(page, T, 'Delete');
    await page.locator('.undo-bar', { hasText: 'Note deleted' }).waitFor();
    assert((await card(page, T).count()) === 0, 'card still shown');
    await page.getByRole('button', { name: 'Undo' }).click();
    await card(page, T).waitFor();
  });

  await check(`${tag} library: delete, wait out the undo window, gone after reload`, async () => {
    await cardMenu(page, T, 'Delete');
    await page.locator('.undo-bar').waitFor();
    await page.waitForTimeout(6500);
    assert((await page.locator('.undo-bar').count()) === 0, 'undo bar still up');
    await page.reload();
    await home(page).waitFor();
    await card(page, SAMPLE).waitFor();
    assert((await card(page, T).count()) === 0, 'deleted note came back');
    const left = await page.evaluate(([k, ik, nid]) => ({ note: localStorage.getItem(k), inIndex: JSON.parse(localStorage.getItem(ik)).notes.some((m) => m.id === nid) }), [`livenotes:note:${id}`, INDEX_KEY, id]);
    assert(left.note === null && !left.inIndex, `storage: ${JSON.stringify(left)}`);
  });

  await check(`${tag} library: delete from the note menu lands on Home with Undo`, async () => {
    const T2 = `Menu delete ${tag}`;
    await createNoteWithPlace(page, T2);
    await openNote(page, T2);
    await noteMenu(page, 'Delete');
    await home(page).waitFor();
    await page.locator('.undo-bar', { hasText: 'Note deleted' }).waitFor();
    assert((await card(page, T2).count()) === 0, 'card still shown');
    await page.getByRole('button', { name: 'Undo' }).click();
    await card(page, T2).waitFor();
  });

  await check(`${tag} library: a new empty note left with Back leaves no card`, async () => {
    const before = await page.locator('a.note-card, a.pinned-chip').count();
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('livenotes:note:')).length);
    await page.getByRole('button', { name: 'New note' }).click();
    await noteScreen(page).waitFor();
    await back(page);
    await card(page, SAMPLE).waitFor();
    const after = await page.locator('a.note-card, a.pinned-chip').count();
    const keysAfter = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('livenotes:note:')).length);
    assert(after === before && keysAfter === keysBefore && (await page.getByText('Untitled').count()) === 0, `cards ${before}->${after}, keys ${keysBefore}->${keysAfter}`);
  });
}

/** The local date `days` from today, as 2026-11-01 (no year to infer). */
function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const editor = (page) => page.locator('textarea.editor');
const modePopup = (page) => page.locator('.picker-modes');
const placeList = (page) => page.locator('.picker[aria-label="Places"]');
const richRow = (page, re) => page.locator('li[data-node-id] > .row .rich').filter({ hasText: re });
const typeSlow = (page, s) => page.keyboard.type(s, { delay: 25 });
const press = async (page, ...keys) => {
  for (const k of keys) await page.keyboard.press(k);
};
const activeTag = (page) => page.evaluate(() => document.activeElement?.tagName);
/** Each picker row as "icon name", and the divider as "--Elsewhere". */
const pickerRows = (page) =>
  placeList(page).locator(':scope > li').evaluateAll((lis) =>
    lis.map((li) => (li.classList.contains('picker-divider') ? `--${li.textContent}` : `${li.querySelector('.picker-icon').textContent} ${li.querySelector('strong').textContent}`)),
  );

/** New note → title → Enter: the caret is in the first bullet. */
async function newNote(page, title) {
  await page.getByRole('button', { name: 'New note' }).click();
  await noteScreen(page).waitFor();
  await page.keyboard.type(title, { delay: 10 });
  await page.keyboard.press('Enter');
  await editor(page).waitFor();
}

/** `@barc` → pick Barcelona, then a child bullet typing `@airport`; waits for every search stage. */
async function airportUnderBarcelona(page, tap = false) {
  await typeSlow(page, '@barc');
  const city = placeList(page).locator('.picker-option', { hasText: 'Barcelona' }).first();
  await (tap ? city.tap() : city.click());
  assert((await editor(page).inputValue()).endsWith('@Barcelona '), 'Barcelona not picked');
  await press(page, 'Enter', 'Tab');
  await typeSlow(page, '@airport');
  // The biased Photon stage is queued last; its far airport fills the Elsewhere rows.
  await placeList(page).locator('.picker-option', { hasText: 'Barajas' }).waitFor({ timeout: 8000 });
}

/** The travel-mode popup and the area picker, for screenshots in each theme and device. */
async function phraseShots(page, device, scheme) {
  await gotoHome(page);
  await newNote(page, 'Popup shots');
  await typeSlow(page, '@Lisbon ');
  await press(page, 'Enter');
  await typeSlow(page, 'to @Porto ');
  await modePopup(page).waitFor({ timeout: 3000 });
  await shot(page, `${device}-popup-${scheme}.png`);
  await press(page, 'Escape', 'Enter');
  assert((await modePopup(page).count()) === 0, 'Escape left the popup open');
  await airportUnderBarcelona(page, device === 'phone');
  await shot(page, `${device}-picker-${scheme}.png`);
  const rows = await pickerRows(page);
  assert(rows[0] === '✈️ Barcelona–El Prat Josep Tarradellas Airport' && rows[1] === '--Elsewhere', rows.join(' | '));
  await press(page, 'Escape', 'Escape');
  await back(page);
  return rows.join(' | ');
}

/** Desktop: weather word, the travel-mode popup and its chips, the table's Travel column, area search. */
async function phraseFlow(page, ctx) {
  await gotoHome(page);
  await newNote(page, 'Phrase trip');

  await check('phrases: the weather word is highlighted while typing', async () => {
    await typeSlow(page, 'Trip /table');
    await press(page, 'Enter', 'Enter', 'Tab'); // the command adds a table view; then a child bullet
    await typeSlow(page, `@Lisbon ${isoIn(2)} weather`);
    const hl = await page.locator('.editor-mirror .hl-weather').allTextContents();
    assert(hl.join() === 'weather', `highlighted: ${hl}`);
  });
  await check('phrases: "to @Porto " opens the travel-mode popup with no row selected; ↓ Enter chooses Drive', async () => {
    await press(page, 'Enter');
    await typeSlow(page, 'to @Porto ');
    await modePopup(page).waitFor({ timeout: 3000 });
    const rows = (await modePopup(page).locator('.picker-option').allTextContents()).join(' | ');
    assert(rows === '🚗Drive | 🚶Walk | 🚆Public transport | 🚲Bike | ✈Fly', rows);
    const selected = await modePopup(page).locator('[aria-selected="true"], .is-active').count();
    assert(selected === 0, `${selected} rows selected on open`);
    await shot(page, 'desktop-popup-light.png');
    await press(page, 'ArrowDown', 'Enter');
    const v = await editor(page).inputValue();
    const caret = await editor(page).evaluate((t) => t.selectionStart);
    assert(v === 'drive to @Porto ' && caret === v.length, `text "${v}", caret ${caret}`);
    assert((await modePopup(page).count()) === 0, 'popup still open');
    const hl = await page.locator('.editor-mirror .hl-mode').allTextContents();
    assert(hl.join() === 'drive', `mode word highlight: ${hl}`);
    return rows;
  });
  await check('phrases: ↓ ↓ ↓ Enter chooses Public transport', async () => {
    await press(page, 'Enter');
    await typeSlow(page, 'to @Lisbon ');
    await modePopup(page).waitFor({ timeout: 3000 });
    await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
    const v = await editor(page).inputValue();
    assert(v === 'transit to @Lisbon ', `text "${v}"`);
  });
  await check('phrases: clicking Walk writes "walk" and keeps the editor focused', async () => {
    await press(page, 'Enter');
    await typeSlow(page, 'to @Sintra ');
    await modePopup(page).locator('.picker-option', { hasText: 'Walk' }).click();
    const v = await editor(page).inputValue();
    assert(v === 'walk to @Sintra ' && (await activeTag(page)) === 'TEXTAREA', `text "${v}", focus ${await activeTag(page)}`);
  });
  await check('phrases: after picking in "to @por" the popup opens; clicking elsewhere in the text closes it', async () => {
    await press(page, 'Enter');
    await typeSlow(page, 'to @por');
    await placeList(page).locator('.picker-option', { hasText: 'Porto' }).first().click();
    assert((await editor(page).inputValue()) === 'to @Porto ', 'pick failed');
    await modePopup(page).waitFor({ timeout: 2000 });
    const box = await editor(page).boundingBox();
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    const caret = await editor(page).evaluate((t) => t.selectionStart);
    const v = await editor(page).inputValue();
    assert((await modePopup(page).count()) === 0, 'popup still open after the click');
    assert(v === 'to @Porto ' && caret === 0, `text "${v}", caret ${caret}`);
    await press(page, 'Escape');
  });
  await check('phrases: Enter right after a pick closes the popup and starts a new bullet', async () => {
    await richRow(page, /^to Porto\s*$/).click();
    await press(page, 'End', 'Enter');
    await typeSlow(page, 'to @lis');
    await placeList(page).locator('.picker-option', { hasText: 'Lisbon' }).first().click();
    await modePopup(page).waitFor({ timeout: 2000 });
    await press(page, 'Enter');
    const v = await editor(page).inputValue();
    assert((await modePopup(page).count()) === 0 && v === '', `popup ${await modePopup(page).count()}, new row "${v}"`);
    await press(page, 'Escape');
    const prev = richRow(page, /^to Lisbon\s*$/);
    assert((await prev.count()) === 1 && (await prev.locator('.chip-formula').count()) === 0, 'the picked row gained a mode word');
  });

  await check('phrases: after blur, weather and travel chips (🚗, 🚆 + Directions, 🚶 ≈); plain "to @Porto" has none', async () => {
    const chip = (re, kind) => richRow(page, re).locator(`.chip-formula.kind-${kind}`);
    await chip(/^walk to/, 'travel').waitFor({ timeout: 6000 });
    const weather = await chip(/^Lisbon/, 'weather').textContent();
    const drive = await chip(/^drive to/, 'travel').textContent();
    const transit = await chip(/^transit to/, 'travel').textContent();
    const walk = await chip(/^walk to/, 'travel').textContent();
    assert(/^⛅ 22° \/ 14°$/.test(weather), `weather: ${weather}`);
    assert(/^🚗 \d+h \d\dm · \d+ km$/.test(drive), `drive: ${drive}`);
    assert(/^🚆 \d+ km · Directions ↗$/.test(transit), `transit: ${transit}`);
    assert(/^🚶 ≈ \d+h \d\dm · \d+ km$/.test(walk), `walk: ${walk}`);
    const plain = richRow(page, /^to Porto\s*$/);
    assert((await plain.count()) === 1 && (await plain.locator('.chip-formula').count()) === 0, 'plain "to @Porto" shows a chip');
    return [weather, drive, transit, walk].join(' | ');
  });
  await check('phrases: the Directions link is Google Maps transit, opens a new tab, not the editor', async () => {
    const link = richRow(page, /^transit to/).locator('a.chip-link');
    const href = await link.getAttribute('href');
    // From the previous stop (Porto) to Lisbon.
    assert(href === 'https://www.google.com/maps/dir/?api=1&origin=41.1496,-8.611&destination=38.7167,-9.1333&travelmode=transit', href);
    assert((await link.getAttribute('target')) === '_blank' && (await link.getAttribute('rel')) === 'noopener noreferrer', 'not a new-tab link');
    const [tab] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
    await tab.waitForLoadState();
    const url = tab.url();
    await tab.close();
    assert(url.includes('travelmode=transit'), url);
    assert((await editor(page).count()) === 0, 'the click opened the row editor');
  });
  await check('table view: a Travel column holds the route chips; weather stays in Item', async () => {
    const table = page.locator('[data-view="table"]');
    const heads = await table.locator('thead th').allTextContents();
    const col = heads.indexOf('Travel') + 1;
    assert(col > 0, `headers: ${heads.join(', ')}`);
    const travel = await table.locator(`tbody td:nth-child(${col}) .kind-travel`).count();
    const inItem = await table.locator('tbody td:first-child .kind-travel').count();
    const weather = await table.locator('tbody td:first-child .kind-weather').count();
    const links = await table.locator(`tbody td:nth-child(${col}) a.chip-link`).count();
    assert(travel === 3 && inItem === 0 && weather === 1 && links === 1, `travel=${travel} inItem=${inItem} weather=${weather} links=${links}`);
    return heads.join(', ');
  });

  await check('area search: under @Barcelona, "@airport" lists the in-area ✈️ first, then Elsewhere', async () => {
    await richRow(page, /^to Porto\s*$/).click();
    await press(page, 'End', 'Enter', 'Shift+Tab');
    await airportUnderBarcelona(page);
    await shot(page, 'desktop-picker-light.png');
    const rows = await pickerRows(page);
    assert(rows[0] === '✈️ Barcelona–El Prat Josep Tarradellas Airport' && rows[1] === '--Elsewhere', rows.join(' | '));
    assert(rows.includes('🏘️ Airport') && rows.includes('✈️ Adolfo Suárez Madrid–Barajas Airport'), rows.join(' | '));
    return rows.join(' | ');
  });
  await check('area search: the picked airport is stored with its kind and extent ([w, s, e, n])', async () => {
    await placeList(page).locator('.picker-option').first().click();
    const v = await editor(page).inputValue();
    assert(v === '@[Barcelona–El Prat Josep Tarradellas Airport] ', `text "${v}"`);
    await press(page, 'Enter');
    await typeSlow(page, '@airport ');
    await press(page, 'Enter');
    await typeSlow(page, 'then @Madrid ');
    await press(page, 'Escape');
    const id = noteIdFromUrl(page);
    const key = 'barcelona–el prat josep tarradellas airport';
    await page.waitForFunction(([k, pk]) => !!JSON.parse(localStorage.getItem(k) || '{"places":{}}').places[pk], [`livenotes:note:${id}`, key], { timeout: 3000 });
    const stored = await page.evaluate(([k, pk]) => JSON.parse(localStorage.getItem(k)).places[pk], [`livenotes:note:${id}`, key]);
    assert(stored.kind === 'airport' && JSON.stringify(stored.extent) === '[2.0525,41.2829,2.1147,41.3205]', JSON.stringify(stored));
    const icon = await page.locator('.chip-place', { hasText: 'Barcelona–El Prat' }).getAttribute('data-icon');
    assert(icon === '✈️', `chip icon ${icon}`);
  });
  await check('area search: typed @airport under Barcelona is El Prat, typed @Madrid is the city', async () => {
    const airport = page.locator('.chip-place.is-resolved', { hasText: /^airport$/ });
    const madrid = page.locator('.chip-place.is-resolved', { hasText: /^Madrid$/ });
    await airport.waitFor({ timeout: 8000 });
    await madrid.waitFor({ timeout: 8000 });
    const a = [await airport.getAttribute('title'), await airport.getAttribute('data-icon')];
    const m = [await madrid.getAttribute('title'), await madrid.getAttribute('data-icon')];
    assert(a[0].startsWith('Barcelona–El Prat') && a[1] === '✈️', a.join(' '));
    assert(m[0] === 'Madrid, Spain' && m[1] === '🏙️', m.join(' '));
    return `${a.join(' ')} | ${m.join(' ')}`;
  });
  await back(page);

  await check('phrases: "forecast" with no place stays a plain word; a chained "fly to" starts from the leg before', async () => {
    await newNote(page, 'Plain words');
    await typeSlow(page, 'Q4 sales forecast review');
    await press(page, 'Enter');
    await typeSlow(page, '@Lisbon ');
    await press(page, 'Enter');
    await typeSlow(page, 'fly to @Porto then fly to @Lisbon ');
    await press(page, 'Escape');
    const q4 = richRow(page, /^Q4 sales/);
    const t = await q4.textContent();
    const tip = await q4.locator('span[title]').getAttribute('title');
    assert(t === 'Q4 sales forecast review' && (await q4.locator('.chip').count()) === 0, `Q4 row: ${t}`);
    assert(tip === 'No place here for a forecast', `tooltip: ${tip}`);
    const legs = richRow(page, /^fly to/).locator('.chip-formula.kind-travel');
    await legs.nth(1).waitFor({ timeout: 6000 });
    const titles = [await legs.nth(0).getAttribute('title'), await legs.nth(1).getAttribute('title')];
    assert(titles[0] === '{travel("fly", prev, @[porto])}' && titles[1] === '{travel("fly", @[porto], @[lisbon])}', titles.join(' | '));
    return titles.join(' | ');
  });
  await back(page);
}

(async () => {
  const browser = await chromium.launch();

  // ---------------- desktop: the sample note ----------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const desktopErrors = watchErrors(page);
  await stub(page);

  await check('home: first launch shows the sample note card', async () => {
    await gotoHome(page);
    await cardLink(page, SAMPLE).waitFor();
    const n = await page.locator('a.note-card').count();
    assert(n === 1, `cards=${n}`);
  });
  await openSample(page);
  const sampleId = noteIdFromUrl(page);

  await check('sample: place chips resolved instantly (no lookups needed)', async () => {
    const missing = await page.locator('.chip-place:not(.is-resolved)').count();
    const total = await page.locator('.chip-place').count();
    assert(missing === 0, `${missing}/${total} unresolved`);
    return `${total} chips`;
  });
  await check('sample: place chips show their kind icon (🏙️ city, 🍽️ restaurant, 🛍️ shop), none 📍', async () => {
    const icon = (name) => page.locator('.chip-place', { hasText: name }).first().getAttribute('data-icon');
    const got = [await icon('Lisbon'), await icon('Time Out Market'), await icon('Livraria Lello'), await icon('Pinhão')];
    assert(got.join(' ') === '🏙️ 🍽️ 🛍️ 🏘️', got.join(' '));
    const pins = await page.locator('.chip-place[data-icon="📍"]').count();
    assert(pins === 0, `${pins} chips still show 📍`);
    return got.join(' ');
  });
  await check('sample: "How this works" teaches the phrases as plain words', async () => {
    const how = rowText(page, 'How this works');
    const t = await how.textContent();
    assert(t.includes('plain words like weather or drive to @Place'), t);
    assert((await how.locator('.chip-formula').count()) === 0, 'the phrases there became chips');
  });
  await check('sample: the travel chip sits a spacing step after its destination chip', async () => {
    const row = rowText(page, 'drive from');
    await row.locator('.chip-formula.kind-travel').waitFor();
    const porto = await row.locator('.chip-place', { hasText: 'Porto' }).boundingBox();
    const chip = await row.locator('.chip-formula.kind-travel').boundingBox();
    const gap = chip.x - (porto.x + porto.width);
    assert(gap >= 4 && gap <= 8 && Math.abs(chip.y - porto.y) < 4, `gap ${gap.toFixed(1)} px`);
    return `${gap.toFixed(1)} px`;
  });
  await check('sample: formulas (weather, route, distance) render values', async () => {
    const t = await page.locator('.chip-formula').allTextContents();
    assert(t.some((x) => x.includes('°')), 'no weather');
    assert(t.some((x) => x.includes('🚗')), 'no route');
    assert(t.some((x) => /^\d+ km$/.test(x)), 'no distance');
    assert(!t.some((x) => x.startsWith('⚠')), 'error chip: ' + t.find((x) => x.startsWith('⚠')));
    return t.slice(0, 4).join(' | ');
  });
  await check('sample: phrases render ("drive from @Lisbon to @Porto", "Porto weather")', async () => {
    const drive = await rowText(page, 'drive from').locator('.chip-formula.kind-travel').textContent();
    assert(/^🚗 \d+h \d\dm · \d+ km$/.test(drive), `drive chip: ${drive}`);
    // The word itself becomes the chip.
    const rich = page.locator('li[data-node-id] > .row .rich').filter({ hasText: /^Porto\s/ }).filter({ has: page.locator('.kind-weather') });
    const w = await rich.locator('.chip-formula.kind-weather').textContent();
    const words = await rich.textContent();
    assert(/^⛅ 22° \/ 14°$/.test(w) && !words.includes('weather'), `weather row: ${words}`);
    return `${drive} | ${w}`;
  });
  await check('map view: 3 numbered markers for explore-Lisbon', async () => {
    await page.locator('[data-view="map"] .map-marker').first().waitFor();
    const n = await page.locator('[data-view="map"] .map-marker').count();
    assert(n === 3, `markers=${n}`);
  });
  await check('calendar view: 4 day entries', async () => {
    const n = await page.locator('[data-view="calendar"] .month-grid .entry').count();
    assert(n === 4, `entries=${n}`);
  });
  await check('table view: 3 rows with formula column', async () => {
    const n = await page.locator('[data-view="table"] tbody tr').count();
    const chips = await page.locator('[data-view="table"] tbody .chip-formula').count();
    assert(n === 3 && chips === 3, `rows=${n} chips=${chips}`);
  });
  await check('linked hover: row → map marker highlighted', async () => {
    await rowText(page, 'Morning:').hover();
    await page.locator('.map-marker.is-hovered').waitFor({ timeout: 1000 });
    assert((await page.locator('.map-marker.is-hovered').count()) === 1, 'no highlighted marker');
  });
  await check('clicking a map marker focuses its bullet', async () => {
    await page.locator('[data-view="map"] .map-marker').nth(1).click();
    await page.locator('textarea.editor').waitFor();
    const v = await page.locator('textarea.editor').inputValue();
    assert(v.includes('Pastéis'), `editing: ${v}`);
    await page.keyboard.press('Escape');
  });
  await check('clicking a calendar entry focuses its bullet', async () => {
    await page.locator('[data-view="calendar"] .month-grid .entry').first().click();
    const v = await page.locator('textarea.editor').inputValue();
    assert(v.includes('fly into'), `editing: ${v}`);
    await page.keyboard.press('Escape');
  });

  await check('editing: highlight while typing + picker + pick inserts mention', async () => {
    await rowText(page, 'Bookshop').locator('.rich').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' then @dam', { delay: 20 });
    assert((await page.locator('.editor-mirror .hl-place').last().textContent()) === '@dam', 'no live highlight');
    await page.locator('.picker-option').first().waitFor({ timeout: 3000 });
    const label = await page.locator('.picker-option').first().textContent();
    await page.locator('.picker-option').first().click();
    const v = await page.locator('textarea.editor').inputValue();
    assert(v.endsWith('@Dammam '), `text: ${v}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const chip = page.locator('.chip-place', { hasText: 'Dammam' });
    await chip.waitFor();
    const title = await chip.getAttribute('title');
    assert(title && title.includes('Saudi Arabia'), `title=${title}`);
    return label;
  });
  await check('typed mention without picking resolves after leaving the row', async () => {
    await rowText(page, 'Port tasting').locator('.rich').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' and @khobar', { delay: 10 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.chip-place.is-resolved', { hasText: 'khobar' }).waitFor({ timeout: 4000 });
  });
  await check('unknown place shows "not found" (after real empty answers)', async () => {
    await rowText(page, 'Port tasting').locator('.rich').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @Zzyzzx', { delay: 10 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.chip-place.is-missing', { hasText: 'Zzyzzx' }).waitFor({ timeout: 6000 });
  });
  await check('unreachable service shows retrying, then resolves on retry', async () => {
    flaky = true;
    await rowText(page, 'Port tasting').locator('.rich').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @Flakyville', { delay: 10 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.chip-place.is-error', { hasText: 'Flakyville' }).waitFor({ timeout: 12000 });
    flaky = false;
    await page.locator('.chip-place.is-resolved', { hasText: 'Flakyville' }).waitFor({ timeout: 8000 });
  });

  await check('keys: Enter new bullet, Tab indent, Shift+Tab outdent', async () => {
    await rowText(page, 'Bookshop').locator('.rich').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('KEYTEST');
    await page.keyboard.press('Tab');
    const nestedUnderBookshop = await page.locator('li[data-node-id]', { has: page.locator('> .row', { hasText: 'Bookshop' }) }).locator('li textarea.editor').count();
    assert(nestedUnderBookshop === 1, 'Tab did not nest');
    await page.keyboard.press('Shift+Tab');
    const stillNested = await page.locator('li[data-node-id]', { has: page.locator('> .row', { hasText: 'Bookshop' }) }).locator('li textarea.editor').count();
    assert(stillNested === 0, 'Shift+Tab did not outdent');
  });
  await check('keys: Alt+Shift+Up moves, Backspace at start merges, Backspace on empty deletes', async () => {
    await page.keyboard.press('Alt+Shift+ArrowUp');
    const order = await page.locator('li[data-node-id] > .row').allTextContents();
    const i = order.findIndex((t) => t.includes('KEYTEST'));
    assert(i > 0 && order[i + 1].includes('Bookshop'), 'move up failed');
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    let v = await page.locator('textarea.editor').inputValue();
    assert(v.endsWith('KEYTEST'), `merge: ${v}`);
    // the caret sits at the join point; remove the merged text from the end, then test empty-delete
    await page.keyboard.press('End');
    for (let k = 0; k < 7; k++) await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    v = await page.locator('textarea.editor').inputValue();
    assert(!v.includes('KEYTEST'), `delete: ${v}`);
    await page.keyboard.press('Escape');
  });
  await check('keys: Ctrl+. collapses and expands', async () => {
    await rowText(page, 'Maybe / ideas').locator('.rich').click();
    await page.keyboard.press('Control+.');
    const hidden = await page.locator('.row', { hasText: 'Day trip to' }).count();
    await page.keyboard.press('Control+.');
    const shown = await page.locator('.row', { hasText: 'Day trip to' }).count();
    await page.keyboard.press('Escape');
    // table view still lists items when collapsed, so count rows only
    assert(hidden < shown, `hidden=${hidden} shown=${shown}`);
  });
  await check('slash command: /calendar adds a view, /none removes it', async () => {
    await rowText(page, 'Maybe / ideas').locator('.rich').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' /calendar');
    await page.keyboard.press('Enter');
    const has = await page.locator('li[data-node-id]', { has: page.locator('> .row', { hasText: 'Maybe / ideas' }) }).locator('> [data-view="calendar"]').count();
    await page.keyboard.type(' /table');
    await page.keyboard.press('Enter');
    const v = await page.locator('textarea.editor').inputValue();
    await page.keyboard.press('Escape');
    assert(has === 1 && v === 'Maybe / ideas', `has=${has} text=${v}`);
  });
  await check('persistence: edits survive reload (livenotes:note:<id> + index)', async () => {
    // The save is debounced 300 ms; wait for it to land rather than guessing.
    await page.waitForFunction((k) => (localStorage.getItem(k) || '').includes('@Dammam'), `livenotes:note:${sampleId}`, { timeout: 3000 });
    const indexed = await page.evaluate(([ik, id]) => JSON.parse(localStorage.getItem(ik)).notes.some((m) => m.id === id), [INDEX_KEY, sampleId]);
    assert(indexed, 'note missing from livenotes:index:v1');
    await page.reload();
    await noteScreen(page).waitFor();
    await page.locator('.chip-place', { hasText: 'Dammam' }).waitFor();
    assert((await page.locator('.chip-place', { hasText: 'Dammam' }).count()) === 1, 'Dammam mention lost');
  });
  await check('other tab: edits in one tab appear in the other (same note)', async () => {
    const other = await ctx.newPage();
    await stub(other);
    await other.goto(APP + `#/note/${encodeURIComponent(sampleId)}`);
    await noteScreen(other).waitFor();
    await rowText(page, 'Bookshop').locator('.rich').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' TABSYNC');
    await page.keyboard.press('Escape');
    await other.locator('text=TABSYNC').waitFor({ timeout: 3000 });
    // and home in the other tab picks up the index change too
    await other.getByRole('button', { name: 'Back' }).click();
    await home(other).waitFor();
    await cardLink(other, SAMPLE).waitFor();
    await other.close();
  });
  await check('export (note menu) downloads portugal-road-trip-sample.json', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), noteMenu(page, 'Export')]);
    const file = path.join(OUT, 'export.json');
    await dl.saveAs(file);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(dl.suggestedFilename() === 'portugal-road-trip-sample.json', `name=${dl.suggestedFilename()}`);
    assert(doc.version === 1 && doc.title === SAMPLE && JSON.stringify(doc).includes('TABSYNC'), 'bad export');
    return dl.suggestedFilename();
  });
  await check('header does not get covered by the map when scrolling', async () => {
    await page.locator('[data-view="map"]').scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(200);
    const box = await page.locator('.note-bar').boundingBox();
    const topEl = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.note-bar') !== null, [box.x + box.width / 2, box.y + box.height / 2]);
    assert(box.y <= 1 && topEl, `bar y=${box.y}, covered=${!topEl}`);
  });
  await check('import note (home menu) adds the note and opens it', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(OUT, 'export.json'), 'utf8'));
    const first = doc.nodes[doc.rootId].children[0];
    doc.nodes[first].text = 'IMPORTED TRIP';
    doc.title = 'Imported trip';
    fs.writeFileSync(path.join(OUT, 'import.json'), JSON.stringify(doc));
    await back(page);
    await page.getByRole('button', { name: 'More' }).click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Import note' }).click()]);
    await chooser.setFiles(path.join(OUT, 'import.json'));
    await noteScreen(page).waitFor();
    await rowText(page, 'IMPORTED TRIP').waitFor({ timeout: 2000 });
    assert(noteIdFromUrl(page) !== sampleId, 'import overwrote the sample');
    await back(page);
    await cardLink(page, 'Imported trip').waitFor();
    await cardLink(page, SAMPLE).waitFor();
  });
  await check('add sample note (home menu) creates a fresh sample', async () => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Add sample note' }).click();
    await noteScreen(page).waitFor();
    await rowText(page, 'Portugal road trip').waitFor();
    assert((await page.locator('text=TABSYNC').count()) === 0, 'fresh sample carries edits');
    assert(noteIdFromUrl(page) !== sampleId, 'same note');
    await back(page);
    const n = await cardLink(page, SAMPLE).count();
    assert(n === 2, `sample cards=${n}`);
  });
  await check('desktop: no JavaScript errors (sample note)', async () => {
    const e = desktopErrors();
    assert(e.length === 0, e.join(' / '));
  });
  await ctx.close();

  // ---------------- desktop: library flow + screenshots ----------------
  for (const scheme of ['light', 'dark']) {
    const lctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const lp = await lctx.newPage();
    lp.setDefaultTimeout(10000);
    const lerr = watchErrors(lp);
    await stub(lp);
    await gotoHome(lp);
    await cardLink(lp, SAMPLE).waitFor();
    await shot(lp, `desktop-home-${scheme}.png`);
    await openSample(lp);
    await lp.locator('[data-view="map"] .map-marker').first().waitFor();
    await shot(lp, `desktop-note-${scheme}.png`, { fullPage: true });
    if (scheme === 'light') {
      await check('desktop: New note sits in the header (no FAB)', async () => {
        await back(lp);
        const header = await lp.locator('.home-header').getByRole('button', { name: 'New note' }).count();
        const fab = await lp.locator('.fab').count();
        assert(header === 1 && fab === 0, `header=${header} fab=${fab}`);
      });
      await libraryFlow(lp, 'desktop');
      await shot(lp, 'desktop-home-library.png');
    }
    await check(`desktop ${scheme}: no JavaScript errors (library)`, async () => {
      const e = lerr();
      assert(e.length === 0, e.join(' / '));
    });
    await lctx.close();
  }

  // ---------------- desktop: phrases, travel modes, area search ----------------
  for (const scheme of ['light', 'dark']) {
    const fctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    // The Directions link leaves the app; answer it locally.
    await fctx.route(/www\.google\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<title>Directions</title>' }));
    const fp = await fctx.newPage();
    fp.setDefaultTimeout(10000);
    const ferr = watchErrors(fp);
    await stub(fp);
    if (scheme === 'light') await phraseFlow(fp, fctx);
    else await check('desktop dark: travel-mode popup and area picker render', () => phraseShots(fp, 'desktop', 'dark'));
    await check(`desktop ${scheme}: no JavaScript errors (phrases)`, async () => {
      const e = ferr();
      assert(e.length === 0, e.join(' / '));
    });
    await fctx.close();
  }

  // ---------------- upgrade migration ----------------
  await check('upgrade: a legacy single doc becomes the first note, unchanged', async () => {
    const legacy = JSON.parse(fs.readFileSync(path.join(OUT, 'export.json'), 'utf8'));
    delete legacy.title;
    legacy.nodes[legacy.nodes[legacy.rootId].children[0]].text = 'Migrated Portugal trip';
    const mctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Seed once, before the app's first script runs; a reload must not re-seed.
    await mctx.addInitScript(([key, raw]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        localStorage.setItem(key, raw);
      }
    }, [LEGACY_KEY, JSON.stringify(legacy)]);
    const mp = await mctx.newPage();
    mp.setDefaultTimeout(10000);
    const merr = watchErrors(mp);
    await stub(mp);
    await gotoHome(mp);
    await cardLink(mp, 'Migrated Portugal trip').waitFor();
    const st = await mp.evaluate(([lk, ik]) => {
      const index = JSON.parse(localStorage.getItem(ik));
      return { legacy: localStorage.getItem(lk), ids: index.notes.map((m) => m.id), docs: index.notes.map((m) => localStorage.getItem('livenotes:note:' + m.id)) };
    }, [LEGACY_KEY, INDEX_KEY]);
    assert(st.legacy === null, 'legacy key still present');
    assert(st.ids.length === 1, `notes=${st.ids.length}`);
    assert(JSON.stringify(canon(JSON.parse(st.docs[0]))) === JSON.stringify(canon(legacy)), 'migrated content differs');
    assert((await cardLink(mp, SAMPLE).count()) === 0, 'sample seeded on top of the migrated note');
    await mp.reload();
    await home(mp).waitFor();
    assert((await mp.locator('a.note-card').count()) === 1, 'reload changed the library');
    await openNote(mp, 'Migrated Portugal trip');
    await rowText(mp, 'Migrated Portugal trip').waitFor();
    const e = merr();
    assert(e.length === 0, e.join(' / '));
    await mctx.close();
  });

  // ---------------- phone ----------------
  for (const scheme of ['light', 'dark']) {
    const pctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: scheme });
    const p = await pctx.newPage();
    p.setDefaultTimeout(10000);
    const perr = watchErrors(p);
    await stub(p);
    await gotoHome(p);
    await cardLink(p, SAMPLE).waitFor();
    await shot(p, `phone-home-${scheme}.png`);
    await openSample(p);
    await p.locator('[data-view="map"] .map-marker').first().waitFor();
    await shot(p, `phone-note-${scheme}.png`);
    if (scheme === 'light') {
      await check('phone: note header is one compact row with a menu (Export inside)', async () => {
        const h = (await p.locator('.note-bar').boundingBox()).height;
        await p.getByRole('button', { name: 'Note menu' }).tap();
        const visible = await p.getByRole('menuitem', { name: 'Export' }).isVisible();
        await p.getByRole('button', { name: 'Note menu' }).tap();
        assert(h < 80 && visible, `height=${h} menu=${visible}`);
        return `${Math.round(h)}px`;
      });
      await check('phone: row view buttons hidden, toolbar has view toggles', async () => {
        const menus = await p.locator('.node-menu').first().isVisible();
        await rowText(p, 'Bookshop').locator('.rich').tap();
        await p.locator('.mobile-toolbar').waitFor();
        const toggles = await p.locator('.mobile-toolbar .toolbar-view').count();
        await shot(p, 'phone-editing.png');
        assert(!menus && toggles === 3, `rowMenusVisible=${menus} toggles=${toggles}`);
      });
      await check('phone: picker works by tapping', async () => {
        await p.keyboard.press('End');
        await p.keyboard.type(' @por', { delay: 20 });
        await p.locator('.picker-option').first().waitFor({ timeout: 3000 });
        await shot(p, 'phone-picker.png');
        await p.locator('.picker-option').first().tap();
        const v = await p.locator('textarea.editor').inputValue();
        assert(v.includes('@Porto'), v);
        const focused = await p.evaluate(() => document.activeElement?.tagName);
        assert(focused === 'TEXTAREA', 'lost focus');
      });
      await check('phone: toolbar indent/outdent/move/delete and table toggle', async () => {
        await p.getByRole('button', { name: 'Outdent' }).tap();
        await p.getByRole('button', { name: 'Indent' }).tap();
        await p.getByRole('button', { name: 'Move up' }).tap();
        await p.getByRole('button', { name: 'Move down' }).tap();
        await p.getByRole('button', { name: 'Table view' }).tap();
        const tbl = await p.locator('li[data-node-id]', { has: p.locator('> .row textarea') }).locator('> [data-view="table"]').count();
        await p.getByRole('button', { name: 'Table view' }).tap();
        const before = await p.locator('li[data-node-id]').count();
        await p.getByRole('button', { name: 'Delete bullet' }).tap();
        const after = await p.locator('li[data-node-id]').count();
        assert(tbl === 1 && after === before - 1, `table=${tbl} rows ${before}->${after}`);
      });
      await check('phone: calendar shows an agenda list', async () => {
        await p.keyboard.press('Escape');
        const visible = await p.locator('[data-view="calendar"] .agenda').isVisible();
        const items = await p.locator('[data-view="calendar"] .agenda li').count();
        assert(visible && items === 4, `visible=${visible} items=${items}`);
      });
      await check('phone: no horizontal page scroll (note)', async () => {
        await noWiderThanScreen(p);
      });
      await check('phone: history.back() from a note returns to Home', async () => {
        await historyBack(p);
        await home(p).waitFor();
        assert(new URL(p.url()).hash === '' || new URL(p.url()).hash === '#/', p.url());
      });
      await check('phone: FAB "New note" is visible and creates a note', async () => {
        const fab = p.locator('.fab');
        assert(await fab.isVisible(), 'no FAB');
        const box = await fab.boundingBox();
        const vp = p.viewportSize();
        assert(box.y + box.height <= vp.height && box.x + box.width <= vp.width, `FAB off-screen ${JSON.stringify(box)}`);
        assert((await p.locator('.home-header').getByRole('button', { name: 'New note' }).count()) === 0, 'header button on phone');
        await fab.tap();
        await noteScreen(p).waitFor();
        const focused = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
        assert(focused === 'Title', `focus on ${focused}`);
        await p.keyboard.type('FAB note');
        await back(p);
        await cardLink(p, 'FAB note').waitFor();
      });
      await check('phone: back after deleting a note never lands on it (no loop)', async () => {
        await openNote(p, 'FAB note');
        const deleted = new URL(p.url()).hash;
        await noteMenu(p, 'Delete');
        await home(p).waitFor();
        await historyBack(p);
        assert(new URL(p.url()).hash !== deleted, `back landed on ${deleted}`);
        assert((await noteScreen(p).count()) === 0, 'note screen shown');
        await historyBack(p);
        const url = p.url();
        assert(!url.includes(deleted), `second back landed on ${url}`);
        if (url.startsWith(APP)) assert((await noteScreen(p).count()) === 0, 'note screen shown');
        return url;
      });
      await check('phone: back after a bad note link never loops', async () => {
        await gotoHome(p);
        await p.evaluate(() => (location.hash = '#/note/does-not-exist'));
        await p.waitForFunction(() => location.hash === '#/' || location.hash === '');
        await home(p).waitFor();
        await historyBack(p);
        assert(!p.url().includes('does-not-exist'), `back landed on ${p.url()}`);
      });
      await check('phone: tapping a travel mode keeps the keyboard (textarea stays focused); 44px targets', async () => {
        await gotoHome(p);
        await newNote(p, 'Phone route');
        await typeSlow(p, '@Lisbon ');
        await press(p, 'Enter');
        await typeSlow(p, 'to @Porto ');
        const transit = modePopup(p).locator('.picker-option', { hasText: 'Public transport' });
        await transit.waitFor({ timeout: 3000 });
        const rowH = (await transit.boundingBox()).height;
        await transit.tap();
        const v = await p.locator('textarea.editor').inputValue();
        const focused = await activeTag(p);
        assert(v === 'transit to @Porto ' && focused === 'TEXTAREA', `text "${v}", focus ${focused}`);
        await press(p, 'Escape');
        const link = richRow(p, /^transit to/).locator('a.chip-link');
        await link.waitFor({ timeout: 6000 });
        const hit = await link.evaluate((a) => getComputedStyle(a, '::before').height);
        assert(rowH >= 44 && hit === '44px', `popup row ${rowH}px, link hit area ${hit}`);
        await back(p);
        return `row ${Math.round(rowH)}px, link ${hit}`;
      });
      await libraryFlow(p, 'phone');
      await check('phone: no horizontal page scroll (home)', async () => {
        await gotoHome(p);
        await cardLink(p, SAMPLE).waitFor();
        await noWiderThanScreen(p);
      });
    }
    await check(`phone ${scheme}: travel-mode popup and area picker render`, () => phraseShots(p, 'phone', scheme));
    // Last: a fullPage screenshot resets Chromium's touch emulation, so (pointer: coarse) stops matching.
    await openSample(p);
    await p.locator('[data-view="map"] .map-marker').first().waitFor();
    await shot(p, `phone-note-${scheme}-full.png`, { fullPage: true });
    await check(`phone ${scheme}: no JavaScript errors`, async () => {
      const e = perr();
      assert(e.length === 0, e.join(' / '));
    });
    await pctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? '  — ' + d : ''}`);
  console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
  if (results.some((r) => r[0] !== 'PASS')) process.exitCode = 1;
})();
