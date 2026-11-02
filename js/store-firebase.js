// Firestore implementation of the store. store-demo.js has the same functions.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, runTransaction, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { newKey, slug, TakenError } from './util.js';

const configured = !firebaseConfig.apiKey.startsWith('PASTE');
const app = configured ? initializeApp(firebaseConfig) : null;
const auth = configured ? getAuth(app) : null;
const db = configured ? getFirestore(app) : null;

export const isConfigured = () => configured;
export const uid = () => auth.currentUser?.uid ?? null;

export function signInGuest() {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, user => {
      stop();
      if (user) resolve(user);
      else signInAnonymously(auth).then(r => resolve(r.user), reject);
    });
  });
}

export function currentAdmin() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, user => {
      stop();
      resolve(user && !user.isAnonymous ? user.email : null);
    });
  });
}

export async function signInAdmin() {
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  return result.user.email;
}

const toMap = snap => Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));

export async function getSpace(key) {
  const snap = await getDoc(doc(db, 'spaces', key));
  return snap.exists() ? snap.data() : null;
}

export const watchSpace = (key, cb) => onSnapshot(doc(db, 'spaces', key), s => cb(s.data() ?? null));
export const watchPicks = (kidKey, cb) => onSnapshot(collection(db, 'spaces', kidKey, 'picks'), s => cb(toMap(s)));
export const watchWishlist = (famKey, cb) => onSnapshot(collection(db, 'spaces', famKey, 'wishlist'), s => cb(toMap(s)));
export const watchClaims = (famKey, cb) => onSnapshot(collection(db, 'spaces', famKey, 'claims'), s => cb(toMap(s)));
export const watchOverrides = (famKey, cb) => onSnapshot(collection(db, 'spaces', famKey, 'overrides'), s => cb(toMap(s)));

export const setPicks = (kidKey, child, sets) =>
  setDoc(doc(db, 'spaces', kidKey, 'picks', child), { sets, updatedAt: Date.now() });

export async function claim(famKey, num, child, by) {
  const ref = doc(db, 'spaces', famKey, 'claims', `${num}_${child}`);
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw new TakenError(snap.data().by);
      tx.set(ref, { num, child, by, uid: uid(), status: 'reserved', at: Date.now() });
    });
  } catch (err) {
    if (err.code === 'permission-denied') {
      const snap = await getDoc(ref);
      if (snap.exists()) throw new TakenError(snap.data().by);
    }
    throw err;
  }
}

export const setClaimStatus = (famKey, id, status) =>
  updateDoc(doc(db, 'spaces', famKey, 'claims', id), { status, at: Date.now() });

export const release = (famKey, id) => deleteDoc(doc(db, 'spaces', famKey, 'claims', id));

// Admin only from here down. The security rules enforce this.

export async function adminKeys() {
  const snap = await getDoc(doc(db, 'admin', 'keys'));
  return snap.exists() ? snap.data() : null;
}

export async function createSpaces(names) {
  const children = names.map(name => ({ id: slug(name), name }));
  const keys = { kidKey: newKey(), famKey: newKey(), excluded: [] };
  const batch = writeBatch(db);
  batch.set(doc(db, 'spaces', keys.kidKey), { type: 'kids', children, owned: [] });
  batch.set(doc(db, 'spaces', keys.famKey), { type: 'family', children });
  batch.set(doc(db, 'admin', 'keys'), keys);
  await batch.commit();
  return keys;
}

export const setOwned = (kidKey, owned) => updateDoc(doc(db, 'spaces', kidKey), { owned });
export const setExcluded = excluded => updateDoc(doc(db, 'admin', 'keys'), { excluded });

export async function publishWishlist(famKey, entries, removeNums) {
  const batch = writeBatch(db);
  for (const e of entries) batch.set(doc(db, 'spaces', famKey, 'wishlist', e.num), e);
  for (const num of removeNums) batch.delete(doc(db, 'spaces', famKey, 'wishlist', num));
  await batch.commit();
}

export const setOverride = (famKey, num, value) =>
  value
    ? setDoc(doc(db, 'spaces', famKey, 'overrides', num), value)
    : deleteDoc(doc(db, 'spaces', famKey, 'overrides', num));
