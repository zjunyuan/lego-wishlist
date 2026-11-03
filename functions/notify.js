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
