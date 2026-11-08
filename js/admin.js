import { addExtraCars, ageFor, avatar, codeFor, esc, parseTomicaNumber, regularPhotoGuesses, daysSince, legoFor, money, msrpFor, msrpHtml, newKey, newTag, offersFor, partsFor, offLabel, photo, priceFor, priceHtml, safeUrl, shopsFor, shopsForSet, checkedFor, shortDate, SHOPS, toast } from './util.js';
import { mergeImport, parseSheet } from './import.js';

const STALE_DAYS = 7;
const STAGES = [['reserved', 'Reserved'], ['bought', 'Bought'], ['received', 'Received'], ['wrapped', 'Wrapped']];
const STALE_PRICE_DAYS = 14;

export async function render({ root, store, sets, demo }) {
  const byNum = Object.fromEntries(sets.map(s => [s.num, s]));
  const joinCars = cars => {
    addExtraCars(sets, cars);
    for (const s of sets) byNum[s.num] ??= s;
  };
  let carMessage = '';
  let keys, kids, picks = {}, wishlist = {}, claims = {}, shares = {}, overrides = {};
  let pendingImport = null;
  let familySpace = {};
  let alertTopic = null;
  let editing = null;
  const filters = { q: '', theme: 'all', show: 'picked', sort: 'year', dir: -1 };
  const COLUMNS = [
    ['photo', ''], ['num', 'Set'], ['name', 'Name'], ['ageNum', 'Age'], ['parts', 'Pieces'], ['msrp', 'MSRP'],
    ['lazada', 'Lazada'], ['shopee', 'Shopee'], ['amazonsg', 'Amazon SG'],
    ['amount', 'Best'], ['off', 'Off MSRP'], ['each', 'Per piece'], ['checked', 'Checked'], ['visible', 'Boys see it'],
  ];

  const link = param => {
    const url = new URL(location.pathname, location.origin);
    if (demo) url.searchParams.set('demo', '');
    url.searchParams.set(param, param === 'kids' ? keys.kidKey : keys.famKey);
    return url.href;
  };
  const shell = html => { root.innerHTML = `<main class="admin">${html}</main>`; };

  function signInScreen(note = '') {
    shell(`<h1>Run the list</h1>${note ? `<p class="alert">${esc(note)}</p>` : ''}
      <button class="claim" data-signin>Sign in with Google</button>`);
  }

  function setupScreen() {
    shell(`<h1>Set up your list</h1><p>Enter the names to show on the list.</p>
      <form class="setup">
        <label>First child <input name="a" required maxlength="30"></label>
        <label>Second child <input name="b" required maxlength="30"></label>
        <button class="claim">Create the list</button>
      </form>`);
    root.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      await store.createSpaces([f.get('a').trim(), f.get('b').trim()]);
      begin();
    };
  }

  // Combines both boys' picks into { num: { childId: { fav } } }.
  function pickedSets() {
    const out = {};
    for (const c of kids.children) {
      for (const [num, p] of Object.entries(picks[c.id]?.sets ?? {})) {
        if (byNum[num]) (out[num] ??= {})[c.id] = { fav: Boolean(p.fav) };
      }
    }
    return out;
  }

  const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  const sorted = o => Object.keys(o ?? {}).sort().map(k => [k, o[k]]);
  const nameOf = id => kids.children.find(c => c.id === id)?.name ?? id;
  const hasClaim = (num, child) => Boolean(claims[`${num}_${child}`]);

  function changes() {
    const want = pickedSets();
    const excluded = keys.excluded ?? [];
    const entries = [];
    const remove = [];

    for (const [num, who] of Object.entries(want)) {
      if (excluded.includes(num)) continue;
      const merged = { ...who };
      // A gift someone has claimed stays on the list even if a pick was removed.
      for (const [c, w] of Object.entries(wishlist[num]?.for ?? {})) {
        if (!merged[c] && hasClaim(num, c)) merged[c] = w;
      }
      if (!same(merged, wishlist[num]?.for)) entries.push({ num, for: merged });
    }
    for (const [num, w] of Object.entries(wishlist)) {
      if (want[num] && !excluded.includes(num)) continue;
      const claimed = Object.fromEntries(Object.entries(w.for).filter(([c]) => hasClaim(num, c)));
      if (!Object.keys(claimed).length) remove.push(num);
      else if (!same(claimed, w.for)) entries.push({ num, for: claimed });
    }
    return { entries, remove };
  }

  function overrideForm(num) {
    const shops = shopsForSet(num, overrides);
    const field = (name, label, value, attrs) => `<label>${label} <input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
    const money2 = 'type="number" step="0.01" min="0"';
    return `<form class="override" data-num="${esc(num)}">
      <div class="shop-row">
        <div class="shop-name"><b>Set details</b><a href="https://www.lego.com/en-sg/search?q=${esc(num)}" target="_blank" rel="noopener">LEGO.com</a></div>
        ${field('age', 'Age', ageFor(num, kids.ages), 'maxlength="6" placeholder="6+"')}
        ${field('msrp', 'MSRP (S$)', msrpFor(num, overrides), money2)}
      </div>
      ${SHOPS.map(s => {
        const e = shops[s.id] ?? {};
        return `<div class="shop-row">
          <div class="shop-name"><b>${esc(s.name)}</b>${s.search ? `<a href="${esc(s.search(num))}" target="_blank" rel="noopener">Search</a>` : ''}</div>
          ${s.custom ? field('other_seller', 'Shop name', e.seller, 'maxlength="40"') : ''}
          ${field(`${s.id}_price`, 'Price (S$)', e.price, money2)}
          ${s.custom ? '' : field(`${s.id}_final`, 'After vouchers (S$)', e.final, money2)}
          ${field(`${s.id}_url`, 'Link to buy', e.url, 'type="url" placeholder="https://"')}
          <label>Stock <select name="${s.id}_stock">
            ${['', 'In stock', 'Out of stock', 'Not listed'].map(v => `<option value="${v}" ${v === (e.stock ?? '') ? 'selected' : ''}>${v || 'Not checked'}</option>`).join('')}
          </select></label>
        </div>`;
      }).join('')}
      <div class="sheet-actions">
        <button type="button" class="quiet" data-edit-cancel>Cancel</button>
        <button class="claim">Save prices</button>
      </div>
    </form>`;
  }

  function dbRows() {
    const hidden = kids.hidden ?? [];
    const wanted = pickedSets();
    const ages = kids.ages ?? {};
    const q = filters.q.trim().toLowerCase();
    const rows = sets.map(s => {
      const price = priceFor(s.num, overrides);
      const offers = offersFor(s.num, overrides);
      const shopPrices = Object.fromEntries(SHOPS.map(shop => [shop.id, offers.find(o => o.id === shop.id)?.amount ?? null]));
      return {
        ...s,
        ...shopPrices,
        price,
        offers,
        amount: price?.amount ?? null,
        each: price && s.parts ? price.amount / s.parts : null,
        seller: price?.seller ?? null,
        checked: checkedFor(s.num, overrides),
        msrp: msrpFor(s.num, overrides),
        off: msrpFor(s.num, overrides) && price ? 1 - price.amount / msrpFor(s.num, overrides) : null,
        age: ageFor(s.num, ages),
        ageNum: parseInt(ageFor(s.num, ages), 10) || null,
        parts: partsFor(s),
        lego: legoFor(s.num),
        visible: !hidden.includes(s.num),
        picked: Boolean(wanted[s.num]),
      };
    }).filter(r => (
      (filters.theme === 'all' || r.theme === filters.theme)
      && (!q || r.name.toLowerCase().includes(q) || r.num.includes(q) || (r.seller ?? '').toLowerCase().includes(q) || (r.age ?? '').includes(q))
      && (filters.show === 'all'
        || (filters.show === 'noprice' && !r.price)
        || (filters.show === 'picked' && r.picked)
        || (filters.show === 'nolego' && !r.lego)
        || (filters.show === 'legoout' && r.lego && !r.lego.available)
        || (filters.show === 'old' && r.checked && daysSince(r.checked) > STALE_PRICE_DAYS)
        || (filters.show === 'hidden' && !r.visible)
        || (filters.show === 'visible' && r.visible))
    ));
    const { sort, dir } = filters;
    return rows.sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (x === y) return a.num.localeCompare(b.num);
      if (x === null) return 1;
      if (y === null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  }

  function shopCell(id, r) {
    const shop = SHOPS.find(x => x.id === id);
    const o = r.offers.find(x => x.id === id);
    const search = `<a class="find" href="${esc(shop.search(r.num))}" target="_blank" rel="noopener">Search</a>`;
    if (!o) return search;
    const url = safeUrl(o.url);
    let text = '';
    if (o.listed != null || o.amount != null) text = money(o.listed ?? o.amount);
    const main = url && text ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
    let note = '';
    if (o.afterVouchers) note = `${money(o.amount)} after vouchers`;
    const stock = o.available ? '' : `<span class="stale block">${esc(o.stock === 'Out of stock' ? 'Sold out' : o.stock)}</span>`;
    const seller = o.seller && !shop.custom ? `<span class="muted block">${esc(o.seller)}</span>` : '';
    return `<span class="${r.price?.id === id ? 'cheapest' : ''}">${main}</span>${note ? `<span class="muted block">${esc(note)}</span>` : ''}${seller}${stock}${search}`;
  }

  function dbCell(key, r) {
    switch (key) {
      case 'photo': return photo(r);
      case 'num': return `<b>${esc(codeFor(r))}</b>`;
      case 'name': return `${esc(r.name)} ${newTag(r)}<span class="muted block">${esc([r.theme, r.series].filter(Boolean).join(' '))}${r.jpy ? `, ¥${r.jpy.toLocaleString('en-SG')} in Japan` : ''}</span>`;
      case 'ageNum': return r.age ? esc(r.age) : '<span class="muted">Not set</span>';
      case 'parts': return esc(r.parts);
      case 'msrp': {
        if (r.msrp === null) return '<span class="muted">Not on LEGO.com SG</span>';
        const url = safeUrl(r.lego?.url);
        const label = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${money(r.msrp)}</a>` : money(r.msrp);
        const flag = r.lego && r.lego.stock !== 'Available now' ? `<span class="${r.lego.available ? 'muted' : 'stale'} block">${esc(r.lego.stock)}</span>` : '';
        return `<span class="${r.price?.id === 'lego' ? 'cheapest' : ''}">${label}</span>${flag}`;
      }
      case 'off': return esc(offLabel(r.msrp, r.amount));
      case 'lazada': case 'shopee': case 'amazonsg': return shopCell(key, r);
      case 'amount': {
        if (!r.price) return '<span class="muted">No price</span>';
        const url = safeUrl(r.price.url);
        const text = money(r.amount);
        return `<b>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>` : text}</b><span class="muted block">${esc(r.seller)}</span>`;
      }
      case 'each': return r.each === null ? '' : money(r.each);
      case 'checked':
        if (!r.checked) return '';
        return `<span class="${daysSince(r.checked) > STALE_PRICE_DAYS ? 'stale' : ''}">${esc(shortDate(r.checked))}</span>`;
      case 'visible':
        return `<label class="check"><input type="checkbox" data-visible="${esc(r.num)}" ${r.visible ? 'checked' : ''} aria-label="Show ${esc(r.name)} to the boys"> Show</label>`;
      default: return '';
    }
  }

  function dbTable() {
    const rows = dbRows();
    const arrow = key => (filters.sort === key ? (filters.dir > 0 ? ' \u2191' : ' \u2193') : '');
    return `
      <p class="db-count">${rows.length} of ${sets.length} sets</p>
      ${rows.length ? `<table class="db">
        <thead><tr>
          ${COLUMNS.map(([k, label]) => (label
            ? `<th scope="col"><button data-sort="${k}">${label}${arrow(k)}</button></th>`
            : '<th scope="col"></th>')).join('')}
          <th scope="col"></th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            ${COLUMNS.map(([k, label]) => `<td class="c-${k}" data-label="${label}">${dbCell(k, r)}</td>`).join('')}
            <td class="c-edit"><button class="quiet" data-edit="db:${esc(r.num)}">Edit prices</button></td>
          </tr>
          ${editing === `db:${r.num}` ? `<tr class="db-edit"><td colspan="${COLUMNS.length + 1}">${overrideForm(r.num)}</td></tr>` : ''}`).join('')}
        </tbody>
      </table>` : `<p class="empty">${filters.show === 'picked' && !filters.q ? 'No picks yet. Send the boys their link to get started.' : 'No sets match. Try another search or filter.'}</p>`}`;
  }

  function importResult() {
    if (!pendingImport) return '';
    if (pendingImport.error) return `<p class="alert">${esc(pendingImport.error)}</p>`;
    const { prices, msrps, ages, images, unknown } = pendingImport.result.summary;
    return `<p>Ready to import: ${prices} sets with shop prices, ${msrps} with an MSRP, ${ages} with an age and ${images} with extra photos.${unknown ? ` ${unknown} rows skipped because the set isn't in the catalogue.` : ''}</p>
      <button class="claim" data-import-go>Import now</button>`;
  }

  // What each boy is getting, using today's best price for each gift.
  function balanceFor(child) {
    const mine = Object.values(claims).filter(c => c.child === child.id);
    const gifts = mine.map(c => ({ c, amount: priceFor(c.num, overrides)?.amount ?? null }));
    const sum = list => list.reduce((n, g) => n + (g.amount ?? 0), 0);
    const reserved = gifts.filter(g => g.c.status === 'reserved');
    const bought = gifts.filter(g => g.c.status !== 'reserved');
    const claimed = new Set(mine.map(c => c.num));
    const groups = new Set(Object.values(shares).filter(x => x.child === child.id && !claimed.has(x.num)).map(x => x.num));
    const pledged = Object.values(shares).filter(x => x.child === child.id && !claimed.has(x.num)).reduce((n, x) => n + (x.amount ?? 0), 0);
    return {
      child, count: gifts.length, total: sum(gifts), reserved: sum(reserved), bought: sum(bought),
      unpriced: gifts.filter(g => g.amount === null).length, groups: groups.size, pledged,
    };
  }

  function unclaimedFavourites() {
    const excluded = keys.excluded ?? [];
    return Object.entries(pickedSets()).flatMap(([num, who]) => Object.entries(who)
      .filter(([child, w]) => w.fav && !claims[`${num}_${child}`] && !excluded.includes(num)
        && !Object.values(shares).some(x => x.num === num && x.child === child))
      .map(([child]) => ({ num, child, price: priceFor(num, overrides) })));
  }

  function balanceSection() {
    const rows = kids.children.map(balanceFor);
    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const gap = rows.length > 1 ? sorted[0].total - sorted[sorted.length - 1].total : 0;
    const favourites = unclaimedFavourites();
    return `
      <section>
        <h2>Spend balance</h2>
        <div class="balance">
          ${rows.map(r => `<div>
            ${avatar(r.child.id, kids.photos)}<b>${esc(r.child.name)}</b>
            <p class="balance-total">${money(r.total)}</p>
            <p class="set-meta">${r.count} gift${r.count === 1 ? '' : 's'}: ${money(r.bought)} bought, ${money(r.reserved)} reserved</p>
            ${r.groups ? `<p class="set-meta">${r.groups} open group buy${r.groups === 1 ? '' : 's'}${r.pledged ? `, ${money(r.pledged)} pledged` : ''}</p>` : ''}
            ${r.unpriced ? `<p class="set-meta stale">${r.unpriced} gift${r.unpriced === 1 ? ' has' : 's have'} no price yet</p>` : ''}
          </div>`).join('')}
        </div>
        ${gap > 0 ? `<p class="balance-gap">${esc(sorted[sorted.length - 1].child.name)} is ${money(gap)} behind ${esc(sorted[0].child.name)}.</p>` : ''}
      </section>

      <section>
        <h2>Favourites nobody has taken</h2>
        ${favourites.length ? `<ul class="rows">${favourites.map(f => {
          const url = safeUrl(f.price?.url);
          const label = f.price ? `${money(f.price.amount)} at ${esc(f.price.seller)}` : 'Price to be confirmed';
          return `<li class="claim-row">
            <div><b>${esc(byNum[f.num].name)}</b> for ${esc(nameOf(f.child))}
              <p class="set-meta">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : label}</p></div>
          </li>`;
        }).join('')}</ul>` : '<p class="empty">Every starred set has been taken, or none have been starred yet.</p>'}
      </section>`;
  }

  function dbSection() {
    const themes = [...new Set(sets.map(s => s.theme).filter(Boolean))];
    const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
    return `
      <section>
        <h2>Sets</h2>
        <div class="db-views">
          <button class="tab" data-view="picked" aria-pressed="${filters.show === 'picked'}">Picked by the boys (${Object.keys(pickedSets()).length})</button>
          <button class="tab" data-view="all" aria-pressed="${filters.show === 'all'}">All sets (${sets.length})</button>
        </div>
        <p>Use Search to find a set at each shop, then add the price with Edit prices. Choose which sets the boys can see here too. New sets are shown unless you hide them.</p>
        <p class="muted">MSRP, age, photos and stock were read from LEGO.com Singapore on 3 Nov 2026. LEGO.com counts as a shop for the best price when a set can be bought there.</p>
        <div class="db-tools">
          <label>Search <input class="db-search" type="search" value="${esc(filters.q)}" placeholder="Name, number or retailer"></label>
          <label>Theme <select data-filter="theme">
            ${option('all', 'All themes', filters.theme)}${themes.map(t => option(t, t, filters.theme)).join('')}
          </select></label>
          <label>Show <select data-filter="show">
            ${[['all', 'All sets'], ['picked', 'Picked by the boys'], ['visible', 'Shown to the boys'], ['hidden', 'Hidden from the boys'], ['nolego', 'Not on LEGO.com SG'], ['legoout', 'Not buyable on LEGO.com SG'], ['noprice', 'No price'], ['old', `Not checked for ${STALE_PRICE_DAYS} days`]]
              .map(([v, l]) => option(v, l, filters.show)).join('')}
          </select></label>
          <label class="db-sort">Sort <select data-filter="sort">
            ${[['year', 'Newest'], ['amount', 'Best price'], ['ageNum', 'Age'], ['off', 'Off MSRP'], ['each', 'Price per piece'], ['parts', 'Pieces'], ['name', 'Name'], ['num', 'Set number']]
              .map(([v, l]) => option(v, l, filters.sort)).join('')}
          </select></label>
        </div>
        <div class="db-bulk">
          <button class="quiet" data-bulk="show">Show these to the boys</button>
          <button class="quiet" data-bulk="hide">Hide these from the boys</button>
        </div>
        <div id="db-table">${dbTable()}</div>
        <details class="import" ${pendingImport ? 'open' : ''}>
          <summary>Import from Google Sheet</summary>
          <p>In the sheet, open the Prices tab, click the empty box above row 1 to select everything, and copy. Paste it below. Blank cells keep what's already saved here.</p>
          <textarea rows="4" aria-label="Pasted sheet">${esc(pendingImport?.text ?? '')}</textarea>
          <div class="sheet-actions"><button class="quiet" data-import-check>Check import</button></div>
          <div class="import-result">${importResult()}</div>
        </details>
      </section>`;
  }

  const redrawDb = () => { root.querySelector('#db-table').innerHTML = dbTable(); };

  function draw() {
    if (root.querySelector('.override input:focus, .override select:focus, .own-form input:focus, .db-search:focus, .import textarea:focus, .note-box:focus')) return;
    const want = pickedSets();
    const excluded = keys.excluded ?? [];
    const nums = [...new Set([...Object.keys(want), ...Object.keys(wishlist)])]
      .sort((a, b) => Object.keys(want[b] ?? {}).length - Object.keys(want[a] ?? {}).length || a.localeCompare(b));
    const { entries, remove } = changes();
    const pending = entries.length + remove.length;
    const claimList = Object.entries(claims).sort((a, b) => a[1].at - b[1].at);
    const owned = kids.owned ?? [];

    shell(`
      <h1>Run the list</h1>

      <section>
        <h2>Share</h2>
        <div class="share">
          <div><b>For ${esc(kids.children.map(c => c.name).join(' and '))}</b><p>They choose sets here and can't see what's been bought.</p>
            <div class="share-actions"><a class="open" href="${esc(link('kids'))}" target="_blank" rel="noopener">Open kids' page</a>
              <button class="quiet" data-copy="${esc(link('kids'))}">Copy kids' link</button></div></div>
          <div><b>For the family</b><p>Relatives reserve gifts here, with no sign-in. Don't send this one to the boys.</p>
            <div class="share-actions"><a class="open" href="${esc(link('family'))}" target="_blank" rel="noopener">Open family page</a>
              <button class="quiet" data-copy="${esc(link('family'))}">Copy family link</button></div></div>
        </div>
      </section>

      ${alertsSection()}

      <section>
        <h2>Photos of the boys</h2>
        <p>These show on the boys' page, this page and the family page. Anyone with those links can see them. Use a JPG or PNG with the face near the top or middle.</p>
        <div class="photo-pickers">
          ${kids.children.map(c => `<div>
            ${avatar(c.id, kids.photos) || '<span class="avatar empty-avatar"></span>'}
            <label class="quiet-label">${esc(c.name)} <input type="file" accept="image/jpeg,image/png,image/webp" data-photo="${esc(c.id)}"></label>
            ${kids.photos?.[c.id] ? `<button class="quiet" data-photo-remove="${esc(c.id)}">Remove photo</button>` : ''}
          </div>`).join('')}
        </div>
      </section>

      ${balanceSection()}

      <section>
        <h2>Picks</h2>
        <ul class="pick-status">
          ${kids.children.map(c => {
            const n = Object.keys(picks[c.id]?.sets ?? {}).filter(num => byNum[num]).length;
            const done = Boolean(picks[c.id]?.finished);
            return `<li>${avatar(c.id, kids.photos)}<b>${esc(c.name)}:</b> ${n} pick${n === 1 ? '' : 's'}, ${done ? 'finished' : 'still choosing'}
              ${done ? `<button class="quiet" data-reopen="${esc(c.id)}">Let ${esc(c.name)} change the list</button>` : ''}</li>`;
          }).join('')}
        </ul>
        <div class="publish">
          <p>${pending ? `${pending} change${pending > 1 ? 's' : ''} to send to the family list.` : 'The family list is up to date.'}</p>
          <button class="claim" data-publish ${pending ? '' : 'disabled'}>Update family list</button>
        </div>
        ${nums.length ? `<ul class="rows">${nums.map(num => {
          const set = byNum[num] ?? { num, name: `Set ${num}` };
          const price = priceFor(num, overrides);
          const who = want[num] ?? wishlist[num]?.for ?? {};
          return `<li class="row">
            ${photo(set)}
            <div class="row-body">
              <h3>${esc(set.name)}</h3>
              <p class="set-meta">Set ${esc(num)}</p>
              ${byNum[num] ? '' : '<p class="stale">No longer on the list. Click Update family list to take it off.</p>'}
              <p class="who">${Object.entries(who).map(([c, w]) => esc(nameOf(c)) + (w.fav ? ' (favourite)' : '')).join(', ')}</p>
              ${priceHtml(price)}
              ${msrpHtml(msrpFor(num, overrides), price)}
              <div class="row-actions">
                <label class="check"><input type="checkbox" data-exclude="${esc(num)}" ${excluded.includes(num) ? 'checked' : ''}> Leave off the family list</label>
                <button class="quiet" data-edit="pick:${esc(num)}">Edit prices</button>
              </div>
              ${editing === `pick:${num}` ? overrideForm(num) : ''}
            </div>
          </li>`;
        }).join('')}</ul>` : '<p class="empty">No picks yet. Send the boys their link to get started.</p>'}
      </section>

      ${dbSection()}

      <section>
        <h2>Group buys</h2>
        ${Object.keys(shares).length ? `<ul class="rows">${Object.entries(shares).sort((a, b) => a[1].at - b[1].at).map(([id, x]) => `
          <li class="claim-row">
            <div><b>${esc(byNum[x.num]?.name ?? `Set ${x.num}`)}</b> for ${esc(nameOf(x.child))}
              <p class="set-meta">${esc(x.by)}${x.amount ? `, ${money(x.amount)}` : ''}</p></div>
            <button class="quiet" data-unshare="${esc(id)}">Remove</button>
          </li>`).join('')}</ul>` : '<p class="empty">No group buys yet.</p>'}
      </section>

      <section>
        <h2>Gift tracker</h2>
        ${claimList.length ? `<p class="tracker-count">${STAGES.map(([v, l]) => `${l}: ${claimList.filter(([, c]) => c.status === v).length}`).join(', ')}</p>
        <ul class="rows">${claimList.map(([id, c]) => {
          const old = c.status === 'reserved' && daysSince(c.at) >= STALE_DAYS;
          const price = priceFor(c.num, overrides);
          return `<li class="claim-row">
            <div><b>${esc(byNum[c.num]?.name ?? `Set ${c.num}`)}</b> for ${esc(nameOf(c.child))}
              <p class="set-meta">From ${esc(c.by)}${price ? `, ${money(price.amount)}` : ''}${old ? `, <span class="stale">not bought after ${daysSince(c.at)} days</span>` : ''}</p></div>
            <div class="tracker-actions">
              <label class="sr-label">Status <select data-status="${esc(id)}">
                ${STAGES.map(([v, l]) => `<option value="${v}" ${v === c.status ? 'selected' : ''}>${l}</option>`).join('')}
              </select></label>
              <button class="quiet" data-release="${esc(id)}">Release</button>
            </div>
          </li>`;
        }).join('')}</ul>` : '<p class="empty">Nothing reserved yet.</p>'}
      </section>

      <section>
        <h2>Note for the family</h2>
        <p>This shows at the top of the family page, such as who to give gifts to and by when.</p>
        <textarea class="note-box" rows="3" maxlength="400" aria-label="Note for the family">${esc(familySpace.note ?? '')}</textarea>
        <div class="sheet-actions"><button class="claim" data-save-note>Save note</button></div>
      </section>

      ${carSection()}

      <section>
        <h2>Sets they already have</h2>
        <p>These are hidden from the boys' list.</p>
        <form class="own-form"><label>Set number <input name="num" inputmode="numeric" pattern="[0-9]{4,6}" required></label>
          <button class="quiet">Hide this set</button></form>
        ${owned.length ? `<ul class="owned">${owned.map(n => `<li>${esc(byNum[n]?.name ?? 'Set')} ${esc(n)}
          <button class="quiet" data-unown="${esc(n)}">Show again</button></li>`).join('')}</ul>` : ''}
      </section>`);

    root.querySelector('.own-form').onsubmit = async e => {
      e.preventDefault();
      const num = new FormData(e.target).get('num').trim();
      e.target.reset();
      document.activeElement?.blur();
      if (!owned.includes(num)) await store.setOwned(keys.kidKey, [...owned, num]);
    };
  }

  async function shrinkPhoto(file) {
    const image = await createImageBitmap(file);
    const side = Math.min(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    // Tall photos are cropped from nearer the top, where a face usually is.
    canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) * 0.25, side, side, 0, 0, 200, 200);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  async function savePhotos(photos) {
    kids.photos = photos;
    await store.setPhotos(keys, photos);
    draw();
  }

  root.onsubmit = async e => {
    if (e.target.matches('.car-form')) {
      e.preventDefault();
      try {
        await addCar(e.target);
      } catch (err) {
        console.error(err);
        toast('That didn\'t save. Check your connection and try again.');
      }
      return;
    }
    if (!e.target.matches('.override')) return;
    e.preventDefault();
    const f = new FormData(e.target);
    const number = name => {
      const value = f.get(name);
      return value === null || value === '' ? null : Number(value);
    };
    const num = e.target.dataset.num;
    const saved = shopsForSet(num, overrides);
    const shops = {};
    for (const shop of SHOPS) {
      const entry = { ...saved[shop.id], price: number(`${shop.id}_price`), final: number(`${shop.id}_final`) };
      const url = safeUrl(f.get(`${shop.id}_url`));
      const stock = f.get(`${shop.id}_stock`);
      delete entry.url;
      delete entry.stock;
      if (url) entry.url = url;
      if (stock) entry.stock = stock;
      if (shop.custom) entry.seller = f.get('other_seller').trim() || shop.name;
      if (entry.price === null) delete entry.price;
      if (entry.final === null) delete entry.final;
      if (entry.price !== undefined || entry.final !== undefined || entry.stock) shops[shop.id] = entry;
    }
    const typedMsrp = number('msrp');
    const msrp = typedMsrp === legoFor(num)?.price ? null : typedMsrp;
    const age = f.get('age').trim();
    const ages = { ...kids.ages };
    if (age && age !== legoFor(num)?.age) ages[num] = age; else delete ages[num];
    const next = Object.keys(shops).length || msrp !== null ? { shops, updatedAt: Date.now() } : null;
    if (next && msrp !== null) next.msrp = msrp;
    editing = null;
    document.activeElement?.blur();
    await store.setOverride(keys.famKey, num, next);
    if ((kids.ages ?? {})[num] !== ages[num]) {
      kids.ages = ages;
      await store.setAges(keys, ages);
    }
    draw();
    toast('Prices saved.');
  };

  root.oninput = e => {
    if (e.target.matches('.db-search')) {
      filters.q = e.target.value;
      redrawDb();
    }
  };

  async function saveHidden(list) {
    kids.hidden = [...list];
    redrawDb();
    await store.setHidden(keys.kidKey, kids.hidden);
  }

  root.onchange = async e => {
    const { filter, visible, status, photo: photoFor } = e.target.dataset ?? {};
    if (photoFor) {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await savePhotos({ ...kids.photos, [photoFor]: await shrinkPhoto(file) });
        toast('Photo saved.');
      } catch (err) {
        console.error(err);
        toast('That photo didn\'t work. Choose a JPG or PNG.');
      }
      return;
    }
    if (status) {
      try {
        await store.setClaimStatus(keys.famKey, status, e.target.value);
      } catch (err) {
        console.error(err);
        toast('That didn\'t save. Check the security rules are up to date.');
        draw();
      }
      return;
    }
    if (filter) {
      filters[filter] = e.target.value;
      if (filter === 'sort') filters.dir = ['year', 'off'].includes(e.target.value) ? -1 : 1;
      redrawDb();
      return;
    }
    if (visible) {
      const list = new Set(kids.hidden ?? []);
      if (e.target.checked) list.delete(visible); else list.add(visible);
      await saveHidden(list);
      return;
    }
    const num = e.target.dataset?.exclude;
    if (!num) return;
    const list = new Set(keys.excluded ?? []);
    if (e.target.checked) list.add(num); else list.delete(num);
    keys.excluded = [...list];
    await store.setExcluded(keys.excluded);
    draw();
  };

  root.onclick = async e => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    try {
      if (d.carRemove) {
        const cars = (kids.extraCars ?? []).filter(c => c.num !== d.carRemove);
        await store.setExtraCars(keys, cars);
        kids.extraCars = cars;
        const i = sets.findIndex(x => x.num === d.carRemove && x.added);
        if (i >= 0) sets.splice(i, 1);
        delete byNum[d.carRemove];
        carMessage = '';
        draw();
      } else if ('alertsOn' in d) {
        alertTopic = `lego-${newKey()}`;
        await store.setAlerts(alertTopic);
        draw();
      } else if ('alertsOff' in d) {
        alertTopic = null;
        await store.setAlerts(null);
        draw();
        toast('Phone alerts are off.');
      } else if ('alertsTest' in d) {
        const res = await fetch('https://ntfy.sh/', {
          method: 'POST',
          body: JSON.stringify({ topic: alertTopic, title: 'LEGO list', message: 'Phone alerts are working.', tags: ['gift'] }),
        });
        toast(res.ok ? 'Test sent. Check your phone.' : 'The test didn\'t send. Try again.');
      } else if ('signin' in d) {
        await store.signInAdmin();
        begin();
      } else if (d.copy) {
        await navigator.clipboard.writeText(d.copy);
        toast('Copied.');
      } else if (d.photoRemove) {
        const { [d.photoRemove]: removed, ...rest } = kids.photos ?? {};
        await savePhotos(rest);
        toast('Photo removed.');
      } else if ('saveNote' in d) {
        const note = root.querySelector('.note-box').value.trim();
        familySpace.note = note;
        await store.setFamilyNote(keys.famKey, note);
        toast('Note saved.');
      } else if (d.view) {
        filters.show = d.view;
        draw();
      } else if (d.reopen) {
        await store.setPicks(keys.kidKey, d.reopen, picks[d.reopen]?.sets ?? {}, false);
        toast('The list can be changed again.');
      } else if (d.sort) {
        filters.dir = filters.sort === d.sort ? -filters.dir : 1;
        filters.sort = d.sort;
        redrawDb();
      } else if (d.bulk) {
        const list = new Set(kids.hidden ?? []);
        const rows = dbRows();
        for (const r of rows) {
          if (d.bulk === 'hide') list.add(r.num); else list.delete(r.num);
        }
        await saveHidden(list);
        toast(`${rows.length} set${rows.length === 1 ? '' : 's'} ${d.bulk === 'hide' ? 'hidden from' : 'shown to'} the boys.`);
      } else if ('importCheck' in d) {
        const text = root.querySelector('.import textarea').value;
        try {
          const result = mergeImport(parseSheet(text), sets, overrides, kids.ages ?? {}, kids.images ?? {}, shopsFor);
          pendingImport = { text, result };
        } catch (err) {
          pendingImport = { text, error: err.message };
        }
        root.querySelector('.import-result').innerHTML = importResult();
      } else if ('importGo' in d) {
        const { overrides: next, ages, images } = pendingImport.result;
        await store.importDetails(keys, next, ages, images);
        kids.ages = ages;
        kids.images = images;
        pendingImport = null;
        draw();
        toast('Import finished.');
      } else if (d.unshare) {
        await store.leaveShare(keys.famKey, d.unshare);
        toast('Removed from the group buy.');
      } else if ('publish' in d) {
        const { entries, remove } = changes();
        await store.publishWishlist(keys.famKey, entries, remove);
        toast('Family list updated.');
      } else if (d.edit) {
        editing = d.edit;
        draw();
      } else if ('editCancel' in d) {
        editing = null;
        document.activeElement?.blur();
        draw();
      } else if (d.release) {
        await store.release(keys.famKey, d.release);
        toast('Released. It\'s available again.');
      } else if (d.unown) {
        await store.setOwned(keys.kidKey, (kids.owned ?? []).filter(n => n !== d.unown));
      }
    } catch (err) {
      console.error(err);
      if (err.code?.startsWith('auth/')) signInScreen(`Sign-in failed: ${err.code}`);
      else toast('That didn\'t work. Try again.');
    }
  };

  function alertsSection() {
    if (!alertTopic) {
      return `<section>
        <h2>Phone alerts</h2>
        <p>Get a notification when relatives reserve, cancel or buy a gift, join or leave a group buy, or when a group buy reaches the price. You'll also hear when a boy finishes choosing.</p>
        <button class="claim" data-alerts-on>Set up phone alerts</button>
      </section>`;
    }
    return `<section>
      <h2>Phone alerts</h2>
      <ol class="alert-steps">
        <li>Install the ntfy app on your phone.</li>
        <li>Tap + and subscribe to this topic. Keep it private: anyone who has it can read your alerts.
          <code class="alert-topic">${esc(alertTopic)}</code></li>
      </ol>
      <div class="share-actions">
        <button class="quiet" data-copy="${esc(alertTopic)}">Copy topic</button>
        <button class="quiet" data-alerts-test>Send a test</button>
        <button class="quiet" data-alerts-off>Turn off</button>
      </div>
    </section>`;
  }

  function carSection() {
    const added = kids.extraCars ?? [];
    return `<section>
      <h2>Add a Tomica car</h2>
      <p>Type the number from the box or the shop listing: 23 for a regular car, P41 for Premium, or U11 for Premium Unlimited. The boys see it straight away. Regular cars get Takara Tomy's photo; for Premium, paste a photo link.</p>
      <form class="car-form">
        <label>Tomica number <input name="code" required placeholder="23, P41 or U11" autocomplete="off"></label>
        <label>Name in English <input name="name" required maxlength="80" autocomplete="off"></label>
        <label>Photo link <input name="img" type="url" placeholder="Optional for regular cars"></label>
        <fieldset class="car-price"><legend>Price, if you have one</legend>
          <label>Shop <select name="shop">${SHOPS.filter(s => !s.custom).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
          <label>Price (S$) <input name="price" type="number" step="0.01" min="0" inputmode="decimal"></label>
          <label>Link <input name="url" type="url"></label>
        </fieldset>
        <button class="claim">Add car</button>
        <p class="car-msg" role="status">${esc(carMessage)}</p>
      </form>
      ${added.length ? `<ul class="owned">${added.map(c => `<li>${esc(c.code)} ${esc(c.name)}
        <button class="quiet" data-car-remove="${esc(c.num)}">Remove</button></li>`).join('')}</ul>` : ''}
    </section>`;
  }

  // The first photo address that loads wins.
  async function findPhoto(urls) {
    for (const url of urls) {
      const ok = await new Promise(done => {
        const img = new Image();
        const timer = setTimeout(() => done(false), 8000);
        img.onload = () => { clearTimeout(timer); done(img.naturalWidth > 0); };
        img.onerror = () => { clearTimeout(timer); done(false); };
        img.src = url;
      });
      if (ok) return url;
    }
    return null;
  }

  async function addCar(form) {
    const f = new FormData(form);
    const parsed = parseTomicaNumber(f.get('code'));
    const say = text => { carMessage = text; form.querySelector('.car-msg').textContent = text; };
    if (!parsed) return say('That number doesn\'t look right. Try 23, P41 or U11.');
    const { n, ...car } = parsed;
    if (byNum[car.num]) return say(`${car.code} is already on the list.`);
    car.name = f.get('name').trim();
    car.search = `Tomica ${car.code.replace(' (long)', '')} ${car.name}`;
    say('Looking for a photo…');
    const typed = safeUrl(f.get('img'));
    car.img = typed || (n ? await findPhoto(regularPhotoGuesses(n)) : null);
    if (!car.img) {
      return say(n ? 'Takara Tomy has no photo for that number. Paste a photo link.' : 'Paste a photo link for this car.');
    }
    const cars = [...(kids.extraCars ?? []), car];
    await store.setExtraCars(keys, cars);
    kids.extraCars = cars;
    joinCars(cars);
    const price = f.get('price') === '' ? null : Number(f.get('price'));
    if (price !== null) {
      const shop = f.get('shop');
      const entry = { price, stock: 'In stock' };
      const url = safeUrl(f.get('url'));
      if (url) entry.url = url;
      await store.setOverride(keys.famKey, car.num, { shops: { [shop]: entry }, updatedAt: Date.now() });
    }
    carMessage = `Added ${car.code} ${car.name}.`;
    draw();
    return undefined;
  }

  async function begin() {
    const email = await store.currentAdmin() ?? (demo ? await store.signInAdmin() : null);
    if (!email) return signInScreen();
    try {
      keys = await store.adminKeys();
    } catch (err) {
      if (err.code === 'permission-denied') return signInScreen(`${email} can't run this list. Sign in with the right account.`);
      throw err;
    }
    if (!keys) return setupScreen();

    alertTopic = await store.getAlerts();
    kids = await store.getSpace(keys.kidKey);
    joinCars(kids.extraCars);
    familySpace = await store.getSpace(keys.famKey) ?? {};
    // Sets added for the admin start hidden, once. After that the admin decides.
    const seen = kids.adminOnlySeen ?? [];
    const fresh = sets.filter(s => s.adminOnly && !seen.includes(s.num)).map(s => s.num);
    if (fresh.length) {
      kids.hidden = [...new Set([...(kids.hidden ?? []), ...fresh])];
      kids.adminOnlySeen = [...seen, ...fresh];
      await store.setHidden(keys.kidKey, kids.hidden, kids.adminOnlySeen);
    }
    draw();
    store.watchSpace(keys.kidKey, s => { if (s) { kids = s; joinCars(s.extraCars); draw(); } });
    store.watchPicks(keys.kidKey, p => { picks = p; draw(); });
    store.watchWishlist(keys.famKey, w => { wishlist = w; draw(); });
    store.watchClaims(keys.famKey, c => { claims = c; draw(); });
    store.watchOverrides(keys.famKey, o => { overrides = o; draw(); });
    store.watchShares(keys.famKey, x => { shares = x; draw(); });
  }

  begin();
}
