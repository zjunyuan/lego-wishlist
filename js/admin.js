import { ageFor, esc, daysSince, legoFor, money, msrpFor, msrpHtml, offersFor, partsFor, offLabel, photo, priceFor, priceHtml, safeUrl, shopsFor, shortDate, SHOPS, toast, yen } from './util.js';
import { mergeImport, parseSheet } from './import.js';

const STALE_DAYS = 7;
const STALE_PRICE_DAYS = 14;

export async function render({ root, store, sets, fx, demo }) {
  const byNum = Object.fromEntries(sets.map(s => [s.num, s]));
  let keys, kids, picks = {}, wishlist = {}, claims = {}, shares = {}, overrides = {};
  let pendingImport = null;
  let familySpace = {};
  let editing = null;
  const filters = { q: '', theme: 'all', show: 'picked', sort: 'year', dir: -1 };
  const COLUMNS = [
    ['photo', ''], ['num', 'Set'], ['name', 'Name'], ['ageNum', 'Age'], ['parts', 'Pieces'], ['msrp', 'MSRP'],
    ['lazada', 'Lazada'], ['shopee', 'Shopee'], ['amazonsg', 'Amazon SG'], ['amazonjp', 'Amazon JP'],
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
        (out[num] ??= {})[c.id] = { fav: Boolean(p.fav) };
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
    const shops = shopsFor(overrides[num]);
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
          ${s.yen
            ? field(`${s.id}_price`, 'Price (¥)', e.price, 'type="number" step="1" min="0"')
            : field(`${s.id}_price`, 'Price (S$)', e.price, money2)}
          ${s.custom ? '' : field(`${s.id}_final`, s.yen ? 'Delivered (S$)' : 'After vouchers (S$)', e.final, money2)}
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
      const price = priceFor(s.num, overrides, fx);
      const offers = offersFor(s.num, overrides, fx);
      const shopPrices = Object.fromEntries(SHOPS.map(shop => [shop.id, offers.find(o => o.id === shop.id)?.amount ?? null]));
      return {
        ...s,
        ...shopPrices,
        price,
        offers,
        amount: price?.amount ?? null,
        each: price && s.parts ? price.amount / s.parts : null,
        seller: price?.seller ?? null,
        checked: overrides[s.num]?.updatedAt ?? null,
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
    if (o.yen && o.listed != null) text = yen(o.listed);
    else if (o.listed != null || o.amount != null) text = money(o.listed ?? o.amount);
    const main = url && text ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
    let note = '';
    if (o.afterVouchers) note = `${money(o.amount)} after vouchers`;
    else if (o.delivered) note = `${money(o.amount)} delivered`;
    else if (o.about) note = `About ${money(o.about)}`;
    const stock = o.available ? '' : `<span class="stale block">${esc(o.stock === 'Out of stock' ? 'Sold out' : o.stock)}</span>`;
    const seller = o.seller && !shop.custom ? `<span class="muted block">${esc(o.seller)}</span>` : '';
    return `<span class="${r.price?.id === id ? 'cheapest' : ''}">${main}</span>${note ? `<span class="muted block">${esc(note)}</span>` : ''}${seller}${stock}${search}`;
  }

  function dbCell(key, r) {
    switch (key) {
      case 'photo': return photo(r);
      case 'num': return `<b>${esc(r.num)}</b>`;
      case 'name': return `${esc(r.name)}<span class="muted block">${esc(r.theme ?? '')}</span>`;
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
      case 'lazada': case 'shopee': case 'amazonsg': case 'amazonjp': return shopCell(key, r);
      case 'amount': {
        if (!r.price) return '<span class="muted">No price</span>';
        const url = safeUrl(r.price.url);
        const text = `${r.price.yen && !r.price.delivered ? 'About ' : ''}${money(r.amount)}`;
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
        ${fx?.sgdPerJpy ? `<p class="muted">Amazon JP estimates use \u00a5100 = ${money(fx.sgdPerJpy * 100)} (${esc(fx.date ?? '')}). They leave out shipping and import charges, so they only count as the best price once you enter a delivered cost.</p>` : ''}
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

      <section>
        <h2>Picks</h2>
        <ul class="pick-status">
          ${kids.children.map(c => {
            const n = Object.keys(picks[c.id]?.sets ?? {}).length;
            const done = Boolean(picks[c.id]?.finished);
            return `<li><b>${esc(c.name)}:</b> ${n} pick${n === 1 ? '' : 's'}, ${done ? 'finished' : 'still choosing'}
              ${done ? `<button class="quiet" data-reopen="${esc(c.id)}">Let ${esc(c.name)} change the list</button>` : ''}</li>`;
          }).join('')}
        </ul>
        <div class="publish">
          <p>${pending ? `${pending} change${pending > 1 ? 's' : ''} to send to the family list.` : 'The family list is up to date.'}</p>
          <button class="claim" data-publish ${pending ? '' : 'disabled'}>Update family list</button>
        </div>
        ${nums.length ? `<ul class="rows">${nums.map(num => {
          const set = byNum[num] ?? { num, name: `Set ${num}` };
          const price = priceFor(num, overrides, fx);
          const who = want[num] ?? wishlist[num]?.for ?? {};
          return `<li class="row">
            ${photo(set)}
            <div class="row-body">
              <h3>${esc(set.name)}</h3>
              <p class="set-meta">Set ${esc(num)}</p>
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
        <h2>Reserved gifts</h2>
        ${claimList.length ? `<ul class="rows">${claimList.map(([id, c]) => {
          const old = c.status === 'reserved' && daysSince(c.at) >= STALE_DAYS;
          return `<li class="claim-row">
            <div><b>${esc(byNum[c.num]?.name ?? `Set ${c.num}`)}</b> for ${esc(nameOf(c.child))}
              <p class="set-meta">${c.status === 'bought' ? 'Bought' : 'Reserved'} by ${esc(c.by)}${old ? `, not bought after ${daysSince(c.at)} days` : ''}</p></div>
            <button class="quiet" data-release="${esc(id)}">Release</button>
          </li>`;
        }).join('')}</ul>` : '<p class="empty">Nothing reserved yet.</p>'}
      </section>

      <section>
        <h2>Note for the family</h2>
        <p>This shows at the top of the family page, such as who to give gifts to and by when.</p>
        <textarea class="note-box" rows="3" maxlength="400" aria-label="Note for the family">${esc(familySpace.note ?? '')}</textarea>
        <div class="sheet-actions"><button class="claim" data-save-note>Save note</button></div>
      </section>

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

  root.onsubmit = async e => {
    if (!e.target.matches('.override')) return;
    e.preventDefault();
    const f = new FormData(e.target);
    const number = name => {
      const value = f.get(name);
      return value === null || value === '' ? null : Number(value);
    };
    const num = e.target.dataset.num;
    const saved = shopsFor(overrides[num]);
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
    const { filter, visible } = e.target.dataset ?? {};
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
      if ('signin' in d) {
        await store.signInAdmin();
        begin();
      } else if (d.copy) {
        await navigator.clipboard.writeText(d.copy);
        toast('Link copied.');
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

    kids = await store.getSpace(keys.kidKey);
    familySpace = await store.getSpace(keys.famKey) ?? {};
    draw();
    store.watchSpace(keys.kidKey, s => { if (s) { kids = s; draw(); } });
    store.watchPicks(keys.kidKey, p => { picks = p; draw(); });
    store.watchWishlist(keys.famKey, w => { wishlist = w; draw(); });
    store.watchClaims(keys.famKey, c => { claims = c; draw(); });
    store.watchOverrides(keys.famKey, o => { overrides = o; draw(); });
    store.watchShares(keys.famKey, x => { shares = x; draw(); });
  }

  begin();
}
