import { esc, daysSince, money, photo, priceFor, priceHtml, safeUrl, toast } from './util.js';

const STALE_DAYS = 7;

export async function render({ root, store, sets, prices, demo }) {
  const byNum = Object.fromEntries(sets.map(s => [s.num, s]));
  let keys, kids, picks = {}, wishlist = {}, claims = {}, overrides = {};
  let editing = null;

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
      <label>Price (S$) <input name="amount" type="number" step="0.01" min="0" required value="${esc(current?.manual ? current.amount : '')}"></label>
      <label>Seller <input name="seller" required maxlength="40" value="${esc(current?.manual ? current.seller : '')}"></label>
      <label>Link <input name="url" type="url" placeholder="https://" value="${esc(current?.manual ? current.url ?? '' : '')}"></label>
      <div class="sheet-actions">
        ${current?.manual ? `<button type="button" class="quiet" data-clear="${esc(num)}">Use the daily price</button>` : ''}
        <button type="button" class="quiet" data-edit-cancel>Cancel</button>
        <button class="claim">Save price</button>
      </div>
    </form>`;
  }

  function draw() {
    if (root.querySelector('.override input:focus, .own-form input:focus')) return;
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
            <button class="quiet" data-copy="${esc(link('kids'))}">Copy kids' link</button></div>
          <div><b>For the family</b><p>Relatives reserve gifts here, with no sign-in. Don't send this one to the boys.</p>
            <button class="quiet" data-copy="${esc(link('family'))}">Copy family link</button></div>
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
                <button class="quiet" data-edit="${esc(num)}">Set price</button>
              </div>
              ${editing === num ? overrideForm(num, price) : ''}
            </div>
          </li>`;
        }).join('')}</ul>` : '<p class="empty">No picks yet. Send the boys their link to get started.</p>'}
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
    root.querySelector('.override')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const url = safeUrl(f.get('url')) ?? '';
      editing = null;
      document.activeElement?.blur();
      await store.setOverride(keys.famKey, e.target.dataset.num, {
        amount: Number(f.get('amount')), seller: f.get('seller').trim(), url,
      });
      toast(`Price saved: ${money(f.get('amount'))}`);
    });
  }

  root.onchange = async e => {
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
