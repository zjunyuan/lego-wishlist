import { esc, daysSince, money, photo, priceFor, priceHtml, safeUrl, shortDate, toast } from './util.js';

const STALE_DAYS = 7;

export async function render({ root, store, sets, prices, demo }) {
  const byNum = Object.fromEntries(sets.map(s => [s.num, s]));
  let keys, kids, picks = {}, wishlist = {}, claims = {}, overrides = {};
  let editing = null;
  const filters = { q: '', theme: 'all', show: 'all', sort: 'year', dir: -1 };
  const COLUMNS = [
    ['photo', ''], ['num', 'Set'], ['name', 'Name'], ['theme', 'Theme'], ['parts', 'Pieces'],
    ['amount', 'Price'], ['each', 'Per piece'], ['seller', 'Retailer'], ['seen', 'Seen'], ['visible', 'Boys see it'],
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

  function overrideForm(num, current) {
    return `<form class="override" data-num="${esc(num)}">
      <label>Price (S$) <input name="amount" type="number" step="0.01" min="0" required value="${esc(current?.amount ?? '')}"></label>
      <label>Retailer <input name="seller" required maxlength="40" value="${esc(current?.seller ?? '')}"></label>
      <label>Link to buy <input name="url" type="url" placeholder="https://" value="${esc(current?.url ?? '')}"></label>
      <div class="sheet-actions">
        ${current?.manual ? `<button type="button" class="quiet" data-clear="${esc(num)}">Use the daily price</button>` : ''}
        <button type="button" class="quiet" data-edit-cancel>Cancel</button>
        <button class="claim">Save price</button>
      </div>
    </form>`;
  }

  function dbRows() {
    const hidden = kids.hidden ?? [];
    const q = filters.q.trim().toLowerCase();
    const rows = sets.map(s => {
      const price = priceFor(s.num, prices, overrides);
      return {
        ...s,
        price,
        amount: price?.amount ?? null,
        each: price && s.parts ? price.amount / s.parts : null,
        seller: price?.seller ?? null,
        seen: price?.manual ? null : price?.lastSeen ?? null,
        visible: !hidden.includes(s.num),
      };
    }).filter(r => (
      (filters.theme === 'all' || r.theme === filters.theme)
      && (!q || r.name.toLowerCase().includes(q) || r.num.includes(q) || (r.seller ?? '').toLowerCase().includes(q))
      && (filters.show === 'all'
        || (filters.show === 'noprice' && !r.price)
        || (filters.show === 'old' && r.seen && daysSince(r.seen) > 30)
        || (filters.show === 'manual' && r.price?.manual)
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

  function dbCell(key, r) {
    switch (key) {
      case 'photo': return photo(r);
      case 'num': return `<b>${esc(r.num)}</b>`;
      case 'name': return esc(r.name);
      case 'theme': return esc(r.theme ?? '');
      case 'parts': return esc(r.parts);
      case 'amount': return r.price ? `<b>${money(r.amount)}</b>` : '<span class="muted">No price</span>';
      case 'each': return r.each === null ? '' : money(r.each);
      case 'seller': {
        if (!r.price) return '';
        const url = safeUrl(r.price.url);
        const name = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(r.seller)}</a>` : esc(r.seller);
        return r.price.trusted ? name : `${name} <span class="muted">(unchecked)</span>`;
      }
      case 'seen':
        if (r.price?.manual) return 'Set by you';
        if (!r.seen) return '';
        return `<span class="${daysSince(r.seen) > 30 ? 'stale' : ''}">${esc(shortDate(r.seen))}</span>`;
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
            <td class="c-edit"><button class="quiet" data-edit="db:${esc(r.num)}">Edit price</button></td>
          </tr>
          ${editing === `db:${r.num}` ? `<tr class="db-edit"><td colspan="${COLUMNS.length + 1}">${overrideForm(r.num, r.price)}</td></tr>` : ''}`).join('')}
        </tbody>
      </table>` : '<p class="empty">No sets match. Try another search or filter.</p>'}`;
  }

  function dbSection() {
    const themes = [...new Set(sets.map(s => s.theme).filter(Boolean))];
    const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
    return `
      <section>
        <h2>All sets</h2>
        <p>Check prices here and choose which sets the boys can see. New sets are shown to them unless you hide them.</p>
        <div class="db-tools">
          <label>Search <input class="db-search" type="search" value="${esc(filters.q)}" placeholder="Name, number or retailer"></label>
          <label>Theme <select data-filter="theme">
            ${option('all', 'All themes', filters.theme)}${themes.map(t => option(t, t, filters.theme)).join('')}
          </select></label>
          <label>Show <select data-filter="show">
            ${[['all', 'All sets'], ['visible', 'Shown to the boys'], ['hidden', 'Hidden from the boys'], ['noprice', 'No price'], ['old', 'Price over 30 days old'], ['manual', 'Prices you set']]
              .map(([v, l]) => option(v, l, filters.show)).join('')}
          </select></label>
          <label class="db-sort">Sort <select data-filter="sort">
            ${[['year', 'Newest'], ['amount', 'Price'], ['each', 'Price per piece'], ['parts', 'Pieces'], ['name', 'Name'], ['num', 'Set number']]
              .map(([v, l]) => option(v, l, filters.sort)).join('')}
          </select></label>
        </div>
        <div class="db-bulk">
          <button class="quiet" data-bulk="show">Show these to the boys</button>
          <button class="quiet" data-bulk="hide">Hide these from the boys</button>
        </div>
        <div id="db-table">${dbTable()}</div>
      </section>`;
  }

  const redrawDb = () => { root.querySelector('#db-table').innerHTML = dbTable(); };

  function draw() {
    if (root.querySelector('.override input:focus, .own-form input:focus, .db-search:focus')) return;
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
        <div class="publish">
          <p>${pending ? `${pending} change${pending > 1 ? 's' : ''} to send to the family list.` : 'The family list is up to date.'}</p>
          <button class="claim" data-publish ${pending ? '' : 'disabled'}>Update family list</button>
        </div>
        ${nums.length ? `<ul class="rows">${nums.map(num => {
          const set = byNum[num] ?? { num, name: `Set ${num}` };
          const price = priceFor(num, prices, overrides);
          const who = want[num] ?? wishlist[num]?.for ?? {};
          return `<li class="row">
            ${photo(set)}
            <div class="row-body">
              <h3>${esc(set.name)}</h3>
              <p class="set-meta">Set ${esc(num)}</p>
              <p class="who">${Object.entries(who).map(([c, w]) => esc(nameOf(c)) + (w.fav ? ' (favourite)' : '')).join(', ')}</p>
              ${priceHtml(price)}
              <div class="row-actions">
                <label class="check"><input type="checkbox" data-exclude="${esc(num)}" ${excluded.includes(num) ? 'checked' : ''}> Leave off the family list</label>
                <button class="quiet" data-edit="pick:${esc(num)}">Edit price</button>
              </div>
              ${editing === `pick:${num}` ? overrideForm(num, price) : ''}
            </div>
          </li>`;
        }).join('')}</ul>` : '<p class="empty">No picks yet. Send the boys their link to get started.</p>'}
      </section>

      ${dbSection()}

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
    const url = safeUrl(f.get('url')) ?? '';
    editing = null;
    document.activeElement?.blur();
    await store.setOverride(keys.famKey, e.target.dataset.num, {
      amount: Number(f.get('amount')), seller: f.get('seller').trim(), url,
    });
    draw();
    toast(`Price saved: ${money(f.get('amount'))}`);
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
      if (filter === 'sort') filters.dir = e.target.value === 'year' ? -1 : 1;
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
      } else if (d.clear) {
        editing = null;
        document.activeElement?.blur();
        await store.setOverride(keys.famKey, d.clear, null);
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
    draw();
    store.watchSpace(keys.kidKey, s => { if (s) { kids = s; draw(); } });
    store.watchPicks(keys.kidKey, p => { picks = p; draw(); });
    store.watchWishlist(keys.famKey, w => { wishlist = w; draw(); });
    store.watchClaims(keys.famKey, c => { claims = c; draw(); });
    store.watchOverrides(keys.famKey, o => { overrides = o; draw(); });
  }

  begin();
}
