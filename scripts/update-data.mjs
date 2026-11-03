// Daily job: rebuilds the catalogue from Rebrickable's public CSV files and
// fetches the yen to Singapore dollar rate.
// Needs no API keys or packages.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SETS_CSV = 'https://cdn.rebrickable.com/media/downloads/sets.csv.gz';
const THEMES_CSV = 'https://cdn.rebrickable.com/media/downloads/themes.csv.gz';
const THEMES = ['City', 'Speed Champions'];
const FX = 'https://api.frankfurter.dev/v1/latest?base=JPY&symbols=SGD';
const MIN_PARTS = 30;

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

// Sets taken off the list: named ones, gift-with-purchase sets and any above the MSRP limit.
export function keepSet(num, removed, details) {
  if (removed.sets.includes(num)) return false;
  const [, price, stock] = details[num] ?? [];
  return stock !== 'Gift with purchase' && !(price > removed.maxMsrp);
}

async function fetchGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
}

async function updateFx(root) {
  const res = await fetch(FX);
  if (!res.ok) throw new Error(`Exchange rate returned ${res.status}`);
  const body = await res.json();
  const sgdPerJpy = body.rates?.SGD;
  if (!(sgdPerJpy > 0)) throw new Error('Exchange rate missing');
  await writeFile(new URL('fx.json', root), JSON.stringify({ sgdPerJpy, date: body.date }) + '\n');
  console.log(`Exchange rate: 100 yen = S$${(sgdPerJpy * 100).toFixed(2)} on ${body.date}`);
}

async function main() {
  const root = new URL('../data/', import.meta.url);
  await updateFx(root).catch(err => console.warn(err.message));
  const minYear = new Date().getFullYear() - 1;

  const themes = parseCsv(await fetchGz(THEMES_CSV));
  const sets = parseCsv(await fetchGz(SETS_CSV));
  const removed = JSON.parse(await readFile(new URL('removed.json', root), 'utf8'));
  const details = JSON.parse(await readFile(new URL('details.json', root), 'utf8')).sets;
  const catalogue = selectSets(themes, sets, minYear).filter(s => keepSet(s.num, removed, details));
  if (catalogue.length < 20) throw new Error(`Only ${catalogue.length} sets found, keeping the old catalogue`);
  await writeFile(new URL('sets.json', root), JSON.stringify(catalogue, null, 1) + '\n');
  const count = name => catalogue.filter(s => s.theme === name).length;
  console.log(`Catalogue: ${THEMES.map(t => `${count(t)} ${t}`).join(', ')} from ${minYear} onwards`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
