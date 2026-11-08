import { esc, loadJson, setCatalogue, setDetails, setShopData } from './util.js';
import { VERSION } from './version.js';

document.getElementById('version').textContent = `Version ${VERSION}`;

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const root = document.getElementById('app');

const message = (title, body) => {
  root.innerHTML = `<main class="message"><h1>${esc(title)}</h1><p>${esc(body)}</p></main>`;
};

async function start() {
  const store = await import(demo ? './store-demo.js' : './store-firebase.js');
  if (!store.isConfigured()) {
    message('Almost ready', 'Add your Firebase settings to js/firebase-config.js to switch this list on.');
    return;
  }

  const sets = await loadJson(demo ? 'data/demo-sets.json' : 'data/sets.json', []);
  if (!sets.length) {
    message('The list didn\'t load', 'Refresh the page to try again.');
    return;
  }
  setCatalogue(sets);
  const details = await loadJson(demo ? 'data/demo-details.json' : 'data/details.json', {});
  setDetails(details.sets);
  setShopData(await loadJson(demo ? 'data/demo-shops.json' : 'data/shops.json', {}));
  const context = { root, store, sets, demo };

  if (params.has('admin')) {
    (await import('./admin.js')).render(context);
    return;
  }

  const kidKey = params.get('kids');
  const famKey = params.get('family');
  if (!kidKey && !famKey) {
    message('Christmas LEGO list', 'This list is private. Open the link you were sent to see it.');
    return;
  }

  await store.signInGuest();
  const space = await store.getSpace(kidKey ?? famKey);
  const wanted = kidKey ? 'kids' : 'family';
  if (space?.type !== wanted) {
    message('This link doesn\'t work', 'Ask for a fresh link to the list.');
    return;
  }

  const view = await import(kidKey ? './kids.js' : './family.js');
  view.render({ ...context, key: kidKey ?? famKey, space });
}

start().catch(err => {
  console.error(err);
  message('The list didn\'t load', 'Check your connection and refresh the page.');
});
