// The rules behind phone alerts. No Firebase here, so the tests can run it.
// bestPrice must pick the same price as priceFor in js/util.js.

export const money = n => `S$${Number(n).toFixed(2)}`;

const legoAvailable = stock => stock === 'Available now' || String(stock ?? '').startsWith('Will be shipped');

function overrideShops(entry) {
  if (!entry) return {};
  if (entry.shops) return entry.shops;
  return entry.amount ? { other: { price: entry.amount } } : {};
}

export function bestPrice(num, details, shops, override) {
  const amounts = [];
  const lego = details?.[num];
  if (lego && legoAvailable(lego[2]) && lego[1] != null) amounts.push(lego[1]);
  for (const e of Object.values({ ...shops?.[num], ...overrideShops(override) })) {
    const amount = e.final ?? e.price ?? null;
    if (amount != null && (!e.stock || e.stock === 'In stock')) amounts.push(amount);
  }
  return amounts.length ? Math.min(...amounts) : null;
}

export const pledged = list => list.reduce((n, x) => n + (x.amount ?? 0), 0);

export const isComplete = (list, price) => price != null && price > 0 && pledged(list) >= price;

export const claimAlert = (claim, setName, childName) => (claim.by === 'the group'
  ? { title: 'Group buy bought', message: `${setName} for ${childName} has been marked as bought by the group.` }
  : { title: 'Gift reserved', message: `${claim.by} reserved ${setName} for ${childName}.` });

const giftOwner = by => (by === 'the group' ? 'The group\'s purchase' : `${by}'s reservation`);

export const cancelAlert = (claim, setName, childName) => ({
  title: 'Reservation cancelled',
  message: `${giftOwner(claim.by)} of ${setName} for ${childName} was cancelled.`,
});

export const boughtAlert = (claim, setName, childName) => ({
  title: 'Gift bought',
  message: `${claim.by} marked ${setName} for ${childName} as bought.`,
});

// A group's purchase is already covered by its claim alert.
export const newlyBought = (before, after) => before.status !== 'bought' && after.status === 'bought' && after.by !== 'the group';

export function joinedAlert(share, list, price, setName, childName) {
  const amount = share.amount ? ` with ${money(share.amount)}` : '';
  const total = pledged(list);
  const progress = total && price != null ? ` ${money(total)} pledged of ${money(price)}.` : '';
  return { title: 'Group buy joined', message: `${share.by} joined the group buy${amount} for ${setName} for ${childName}.${progress}` };
}

export const leftAlert = (share, setName, childName) => ({
  title: 'Group buy left',
  message: `${share.by} left the group buy for ${setName} for ${childName}.`,
});

export const finishedAlert = childName => ({ title: 'List finished', message: `${childName} has finished choosing.` });

export const isFirst = (share, list) => [...list].sort((a, b) => a.at - b.at)[0]?.uid === share.uid;

export function startedAlert(list, setName, childName) {
  const first = [...list].sort((a, b) => a.at - b.at)[0];
  const amount = first.amount ? ` with ${money(first.amount)}` : '';
  return { title: 'Group buy started', message: `${first.by} started a group buy${amount} for ${setName} for ${childName}.` };
}

export function completeAlert(list, price, setName, childName) {
  const names = [...list].sort((a, b) => a.at - b.at).map(x => x.by).join(', ');
  return {
    title: 'Group buy complete',
    message: `${setName} for ${childName}: ${money(pledged(list))} pledged of ${money(price)}, from ${names}.`,
  };
}
