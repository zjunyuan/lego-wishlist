// Daily job: rebuilds the catalogue from Rebrickable's public CSV files,
// then looks up Singapore prices on BuyWhere. Needs no API keys or packages.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SETS_CSV = 'https://cdn.rebrickable.com/media/downloads/sets.csv.gz';
const THEMES_CSV = 'https://cdn.rebrickable.com/media/downloads/themes.csv.gz';
const SEARCH = 'https://api.buywhere.ai/v1/products/search';
const THEMES = ['City', 'Speed Champions'];
const MIN_PARTS = 30;
const DELAY_MS = 1200;

// Sellers we trust to send a genuine, new set.
const TRUSTED = [
  { test: /toysrus/i, name: 'Toys"R"Us' },
  { test: /bricks?\s*_?-?world/i, name: 'Bricks World' },
  { test: /fairprice/i, name: 'FairPrice' },
  { test: /(^|\s)metro[\s_.-]/i, name: 'Metro' },
  { test: /(^|[\s_-])og([\s_.-]|$)/i, name: 'OG' },
  { test: /(shopee|lazada)[^a-z]*(sg[^a-z]*)?lego[^a-z]*official|lego[^a-z]*official/i, name: 'LEGO official store' },
];

// Words that mean a listing is an add-on or not a new, complete set.
const JUNK = /compatible|moc\b|instructions?\b|manual only|sticker|\bled\b|light(ing)? kit|display (case|box)|acrylic|used\b|second.?hand|pre-?owned|open(ed)? box|minifig(ure)?s? only|custom|building blocks? set compatible/i;

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// Maps each wanted theme and its subthemes to the top-level theme name.
function themeLabels(themes) {
  const labels = new Map(themes.filter(t => THEMES.includes(t.name) && !t.parent_id).map(t => [t.id, t.name]));
  for (let grew = true; grew;) {
    grew = false;
    for (const t of themes) {
      if (labels.has(t.parent_id) && !labels.has(t.id)) { labels.set(t.id, labels.get(t.parent_id)); grew = true; }
    }
  }
  return labels;
}

export function selectSets(themes, sets, minYear) {
  const labels = themeLabels(themes);
  return sets
    .filter(s => labels.has(s.theme_id) && Number(s.year) >= minYear && Number(s.num_parts) >= MIN_PARTS)
    .filter(s => /^\d{4,6}-1$/.test(s.set_num) && s.img_url)
    .map(s => ({
      num: s.set_num.replace(/-1$/, ''),
      name: s.name,
      theme: labels.get(s.theme_id),
      year: Number(s.year),
      parts: Number(s.num_parts),
      img: s.img_url,
    }))
    .sort((a, b) => b.year - a.year || b.parts - a.parts);
}

function trustedName(listing) {
  const id = `${listing.merchant_id ?? ''} ${listing.merchant_slug ?? ''} ${listing.merchant_name ?? ''}`;
  return TRUSTED.find(t => t.test.test(id))?.name ?? null;
}

// Keeps only real Singapore listings for this exact set, then takes the
// cheapest from a trusted seller, or the cheapest other one flagged as unchecked.
export function pickPrice(listings, num) {
  const hasNum = new RegExp(`(^|\\D)${num}(\\D|$)`);
  const good = listings
    .filter(l => l.price?.currency === 'SGD' && Number(l.price?.amount) > 0)
    .filter(l => l.country_code === 'SG')
    .filter(l => hasNum.test(l.title ?? ''))
    .filter(l => !JUNK.test(l.title ?? ''))
    .filter(l => /^https:\/\//.test(l.url ?? ''))
    .map(l => ({
      amount: Number(l.price.amount),
      currency: 'SGD',
      seller: trustedName(l) ?? l.merchant_name ?? l.merchant ?? 'Online seller',
      trusted: Boolean(trustedName(l)),
      url: l.url,
      lastSeen: l.updated_at ?? null,
    }))
    .sort((a, b) => b.trusted - a.trusted || a.amount - b.amount);
  return good[0] ?? null;
}

async function fetchGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
}

async function search(num, retry = true) {
  const url = new URL(SEARCH);
  url.searchParams.set('q', `LEGO ${num}`);
  url.searchParams.set('deliver_to', 'SG');
  url.searchParams.set('include_unshippable', 'false');
  const res = await fetch(url);
  if (res.status === 429 && retry) {
    const wait = Number(res.headers.get('retry-after')) || 60;
    await new Promise(r => setTimeout(r, wait * 1000));
    return search(num, false);
  }
  if (!res.ok) throw new Error(`BuyWhere returned ${res.status} for ${num}`);
  const body = await res.json();
  return Array.isArray(body.data) ? body.data : [];
}

async function main() {
  const root = new URL('../data/', import.meta.url);
  const minYear = new Date().getFullYear() - 1;

  const themes = parseCsv(await fetchGz(THEMES_CSV));
  const sets = parseCsv(await fetchGz(SETS_CSV));
  const catalogue = selectSets(themes, sets, minYear);
  if (catalogue.length < 20) throw new Error(`Only ${catalogue.length} sets found, keeping the old catalogue`);
  await writeFile(new URL('sets.json', root), JSON.stringify(catalogue, null, 1) + '\n');
  const count = name => catalogue.filter(s => s.theme === name).length;
  console.log(`Catalogue: ${THEMES.map(t => `${count(t)} ${t}`).join(', ')} from ${minYear} onwards`);

  const old = JSON.parse(await readFile(new URL('prices.json', root), 'utf8'));
  const prices = {};
  let failed = 0, found = 0;
  for (const set of catalogue) {
    try {
      const best = pickPrice(await search(set.num), set.num);
      if (best) { prices[set.num] = best; found++; }
      else if (old.prices?.[set.num]) prices[set.num] = old.prices[set.num];
    } catch (err) {
      failed++;
      console.warn(err.message);
      if (old.prices?.[set.num]) prices[set.num] = old.prices[set.num];
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  if (failed > catalogue.length / 2) throw new Error(`${failed} price lookups failed, keeping the old prices`);
  await writeFile(new URL('prices.json', root), JSON.stringify({ generatedAt: new Date().toISOString(), prices }, null, 1) + '\n');
  console.log(`Prices: ${found} found today, ${Object.keys(prices).length} kept, ${failed} failed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
