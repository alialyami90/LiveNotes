// Whole-app browser check (Playwright). Data APIs are stubbed, so it runs offline.
// Usage: npm run build && npx vite preview --port 4176 --strictPort &  then  node scripts/e2e.cjs <out-dir>
// Writes screenshots and results to <out-dir>; exits non-zero if any check fails.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:4176/';
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

const TOWNS = {
  lisbon: [38.7167, -9.1333, 'Lisbon District', 'Portugal'],
  porto: [41.1496, -8.611, 'Porto District', 'Portugal'],
  dammam: [26.4344, 50.1033, 'Eastern Province', 'Saudi Arabia'],
  khobar: [26.2794, 50.2083, 'Eastern Province', 'Saudi Arabia'],
};
const POIS = { 'corniche': [26.30, 50.22, 'Khobar', 'Saudi Arabia'] };
let flaky = true;

async function stub(page) {
  await page.route(/geocoding-api\.open-meteo\.com/, (r) => {
    const q = new URL(r.request().url()).searchParams.get('name').toLowerCase();
    if (q === 'flakyville' && flaky) return r.fulfill({ status: 503, body: 'busy' });
    const hits = Object.entries(TOWNS).filter(([k]) => k.startsWith(q) || q === 'flakyville');
    const results = q === 'flakyville' ? [{ name: 'Flakyville', latitude: 10, longitude: 10, admin1: 'X', country: 'Y' }]
      : hits.map(([k, [lat, lon, a, c]]) => ({ name: k[0].toUpperCase() + k.slice(1), latitude: lat, longitude: lon, admin1: a, country: c }));
    r.fulfill({ json: results.length ? { results } : {} });
  });
  await page.route(/photon\.komoot\.io/, (r) => {
    const q = new URL(r.request().url()).searchParams.get('q').toLowerCase();
    if (q === 'flakyville' && flaky) return r.fulfill({ status: 503, body: 'busy' });
    const hits = Object.entries(POIS).filter(([k]) => k.startsWith(q));
    r.fulfill({ json: { features: hits.map(([k, [lat, lon, city, country]]) => ({ geometry: { coordinates: [lon, lat] }, properties: { name: 'Corniche', city, country } })) } });
  });
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => r.fulfill({ json: { daily: { weather_code: [1], temperature_2m_max: [22.4], temperature_2m_min: [14.2] } } }));
  await page.route(/project-osrm/, (r) => r.fulfill({ json: { code: 'Ok', routes: [{ duration: 11760, distance: 289400 }] } }));
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
  await check('sample: formulas (weather, route, distance) render values', async () => {
    const t = await page.locator('.chip-formula').allTextContents();
    assert(t.some((x) => x.includes('°')), 'no weather');
    assert(t.some((x) => x.includes('🚗')), 'no route');
    assert(t.some((x) => /^\d+ km$/.test(x)), 'no distance');
    assert(!t.some((x) => x.startsWith('⚠')), 'error chip: ' + t.find((x) => x.startsWith('⚠')));
    return t.slice(0, 4).join(' | ');
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
      await libraryFlow(p, 'phone');
      await check('phone: no horizontal page scroll (home)', async () => {
        await gotoHome(p);
        await cardLink(p, SAMPLE).waitFor();
        await noWiderThanScreen(p);
      });
    }
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
