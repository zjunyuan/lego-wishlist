// In-browser stand-in for Firestore, used by ?demo for previews and tests.
// Nothing leaves the browser. Open with ?demo&uid=someone to act as another relative.
import { newKey, slug, TakenError } from './util.js';

const NAME = 'lego-wishlist-demo';
const params = new URLSearchParams(location.search);
const me = params.get('uid') ?? 'demo-user';
const listeners = new Set();

const blank = () => ({ spaces: {}, keys: null, picks: {}, wishlist: {}, claims: {}, overrides: {} });
const load = () => { try { return JSON.parse(localStorage.getItem(NAME)) ?? blank(); } catch { return blank(); } };
let state = load();

function save() {
  localStorage.setItem(NAME, JSON.stringify(state));
  listeners.forEach(l => l());
}
addEventListener('storage', () => { state = load(); listeners.forEach(l => l()); });

function watch(read, cb) {
  const fn = () => cb(structuredClone(read()));
  listeners.add(fn);
  setTimeout(fn);
  return () => listeners.delete(fn);
}

export const isConfigured = () => true;
export const uid = () => me;
export const signInGuest = async () => ({ uid: me });
export const currentAdmin = async () => (params.has('signedin') ? 'demo@example.com' : null);
export const signInAdmin = async () => 'demo@example.com';
export const getSpace = async key => state.spaces[key] ?? null;
export const watchSpace = (key, cb) => watch(() => state.spaces[key] ?? null, cb);
export const watchPicks = (key, cb) => watch(() => state.picks, cb);
export const watchWishlist = (key, cb) => watch(() => state.wishlist, cb);
export const watchClaims = (key, cb) => watch(() => state.claims, cb);
export const watchOverrides = (key, cb) => watch(() => state.overrides, cb);

export async function setPicks(key, child, sets) {
  state.picks[child] = { sets, updatedAt: Date.now() };
  save();
}

export async function claim(key, num, child, by) {
  state = load();
  const id = `${num}_${child}`;
  if (state.claims[id]) throw new TakenError(state.claims[id].by);
  state.claims[id] = { num, child, by, uid: me, status: 'reserved', at: Date.now() };
  save();
}

export async function setClaimStatus(key, id, status) {
  Object.assign(state.claims[id], { status, at: Date.now() });
  save();
}

export async function release(key, id) {
  delete state.claims[id];
  save();
}

export const adminKeys = async () => state.keys;

export async function createSpaces(names) {
  const children = names.map(name => ({ id: slug(name), name }));
  const keys = { kidKey: newKey(), famKey: newKey(), excluded: [] };
  state.spaces[keys.kidKey] = { type: 'kids', children, owned: [] };
  state.spaces[keys.famKey] = { type: 'family', children };
  state.keys = keys;
  save();
  return keys;
}

export async function setOwned(key, owned) { state.spaces[key].owned = owned; save(); }
export async function setHidden(key, hidden) { state.spaces[key].hidden = hidden; save(); }
export async function setExcluded(excluded) { state.keys.excluded = excluded; save(); }

export async function publishWishlist(key, entries, removeNums) {
  for (const e of entries) state.wishlist[e.num] = e;
  for (const n of removeNums) delete state.wishlist[n];
  save();
}

export async function setOverride(key, num, value) {
  if (value) state.overrides[num] = value;
  else delete state.overrides[num];
  save();
}
