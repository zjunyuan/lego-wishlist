// Sends a phone alert when a gift is reserved, or a group buy starts or reaches
// its price. The ntfy channel lives in admin/notify, never in this public repo.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { bestPrice, claimAlert, completeAlert, isComplete, startedAlert } from './notify.js';

initializeApp();
const db = getFirestore();

const SITE = 'https://zjunyuan.github.io/lego-wishlist';
const options = { region: 'asia-southeast1', memory: '256MiB', maxInstances: 3 };

async function siteData(file) {
  const res = await fetch(`${SITE}/data/${file}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json();
}

async function setName(num) {
  try {
    const sets = await siteData('sets.json');
    const set = sets.find(s => s.num === num);
    return set ? `${set.name} (${num})` : num;
  } catch (err) {
    logger.warn('No set name', err);
    return num;
  }
}

async function childName(key, id) {
  const space = await db.doc(`spaces/${key}`).get();
  return space.data()?.children?.find(c => c.id === id)?.name ?? id;
}

// Firestore can fire a trigger twice. Only the first call for an id gets through.
async function once(id) {
  try {
    await db.doc(`notified/${id}`).create({ at: Date.now() });
    return true;
  } catch (err) {
    if (err.code === 6) return false;
    throw err;
  }
}

async function send({ title, message }) {
  const topic = (await db.doc('admin/notify').get()).data()?.topic;
  if (!topic) return;
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, tags: ['gift'], click: `${SITE}/?admin` }),
  });
  if (!res.ok) logger.error('ntfy refused the alert', res.status, await res.text());
}

export const alertOnClaim = onDocumentCreated({ ...options, document: 'spaces/{key}/claims/{id}' }, async event => {
  const claim = event.data?.data();
  if (!claim || !(await once(`claim_${event.id}`))) return;
  const { key } = event.params;
  const [name, child] = await Promise.all([setName(claim.num), childName(key, claim.child)]);
  await send(claimAlert(claim, name, child));
});

export const alertOnShare = onDocumentCreated({ ...options, document: 'spaces/{key}/shares/{id}' }, async event => {
  const share = event.data?.data();
  if (!share) return;
  const { key } = event.params;
  const { num, child } = share;
  const snap = await db.collection(`spaces/${key}/shares`).where('num', '==', num).where('child', '==', child).get();
  const list = snap.docs.map(d => d.data());
  const [name, kid] = await Promise.all([setName(num), childName(key, child)]);

  const gift = `${key}_${num}_${child}`;
  if (await once(`started_${gift}`)) await send(startedAlert(list, name, kid));

  const [details, shops, override] = await Promise.all([
    siteData('details.json'),
    siteData('shops.json'),
    db.doc(`spaces/${key}/overrides/${num}`).get(),
  ]);
  const price = bestPrice(num, details.sets, shops.sets, override.data());
  if (isComplete(list, price) && await once(`complete_${gift}`)) await send(completeAlert(list, price, name, kid));
});
