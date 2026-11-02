import { esc, photo, toast } from './util.js';

const MAX_PICKS = 10;
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.5l-6 3.3 1.3-6.7-5-4.6 6.8-.8z"/></svg>';

export function render({ root, store, sets, key, space }) {
  let children = space.children;
  let owned = space.owned ?? [];
  let picks = {};
  let child = null;
  let onlyPicks = false;
  let search = '';

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
      .filter(s => !owned.includes(s.num))
      .filter(s => !onlyPicks || picked[s.num])
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.num.includes(q));

    if (!list.length) {
      return `<p class="empty">${onlyPicks ? 'Nothing picked yet. Go back to all sets and tap one you like.' : 'No sets match that. Try another word.'}</p>`;
    }
    return list.map(s => {
      const p = picked[s.num];
      return `
        <article class="set ${p ? 'picked' : ''}">
          <button class="set-tap" data-set="${esc(s.num)}" aria-pressed="${Boolean(p)}" aria-label="${p ? 'Remove' : 'Pick'} ${esc(s.name)}">
            ${photo(s)}
            <span class="set-name">${esc(s.name)}</span>
            <span class="set-meta">Set ${esc(s.num)}, ${esc(s.parts)} pieces</span>
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
          <button class="tab" data-only="0" aria-pressed="${!onlyPicks}">All sets</button>
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

  root.onclick = e => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.child) {
      child = children.find(c => c.id === el.dataset.child);
      onlyPicks = false;
      search = '';
      scrollTo(0, 0);
      draw();
    } else if (el.hasAttribute('data-back')) {
      child = null;
      draw();
    } else if (el.dataset.only) {
      onlyPicks = el.dataset.only === '1';
      draw();
    } else if (el.dataset.set) {
      const next = { ...mine() };
      const num = el.dataset.set;
      if (next[num]) delete next[num];
      else if (Object.keys(next).length >= MAX_PICKS) return toast(`That's ${MAX_PICKS}! Take one off to pick another.`);
      else next[num] = { fav: false };
      save(next);
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
    if (child) refreshGrid(); else draw();
  });

  store.watchPicks(key, p => {
    picks = p;
    if (child) refreshGrid(); else draw();
  });

  draw();
}
