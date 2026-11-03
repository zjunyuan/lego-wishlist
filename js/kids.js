import { ageFor, esc, imagesFor, partsFor, photo, safeUrl, toast } from './util.js';

const MAX_PICKS = 10;
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.5l-6 3.3 1.3-6.7-5-4.6 6.8-.8z"/></svg>';

export function render({ root, store, sets, key, space }) {
  let children = space.children;
  let owned = space.owned ?? [];
  let hidden = space.hidden ?? [];
  let ages = space.ages ?? {};
  let images = space.images ?? {};
  let shown = null;
  let shownImage = 0;
  let picks = {};
  let child = null;
  let onlyPicks = false;
  let theme = null;
  let search = '';
  const themes = [...new Set(sets.map(s => s.theme).filter(Boolean))];

  const mine = () => picks[child?.id]?.sets ?? {};
  const count = id => Object.keys(picks[id]?.sets ?? {}).length;

  function chooser() {
    root.innerHTML = `
      <main class="baseplate chooser">
        <h1>Who's choosing?</h1>
        <div class="bricks">
          ${children.map((c, i) => `
            <button class="brick brick-${i}" data-child="${esc(c.id)}">
              <span class="studs" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              <span class="brick-face">
                <span class="brick-name">${esc(c.name)}</span>
                <span class="brick-count">${count(c.id)} of ${MAX_PICKS} picked</span>
              </span>
            </button>`).join('')}
        </div>
      </main>`;
  }

  function meter() {
    const n = Object.keys(mine()).length;
    return `<div class="meter" role="img" aria-label="${n} of ${MAX_PICKS} picked">
      ${Array.from({ length: MAX_PICKS }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}
    </div>`;
  }

  function cards() {
    const picked = mine();
    const q = search.trim().toLowerCase();
    const list = sets
      .filter(s => picked[s.num] || !(owned.includes(s.num) || hidden.includes(s.num)))
      .filter(s => !onlyPicks || picked[s.num])
      .filter(s => !theme || s.theme === theme)
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.num.includes(q));

    if (!list.length) {
      return `<p class="empty">${onlyPicks ? 'Nothing picked yet. Go back to all sets and tap one you like.' : 'No sets match that. Try another word.'}</p>`;
    }
    return list.map(s => {
      const p = picked[s.num];
      return `
        <article class="set ${p ? 'picked' : ''}">
          <button class="set-tap" data-set="${esc(s.num)}" aria-haspopup="dialog" aria-label="See ${esc(s.name)}">
            ${photo(s)}
            <span class="set-name">${esc(s.name)}</span>
            <span class="set-meta">Set ${esc(s.num)}, ${esc(partsFor(s))} pieces${ageFor(s.num, ages) ? `, ages ${esc(ageFor(s.num, ages))}` : ''}</span>
          </button>
          ${p ? `<button class="fav ${p.fav ? 'on' : ''}" data-fav="${esc(s.num)}" aria-pressed="${Boolean(p.fav)}" aria-label="Favourite ${esc(s.name)}">${STAR}</button>` : ''}
        </article>`;
    }).join('');
  }

  function grid() {
    root.innerHTML = `
      <div class="kid-bar">
        <button class="back" data-back>Change name</button>
        <h1>${esc(child.name)}'s picks</h1>
        <div class="meter-slot">${meter()}</div>
      </div>
      <main class="kid-page">
        <div class="kid-tools">
          <button class="tab" data-only="0" aria-pressed="${!onlyPicks && !theme}">All sets</button>
          ${themes.map(t => `<button class="tab" data-theme="${esc(t)}" aria-pressed="${t === theme}">${esc(t)}</button>`).join('')}
          <button class="tab" data-only="1" aria-pressed="${onlyPicks}">My picks</button>
          <input class="search" type="search" placeholder="Search" aria-label="Search sets" value="${esc(search)}">
        </div>
        <div class="set-grid">${sets.length ? cards() : '<p class="empty">The sets are still being loaded. Come back soon.</p>'}</div>
      </main>`;
  }

  const draw = () => (child ? grid() : chooser());

  function refreshGrid() {
    root.querySelector('.set-grid').innerHTML = cards();
    root.querySelector('.meter-slot').innerHTML = meter();
  }

  async function save(next) {
    picks[child.id] = { sets: next };
    refreshGrid();
    try {
      await store.setPicks(key, child.id, next);
    } catch (err) {
      console.error(err);
      toast('That didn\'t save. Check the internet and try again.');
    }
  }

  const pop = document.createElement('dialog');
  pop.className = 'set-pop';
  document.body.append(pop);

  const pictures = set => [set.img, ...imagesFor(set.num, images)].filter(safeUrl);

  function drawPop(message = '') {
    if (!shown) return;
    const set = shown;
    const pics = pictures(set);
    const p = mine()[set.num];
    const main = pics[shownImage] ?? pics[0];
    pop.innerHTML = `
      <button class="pop-close" data-close aria-label="Close">×</button>
      <div class="pop-gallery">
        ${photo({ num: set.num, img: main })}
        ${pics.length > 1 ? `<div class="pop-thumbs">${pics.map((src, i) => `
          <button class="thumb" data-image="${i}" aria-label="Picture ${i + 1}" aria-pressed="${i === shownImage}">${photo({ num: set.num, img: src })}</button>`).join('')}</div>` : ''}
      </div>
      <div class="pop-info">
        <h2>${esc(set.name)}</h2>
        <dl>
          <dt>Set number</dt><dd>${esc(set.num)}</dd>
          <dt>Pieces</dt><dd>${esc(partsFor(set))}</dd>
          ${ageFor(set.num, ages) ? `<dt>Age</dt><dd>${esc(ageFor(set.num, ages))}</dd>` : ''}
          ${set.theme ? `<dt>Theme</dt><dd>${esc(set.theme)}</dd>` : ''}
        </dl>
        <p class="pop-msg" role="status">${esc(message)}</p>
        <button class="pop-toggle ${p ? 'remove' : ''}" data-toggle>${p ? 'Remove from my list' : 'Add to my list'}</button>
        <button class="pop-fav ${p?.fav ? 'on' : ''}" data-popfav aria-pressed="${Boolean(p?.fav)}">${STAR}<span>${p?.fav ? 'My favourite' : 'Make it a favourite'}</span></button>
      </div>`;
  }

  function openPop(num) {
    shown = sets.find(s => s.num === num);
    shownImage = 0;
    drawPop();
    pop.showModal();
  }

  pop.onclick = e => {
    if (e.target === pop) return pop.close();
    const el = e.target.closest('button');
    if (!el) return undefined;
    const num = shown.num;
    if ('close' in el.dataset) return pop.close();
    if (el.dataset.image) {
      shownImage = Number(el.dataset.image);
      return drawPop();
    }
    const next = { ...mine() };
    if ('toggle' in el.dataset) {
      if (next[num]) delete next[num];
      else if (Object.keys(next).length >= MAX_PICKS) return drawPop(`That's ${MAX_PICKS}! Take one off to pick another.`);
      else next[num] = { fav: false };
    } else if ('popfav' in el.dataset) {
      if (!next[num] && Object.keys(next).length >= MAX_PICKS) return drawPop(`That's ${MAX_PICKS}! Take one off to pick another.`);
      next[num] = { fav: !next[num]?.fav };
    }
    save(next);
    return drawPop();
  };

  root.onclick = e => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.child) {
      child = children.find(c => c.id === el.dataset.child);
      onlyPicks = false;
      theme = null;
      search = '';
      scrollTo(0, 0);
      draw();
    } else if (el.hasAttribute('data-back')) {
      child = null;
      draw();
    } else if (el.dataset.only) {
      onlyPicks = el.dataset.only === '1';
      theme = null;
      draw();
    } else if (el.dataset.theme) {
      theme = el.dataset.theme;
      onlyPicks = false;
      draw();
    } else if (el.dataset.set) {
      openPop(el.dataset.set);
    } else if (el.dataset.fav) {
      const num = el.dataset.fav;
      save({ ...mine(), [num]: { fav: !mine()[num].fav } });
    }
  };

  root.oninput = e => {
    if (e.target.matches('.search')) {
      search = e.target.value;
      root.querySelector('.set-grid').innerHTML = cards();
    }
  };

  store.watchSpace(key, s => {
    if (!s) return;
    children = s.children;
    owned = s.owned ?? [];
    hidden = s.hidden ?? [];
    ages = s.ages ?? {};
    images = s.images ?? {};
    if (child) refreshGrid(); else draw();
  });

  store.watchPicks(key, p => {
    picks = p;
    if (child) refreshGrid(); else draw();
  });

  draw();
}
