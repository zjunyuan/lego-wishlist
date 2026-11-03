import { ageFor, amazonCheckHtml, avatar, esc, imagesFor, money, msrpFor, msrpHtml, partsFor, photo, priceFor, priceHtml, toast, TakenError } from './util.js';

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

export function render({ root, store, sets, key, space }) {
  let wishlist = {};
  let claims = {};
  let overrides = {};
  let shares = {};
  let ages = space.ages ?? {};
  let band = 'all';
  let who = 'all';
  let note = space.note ?? '';
  let photos = space.photos ?? {};
  let takenOpen = false;
  let shownSet = null;
  let shownImage = 0;
  let byEntry = {};
  const inView = e => Object.keys(e.for).filter(c => who === 'all' || c === who);
  const pictures = e => [e.set.img, ...imagesFor(e.num)].filter(Boolean);

  const pop = document.createElement('dialog');
  pop.className = 'set-pop family-pop';
  document.body.append(pop);
  pop.addEventListener('close', () => { pop.textContent = ''; });
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
    const label = `${avatar(childId, photos)}For ${esc(nameOf(childId))}${wish.fav ? ' <span class="fav-tag">Favourite</span>' : ''}`;
    const ids = `data-num="${esc(num)}" data-child="${esc(childId)}"`;
    if (c) {
      const mine = c.uid === store.uid();
      const state = c.status === 'reserved' ? 'Reserved' : 'Bought';
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
      .map(w => ({ ...w, set: byNum[w.num] ?? { num: w.num, name: `Set ${w.num}` }, price: priceFor(w.num, overrides) }))
      .sort((a, b) => (a.price?.amount ?? 1e9) - (b.price?.amount ?? 1e9));
    const test = BANDS.find(b => b.id === band).test;
    byEntry = Object.fromEntries(entries.map(e => [e.num, e]));
    const shown = entries.filter(e => test(e.price) && inView(e).length);
    const gifts = entries.flatMap(e => inView(e).map(c => [e.num, c]));
    const total = entries.reduce((n, e) => n + Object.keys(e.for).length, 0);
    const need = gifts.filter(([num, c]) => !claims[`${num}_${c}`] && !sharesFor(num, c).length).length;
    // A gift you claimed stays up top so you can mark it bought or cancel it.
    const isTaken = e => inView(e).every(c => {
      const claim = claims[`${e.num}_${c}`];
      return claim && claim.uid !== store.uid();
    });
    const openList = shown.filter(e => !isTaken(e));
    const takenList = shown.filter(isTaken);
    const card = e => `
      <article class="wish">
        <button class="wish-open" data-open="${esc(e.num)}" aria-label="See photos of ${esc(e.set.name)}">
          ${photo(e.set)}
          ${pictures(e).length > 1 ? `<span class="photo-count">${pictures(e).length} photos</span>` : ''}
        </button>
        <div class="wish-body">
          <h2><button class="wish-title" data-open="${esc(e.num)}">${esc(e.set.name)}</button></h2>
          <p class="set-meta">Set ${esc(e.num)}${e.set.parts ? `, ${esc(partsFor(e.set))} pieces` : ''}${ageFor(e.num, ages) ? `, ages ${esc(ageFor(e.num, ages))}` : ''}</p>
          ${priceHtml(e.price)}
          ${amazonCheckHtml(e.num, overrides)}
          ${msrpHtml(msrpFor(e.num, overrides), e.price)}
          <ul class="gifts">${inView(e).map(c => giftRow(e.num, c, e.for[c], e.price)).join('')}</ul>
        </div>
      </article>`;

    root.innerHTML = `
      <main class="family">
        <header class="family-head">
          <h1>${esc(children.map(c => c.name).join(' and '))}'s Christmas LEGO</h1>
          <p>${total ? `${need} of ${gifts.length} gifts still need someone. Choose one and everyone will see it's taken.` : 'The list isn\'t ready yet. Check back soon.'}</p>
          ${total ? `<div class="family-note">
            ${note ? `<p class="note-text">${esc(note)}</p>` : ''}
            <p>Changed your mind? Use Cancel on the device you reserved with. If you can't, message the boys' parents.</p>
          </div>
          <div class="bands" role="group" aria-label="Filter by child">
            <button class="tab" data-who="all" aria-pressed="${who === 'all'}">All gifts</button>
            ${children.map(c => `<button class="tab" data-who="${esc(c.id)}" aria-pressed="${c.id === who}">${avatar(c.id, photos)}For ${esc(c.name)}</button>`).join('')}
          </div>
          <div class="bands" role="group" aria-label="Filter by price">
            ${BANDS.map(b => `<button class="tab" data-band="${b.id}" aria-pressed="${b.id === band}">${b.label}</button>`).join('')}
          </div>` : ''}
        </header>
        <div class="family-list">
          ${openList.map(card).join('')}
          ${total && !shown.length ? '<p class="empty">Nothing matches these filters. Try another one.</p>' : ''}
          ${total && shown.length && !openList.length ? '<p class="empty">Everything here has been taken. Thank you!</p>' : ''}
          ${takenList.length ? `<details class="taken-group" ${takenOpen ? 'open' : ''}>
            <summary>Already taken (${takenList.length})</summary>
            <div class="family-list">${takenList.map(card).join('')}</div>
          </details>` : ''}
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

  function drawPop() {
    const e = byEntry[shownSet];
    if (!e) {
      if (pop.open) pop.close();
      return;
    }
    const pics = pictures(e);
    const main = pics[shownImage] ?? pics[0];
    pop.innerHTML = `
      <button class="pop-close" data-close aria-label="Close">\u00d7</button>
      <div class="pop-gallery">
        ${photo({ num: e.num, img: main })}
        ${pics.length > 1 ? `<div class="pop-thumbs">${pics.map((src, i) => `
          <button class="thumb" data-image="${i}" aria-label="Picture ${i + 1}" aria-pressed="${i === shownImage}">${photo({ num: e.num, img: src })}</button>`).join('')}</div>` : ''}
      </div>
      <div class="pop-info">
        <h2>${esc(e.set.name)}</h2>
        <dl>
          <dt>Set number</dt><dd>${esc(e.num)}</dd>
          ${e.set.parts ? `<dt>Pieces</dt><dd>${esc(partsFor(e.set))}</dd>` : ''}
          ${ageFor(e.num, ages) ? `<dt>Age</dt><dd>${esc(ageFor(e.num, ages))}</dd>` : ''}
        </dl>
        <div class="pop-price">
          ${priceHtml(e.price)}
          ${amazonCheckHtml(e.num, overrides)}
          ${msrpHtml(msrpFor(e.num, overrides), e.price)}
        </div>
        <ul class="gifts">${inView(e).map(c => giftRow(e.num, c, e.for[c], e.price)).join('')}</ul>
      </div>`;
  }

  function openPop(num) {
    shownSet = num;
    shownImage = 0;
    drawPop();
    pop.showModal();
    pop.scrollTop = 0;
  }

  pop.onclick = e => {
    if (e.target === pop) return pop.close();
    const el = e.target.closest('button');
    if (!el) return undefined;
    if ('close' in el.dataset) return pop.close();
    if (el.dataset.image) {
      shownImage = Number(el.dataset.image);
      return drawPop();
    }
    // Closing first keeps the name box on top, and shows the result on the page.
    pop.close();
    return act(el);
  };

  async function act(el) {
    const { band: b, who: person, claim, num, child, bought, release, join, leave, groupBought } = el.dataset;
    try {
      if (b) { band = b; draw(); }
      else if (person) { who = person; draw(); }
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
  }

  root.onclick = e => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.open) openPop(el.dataset.open);
    else act(el);
  };

  // Don't redraw under an open name box.
  const update = () => {
    if (root.querySelector('.sheet[open]')) return;
    draw();
    if (pop.open) drawPop();
  };
  store.watchWishlist(key, w => { wishlist = w; update(); });
  store.watchClaims(key, c => { claims = c; update(); });
  store.watchOverrides(key, o => { overrides = o; update(); });
  store.watchShares(key, x => { shares = x; update(); });
  store.watchSpace(key, x => { ages = x?.ages ?? {}; note = x?.note ?? ''; photos = x?.photos ?? {}; update(); });
  root.addEventListener('toggle', e => {
    if (e.target.matches?.('.taken-group')) takenOpen = e.target.open;
  }, true);
  draw();
}
