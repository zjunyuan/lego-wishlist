import { ageFor, esc, money, msrpFor, msrpHtml, partsFor, photo, priceFor, priceHtml, toast, TakenError } from './util.js';

const NAME_KEY = 'lego-wishlist-name';
const BANDS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'low', label: 'Under S$50', test: p => p && p.amount < 50 },
  { id: 'mid', label: 'S$50 to S$100', test: p => p && p.amount >= 50 && p.amount <= 100 },
  { id: 'high', label: 'Over S$100', test: p => p && p.amount > 100 },
];

function savedName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* still works for this visit */ }
}

export function render({ root, store, sets, fx, key, space }) {
  let wishlist = {};
  let claims = {};
  let overrides = {};
  let shares = {};
  let ages = space.ages ?? {};
  let band = 'all';
  const children = space.children;
  const byNum = Object.fromEntries(sets.map(s => [s.num, s]));
  const nameOf = id => children.find(c => c.id === id)?.name ?? id;

  const sharesFor = (num, child) => Object.entries(shares)
    .filter(([, x]) => x.num === num && x.child === child)
    .sort((a, b) => a[1].at - b[1].at);

  function groupText(list, price) {
    const names = list.map(([, x]) => (x.amount ? `${x.by} (${money(x.amount)})` : x.by)).join(', ');
    const pledged = list.reduce((n, [, x]) => n + (x.amount ?? 0), 0);
    const target = pledged && price ? ` ${money(pledged)} of ${money(price.amount)} so far.` : '';
    return `Group buy: ${names}.${target}`;
  }

  const giftRow = (num, childId, wish, price) => {
    const id = `${num}_${childId}`;
    const c = claims[id];
    const group = sharesFor(num, childId);
    const label = `For ${esc(nameOf(childId))}${wish.fav ? ' <span class="fav-tag">Favourite</span>' : ''}`;
    const ids = `data-num="${esc(num)}" data-child="${esc(childId)}"`;
    if (c) {
      const mine = c.uid === store.uid();
      const state = c.status === 'bought' ? 'Bought' : 'Reserved';
      return `<li class="gift taken"><span>${label}<small>${state} by ${esc(c.by)}</small>${
        group.length ? `<small class="group">${esc(groupText(group, price))}</small>` : ''}</span>${
        mine ? `<span class="mine">
          ${c.status === 'reserved' ? `<button class="quiet" data-bought="${esc(id)}">Mark as bought</button>` : ''}
          <button class="quiet" data-release="${esc(id)}">Cancel</button></span>` : ''}</li>`;
    }
    if (group.length) {
      const myShare = group.find(([, x]) => x.uid === store.uid());
      return `<li class="gift grouped"><span>${label}<small class="group">${esc(groupText(group, price))}</small></span><span class="mine">${
        myShare
          ? `<button class="quiet" data-group-bought="1" ${ids}>Mark group gift as bought</button>
             <button class="quiet" data-leave="${esc(myShare[0])}">Leave group</button>`
          : `<button class="claim" data-join="1" ${ids}>Join group buy</button>`}</span></li>`;
    }
    return `<li class="gift"><span>${label}</span><span class="mine">
      <button class="quiet" data-join="1" ${ids}>Start group buy</button>
      <button class="claim" data-claim="${esc(id)}" ${ids}>I'll get this</button></span></li>`;
  };

  function draw() {
    const entries = Object.values(wishlist)
      .map(w => ({ ...w, set: byNum[w.num] ?? { num: w.num, name: `Set ${w.num}` }, price: priceFor(w.num, overrides, fx) }))
      .sort((a, b) => (a.price?.amount ?? 1e9) - (b.price?.amount ?? 1e9));
    const test = BANDS.find(b => b.id === band).test;
    const shown = entries.filter(e => test(e.price));
    const total = entries.reduce((n, e) => n + Object.keys(e.for).length, 0);
    const open = entries.reduce((n, e) => n + Object.keys(e.for).filter(c => !claims[`${e.num}_${c}`] && !sharesFor(e.num, c).length).length, 0);

    root.innerHTML = `
      <main class="family">
        <header class="family-head">
          <h1>${esc(children.map(c => c.name).join(' and '))}'s Christmas LEGO</h1>
          <p>${total ? `${open} of ${total} gifts still need someone. Choose one and everyone will see it's taken.` : 'The list isn\'t ready yet. Check back soon.'}</p>
          ${total ? `<div class="bands" role="group" aria-label="Filter by price">
            ${BANDS.map(b => `<button class="tab" data-band="${b.id}" aria-pressed="${b.id === band}">${b.label}</button>`).join('')}
          </div>` : ''}
        </header>
        <div class="family-list">
          ${shown.map(e => `
            <article class="wish">
              ${photo(e.set)}
              <div class="wish-body">
                <h2>${esc(e.set.name)}</h2>
                <p class="set-meta">Set ${esc(e.num)}${e.set.parts ? `, ${esc(partsFor(e.set))} pieces` : ''}${ageFor(e.num, ages) ? `, ages ${esc(ageFor(e.num, ages))}` : ''}</p>
                ${priceHtml(e.price)}
                ${msrpHtml(msrpFor(e.num, overrides), e.price)}
                <ul class="gifts">${Object.entries(e.for).map(([c, w]) => giftRow(e.num, c, w, e.price)).join('')}</ul>
              </div>
            </article>`).join('')}
          ${total && !shown.length ? '<p class="empty">Nothing in this price range. Try another one.</p>' : ''}
        </div>
      </main>
      <dialog class="sheet">
        <form method="dialog">
          <h2>Who's getting this?</h2>
          <p>Your name will show on the list.</p>
          <label>Your name <input name="who" maxlength="40" required autocomplete="name"></label>
          <label class="share-amount" hidden>Amount you'd like to put in (S$, optional) <input name="amount" type="number" step="1" min="0"></label>
          <div class="sheet-actions">
            <button type="button" class="quiet" data-cancel>Cancel</button>
            <button type="submit" class="claim" value="ok">Reserve this gift</button>
          </div>
        </form>
      </dialog>`;
  }

  async function reserve(num, child, by) {
    try {
      await store.claim(key, num, child, by);
      toast(`Reserved for ${nameOf(child)}. Thank you, ${by}!`);
    } catch (err) {
      if (err instanceof TakenError) toast(`${err.by} has just taken this one.`);
      else { console.error(err); toast('That didn\'t save. Check your connection and try again.'); }
    }
  }

  async function joinGroup(num, child, by, amount) {
    try {
      await store.joinShare(key, num, child, by, amount);
      toast(`You've joined the group buy for ${nameOf(child)}.`);
    } catch (err) {
      console.error(err);
      toast('That didn\'t save. Check your connection and try again.');
    }
  }

  function askName(num, child, join = false) {
    const dialog = root.querySelector('.sheet');
    const input = dialog.querySelector('input[name=who]');
    const amount = dialog.querySelector('input[name=amount]');
    dialog.querySelector('h2').textContent = join ? 'Join the group buy' : 'Who\'s getting this?';
    dialog.querySelector('button[type=submit]').textContent = join ? 'Join group buy' : 'Reserve this gift';
    dialog.querySelector('.share-amount').hidden = !join;
    input.value = savedName();
    amount.value = '';
    dialog.showModal();
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      saveName(name);
      dialog.close();
      if (join) joinGroup(num, child, name, amount.value === '' ? null : Number(amount.value));
      else reserve(num, child, name);
    };
  }

  root.onclick = async e => {
    const el = e.target.closest('button');
    if (!el) return;
    const { band: b, claim, num, child, bought, release, join, leave, groupBought } = el.dataset;
    try {
      if (b) { band = b; draw(); }
      else if (claim) askName(num, child);
      else if (join) askName(num, child, true);
      else if (leave) { await store.leaveShare(key, leave); toast('You\'ve left the group buy.'); }
      else if (groupBought) {
        await store.claim(key, num, child, 'the group');
        await store.setClaimStatus(key, `${num}_${child}`, 'bought');
        toast('Marked as bought.');
      }
      else if (bought) { await store.setClaimStatus(key, bought, 'bought'); toast('Marked as bought.'); }
      else if (release) { await store.release(key, release); toast('Cancelled. It\'s available again.'); }
    } catch (err) {
      console.error(err);
      toast('That didn\'t save. Check your connection and try again.');
    }
  };

  // Don't redraw under an open name box.
  const update = () => { if (!root.querySelector('.sheet[open]')) draw(); };
  store.watchWishlist(key, w => { wishlist = w; update(); });
  store.watchClaims(key, c => { claims = c; update(); });
  store.watchOverrides(key, o => { overrides = o; update(); });
  store.watchShares(key, x => { shares = x; update(); });
  store.watchSpace(key, x => { ages = x?.ages ?? {}; update(); });
  draw();
}
