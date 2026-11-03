// Reads a copied Prices tab: tab-separated text with a header row.
import { SHOPS } from './util.js';

const number = text => {
  const value = Number(String(text ?? '').replace(/[,\s]|S\$/g, ''));
  return text && Number.isFinite(value) ? value : null;
};

export function parseSheet(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headIndex = lines.findIndex(l => l.split('\t').includes('Set number'));
  if (headIndex < 0) throw new Error('Copy the whole Prices tab, including the header row.');
  const head = lines[headIndex].split('\t').map(h => h.trim());

  return lines.slice(headIndex + 1).map(line => {
    const cells = line.split('\t').map(c => c.trim());
    const get = name => {
      const i = head.indexOf(name);
      return i < 0 ? '' : cells[i] ?? '';
    };
    const shops = {};
    for (const shop of SHOPS.filter(s => !s.custom)) {
      const n = shop.name;
      const entry = {
        price: number(get(`${n} price (${shop.yen ? 'JPY' : 'S$'})`)),
        final: number(get(shop.yen ? `${n} delivered cost (S$)` : `${n} after vouchers (S$)`)),
        url: get(`${n} link`),
        seller: get(`${n} seller`),
        official: get(`${n} official store`),
        stock: get(`${n} stock`),
        voucher: get(`${n} voucher details`),
        checked: get(`${n} checked`),
      };
      for (const k of Object.keys(entry)) if (entry[k] === null || entry[k] === '') delete entry[k];
      if (entry.price !== undefined || entry.final !== undefined || entry.stock) shops[shop.id] = entry;
    }
    const images = get('Extra image links').split(/\s+/).filter(u => /^https:\/\//i.test(u)).slice(0, 5);
    return { num: get('Set number'), age: get('Age'), msrp: number(get('MSRP (S$)')), images, shops };
  }).filter(r => r.num);
}

// Blank cells leave what's already saved in place.
export function mergeImport(rows, sets, overrides, ages, images, shopsFor, now = Date.now()) {
  const known = new Set(sets.map(s => s.num));
  const nextOverrides = {};
  const nextAges = { ...ages };
  const nextImages = { ...images };
  const summary = { prices: 0, msrps: 0, ages: 0, images: 0, unknown: 0 };

  for (const row of rows) {
    if (!known.has(row.num)) { summary.unknown++; continue; }
    const hasShops = Object.keys(row.shops).length > 0;
    if (row.age) { nextAges[row.num] = row.age; summary.ages++; }
    if (row.images.length) { nextImages[row.num] = row.images; summary.images++; }
    if (hasShops) summary.prices++;
    if (row.msrp !== null) summary.msrps++;
    if (!hasShops && row.msrp === null) continue;

    const old = overrides[row.num];
    const entry = { shops: { ...shopsFor(old), ...row.shops } };
    const msrp = row.msrp ?? old?.msrp;
    if (msrp !== undefined) entry.msrp = msrp;
    entry.updatedAt = hasShops ? now : old?.updatedAt ?? now;
    nextOverrides[row.num] = entry;
  }
  return { overrides: nextOverrides, ages: nextAges, images: nextImages, summary };
}
