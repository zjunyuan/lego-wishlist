import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestPrice, claimAlert, completeAlert, isComplete, pledged, startedAlert } from '../functions/notify.js';

// util.js listens for broken images on load, which needs a page.
globalThis.document ??= { addEventListener() {} };
const { priceFor, setDetails, setShopData } = await import('../js/util.js');

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url)));

test('alerts pick the same price as the family page', () => {
  const details = read('details.json');
  const shops = read('shops.json');
  setDetails(details.sets);
  setShopData(shops);
  const overrides = {
    60414: { shops: { other: { price: 1, seller: 'Test' } } },
    60411: { amount: 2 },
    60415: { shops: { lazada: { price: 3, stock: 'Out of stock' } } },
  };
  const nums = read('sets.json').map(s => s.num);
  assert.ok(nums.length > 0);
  for (const num of nums) {
    assert.equal(bestPrice(num, details.sets, shops.sets, overrides[num]), priceFor(num, overrides)?.amount ?? null, num);
  }
});

test('a group buy is complete once pledges reach the price', () => {
  assert.equal(isComplete([{ amount: 40 }, { amount: 59 }], 100), false);
  assert.equal(isComplete([{ amount: 40 }, { amount: 60 }], 100), true);
  assert.equal(isComplete([{ amount: 40 }, {}], 40), true);
  assert.equal(isComplete([{}, {}], 100), false);
  assert.equal(isComplete([{ amount: 40 }], null), false);
  assert.equal(pledged([{ amount: 5 }, {}]), 5);
});

test('alerts say what happened', () => {
  assert.match(claimAlert({ by: 'May' }, 'Tram (60506)', 'Sam').message, /^May reserved Tram \(60506\) for Sam\.$/);
  assert.equal(claimAlert({ by: 'the group' }, 'Tram', 'Sam').title, 'Group buy bought');
  const list = [{ by: 'Ben', at: 2, amount: 60 }, { by: 'May', at: 1, amount: 40 }];
  assert.match(startedAlert(list, 'Tram', 'Sam').message, /^May started a group buy with S\$40\.00 for Tram for Sam\.$/);
  assert.match(startedAlert([{ by: 'May', at: 1 }], 'Tram', 'Sam').message, /^May started a group buy for Tram/);
  assert.equal(completeAlert(list, 95.5, 'Tram', 'Sam').message, 'Tram for Sam: S$100.00 pledged of S$95.50, from May, Ben.');
});
