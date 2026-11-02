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

export async function loadJson(path, fallback) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    return res.ok ? await res.json() : fallback;
  } catch {
    return fallback;
  }
}

// A manual price from the admin beats the daily one.
export function priceFor(num, prices, overrides) {
  const o = overrides[num];
  if (o) return { ...o, manual: true, trusted: true };
  return prices[num] ?? null;
}

export function priceHtml(p) {
  if (!p) return '<p class="price none">No Singapore price found yet</p>';
  const url = safeUrl(p.url);
  const seller = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(p.seller)}</a>` : esc(p.seller);
  const notes = [];
  if (!p.manual && !p.trusted) notes.push('Check this seller before buying');
  if (!p.manual && p.lastSeen) {
    notes.push(daysSince(p.lastSeen) > 30
      ? `Last seen ${shortDate(p.lastSeen)}, so it may have changed`
      : `Seen ${shortDate(p.lastSeen)}`);
  }
  return `<p class="price"><b>${money(p.amount)}</b> at ${seller}</p>${
    notes.length ? `<p class="price-note">${esc(notes.join('. '))}</p>` : ''}`;
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
