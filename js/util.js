export class TakenError extends Error {
  constructor(by) { super('taken'); this.by = by; }
}

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const slug = name => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function avatar(id, photos) {
  const src = photos?.[id] ?? '';
  return /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(src) ? `<img class="avatar" src="${src}" alt="">` : '';
}

export const safeUrl = url => (/^https:\/\//i.test(url ?? '') ? url : null);

export const money = amount => `S$${Number(amount).toFixed(2)}`;

export const shortDate = when => new Date(when).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });

export const daysSince = when => Math.floor((Date.now() - new Date(when).getTime()) / 86400000);

export function photo(set) {
  const src = safeUrl(set.img);
  return `<div class="photo" data-num="${esc(set.num)}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''}</div>`;
}

// Rebrickable photos can fail to load; show the set number instead.
document.addEventListener('error', e => {
  if (e.target.tagName === 'IMG') e.target.closest('.photo')?.classList.add('no-image');
}, true);

// A deploy can briefly make a file unavailable, so try a few times.
export async function loadJson(path, fallback) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (res.ok) return await res.json();
    } catch {
      // Try again below.
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  return fallback;
}

const query = num => encodeURIComponent(`LEGO ${num}`);

// LEGO.com Singapore details: [age, price, availability, pieces, page, photos].
let details = {};
export function setDetails(sets) { details = sets ?? {}; }

// Marketplace prices collected in the price-check sheet. Prices set on the admin page win, shop by shop.
let shopData = {};
let shopDataChecked = null;
export function setShopData(file) {
  shopData = file?.sets ?? {};
  shopDataChecked = file?.checked ?? null;
}
const ASSETS = 'https://www.lego.com/cdn/cs/set/assets/';

export const legoFor = num => {
  const d = details[num];
  if (!d) return null;
  const [age, price, stock, parts, slug, images] = d;
  return {
    age, price, stock, parts,
    url: `https://www.lego.com/en-sg/product/${slug}`,
    images: images.map(f => `${ASSETS}${f}?fit=bounds&quality=75&width=900`),
    available: stock === 'Available now' || stock.startsWith('Will be shipped'),
  };
};

export const ageFor = (num, ages) => ages?.[num] ?? legoFor(num)?.age ?? null;
export const msrpFor = (num, overrides) => overrides[num]?.msrp ?? legoFor(num)?.price ?? null;
// Photos added by hand come first, then LEGO's own, without repeating one.
export const imagesFor = (num, images) => {
  const seen = new Set();
  return [...(images?.[num] ?? []), ...(legoFor(num)?.images ?? [])].filter(url => {
    const path = url.split('?')[0];
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
};
export const partsFor = set => legoFor(set.num)?.parts ?? set.parts;

export const SHOPS = [
  { id: 'lazada', name: 'Lazada', search: num => `https://www.lazada.sg/catalog/?q=${query(num)}` },
  { id: 'shopee', name: 'Shopee', search: num => `https://shopee.sg/search?keyword=${query(num)}` },
  { id: 'amazonsg', name: 'Amazon SG', search: num => `https://www.amazon.sg/s?k=${query(num)}` },
  { id: 'other', name: 'Other shop', custom: true },
];

// Prices saved by the first admin version were a single amount, seller and url.
export function shopsFor(entry) {
  if (!entry) return {};
  if (entry.shops) return entry.shops;
  return entry.amount ? { other: { price: entry.amount, seller: entry.seller, url: entry.url } } : {};
}

export const shopsForSet = (num, overrides) => ({ ...shopData[num], ...shopsFor(overrides[num]) });

export const checkedFor = (num, overrides) => overrides[num]?.updatedAt ?? (shopData[num] ? shopDataChecked : null);

export function offersFor(num, overrides) {
  const shops = shopsForSet(num, overrides);
  const lego = legoFor(num);
  const fromLego = lego ? [{
    id: 'lego', name: 'LEGO.com', url: lego.url, listed: lego.price, amount: lego.price,
    stock: lego.stock, available: lego.available, counts: lego.available, afterVouchers: false,
  }] : [];
  return [...fromLego, ...SHOPS.filter(s => shops[s.id]).map(s => {
    const e = shops[s.id];
    const name = s.custom ? e.seller || s.name : s.name;
    const stock = e.stock ?? null;
    const available = !stock || stock === 'In stock';
    return {
      id: s.id, name, url: e.url, listed: e.price ?? null, stock, available, seller: e.seller, voucher: e.voucher,
      amount: e.final ?? e.price ?? null, counts: available && (e.final ?? e.price) != null, afterVouchers: e.final != null,
    };
  })].filter(o => o.amount != null || o.listed != null || o.stock);
}

export function priceFor(num, overrides) {
  const offers = offersFor(num, overrides);
  const counted = offers.filter(o => o.counts).sort((a, b) => a.amount - b.amount);
  const best = counted[0] ?? offers.filter(o => o.available && o.amount != null)[0];
  if (!best) return null;
  return {
    ...best,
    seller: best.name,
    others: offers.filter(o => o !== best && o.available && (o.amount != null || o.listed != null)),
    checked: checkedFor(num, overrides),
  };
}

const offerText = o => `${o.name} ${money(o.amount)}`;

function offerLink(o) {
  const url = safeUrl(o.url);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(offerText(o))}</a>` : esc(offerText(o));
}

export function priceHtml(p) {
  if (!p) return '<p class="price none">Price to be confirmed</p>';
  const url = safeUrl(p.url);
  const seller = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(p.seller)}</a>` : esc(p.seller);
  let note = '';
  if (p.afterVouchers) note = p.voucher ? `After vouchers (${p.voucher}), so yours may differ` : 'After vouchers, so yours may differ';
  return `<p class="price"><b>${money(p.amount)}</b> at ${seller}</p>${
    note ? `<p class="price-note">${esc(note)}</p>` : ''}${
    p.others.length ? `<p class="also">Also: ${p.others.map(offerLink).join(', ')}</p>` : ''}`;
}

// A search link for relatives when no Amazon SG price has been found yet.
export function amazonCheckHtml(num, overrides) {
  const offer = offersFor(num, overrides).find(o => o.id === 'amazonsg');
  if (offer?.amount != null) return '';
  const url = SHOPS.find(s => s.id === 'amazonsg').search(num);
  return `<p class="also"><a href="${esc(url)}" target="_blank" rel="noopener">Check Amazon SG</a></p>`;
}

export function msrpHtml(msrp, price) {
  if (msrp == null) return '';
  const off = offLabel(msrp, price?.amount);
  return `<p class="price-note">MSRP ${money(msrp)}${off ? `, ${off}` : ''}</p>`;
}

export function offLabel(msrp, amount) {
  if (msrp == null || amount == null || msrp === 0) return '';
  const pct = Math.round((1 - amount / msrp) * 100);
  if (pct > 0) return `${pct}% off`;
  return pct < 0 ? `${-pct}% above` : 'same as MSRP';
}

let toastTimer;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
