import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bestPrice, boughtAlert, cancelAlert, claimAlert, completeAlert, finishedAlert, isComplete, isFirst, joinedAlert, leftAlert, newlyBought, pledged, startedAlert,
} from '../functions/notify.js';

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

test('alerts cover cancelling, buying, joining and leaving', () => {
  assert.equal(cancelAlert({ by: 'May' }, 'Tram', 'Sam').message, "May's reservation of Tram for Sam was cancelled.");
  assert.equal(cancelAlert({ by: 'the group' }, 'Tram', 'Sam').message, "The group's purchase of Tram for Sam was cancelled.");
  assert.equal(boughtAlert({ by: 'May' }, 'Tram', 'Sam').message, 'May marked Tram for Sam as bought.');
  assert.equal(newlyBought({ status: 'reserved', by: 'May' }, { status: 'bought', by: 'May' }), true);
  assert.equal(newlyBought({ status: 'reserved', by: 'the group' }, { status: 'bought', by: 'the group' }), false);
  assert.equal(newlyBought({ status: 'bought', by: 'May' }, { status: 'wrapped', by: 'May' }), false);
  const may = { by: 'May', uid: 'a', at: 1, amount: 40 };
  const ben = { by: 'Ben', uid: 'b', at: 2, amount: 20 };
  assert.equal(isFirst(may, [ben, may]), true);
  assert.equal(isFirst(ben, [ben, may]), false);
  assert.equal(joinedAlert(ben, [may, ben], 100, 'Tram', 'Sam').message, 'Ben joined the group buy with S$20.00 for Tram for Sam. S$60.00 pledged of S$100.00.');
  assert.equal(joinedAlert({ by: 'Ben' }, [{ by: 'Ben' }], 100, 'Tram', 'Sam').message, 'Ben joined the group buy for Tram for Sam.');
  assert.equal(leftAlert(ben, 'Tram', 'Sam').message, 'Ben left the group buy for Tram for Sam.');
  assert.equal(finishedAlert('Sam').message, 'Sam has finished choosing.');
});

test('alerts say what happened', () => {
  assert.match(claimAlert({ by: 'May' }, 'Tram (60506)', 'Sam').message, /^May reserved Tram \(60506\) for Sam\.$/);
  assert.equal(claimAlert({ by: 'the group' }, 'Tram', 'Sam').title, 'Group buy bought');
  const list = [{ by: 'Ben', at: 2, amount: 60 }, { by: 'May', at: 1, amount: 40 }];
  assert.match(startedAlert(list, 'Tram', 'Sam').message, /^May started a group buy with S\$40\.00 for Tram for Sam\.$/);
  assert.match(startedAlert([{ by: 'May', at: 1 }], 'Tram', 'Sam').message, /^May started a group buy for Tram/);
  assert.equal(completeAlert(list, 95.5, 'Tram', 'Sam').message, 'Tram for Sam: S$100.00 pledged of S$95.50, from May, Ben.');
});
