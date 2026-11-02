import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, selectCitySets, pickPrice } from './update-data.mjs';

// Shapes and values copied from a real BuyWhere search for 60500.
const tru = { title: 'LEGO City: The LEGO Van 60500', price: { amount: 45.99, currency: 'SGD' }, merchant: 'toysrus_sg', merchant_id: 'toysrus_sg', merchant_name: 'Toysrus Sg', merchant_slug: 'toysrus-sg', country_code: 'SG', url: 'https://www.toysrus.com.sg/product/10120697', updated_at: '2026-05-06T21:19:00.931Z' };
const southAfrica = { title: '60500 LEGO City The LEGO Van', price: { amount: 549, currency: 'USD' }, merchant: 'newworld.co.za', country_code: 'SG', url: 'https://newworld.co.za/products/60500' };
const ireland = { title: 'Lego The LEGO Van | 60500', price: { amount: 22.99, currency: 'USD' }, merchant: 'heavins.ie', country_code: 'SG', url: 'https://heavins.ie/products/x' };
const usa = { title: 'The LEGO Van, 60500 - LEGO City Set', price: { amount: 40, currency: 'USD' }, country_code: 'US', url: 'https://atlbrick.com/x' };
const local = { title: 'LEGO 60500 Van', price: { amount: 41, currency: 'SGD' }, merchant_name: 'Brick Bargains', country_code: 'SG', url: 'https://shopee.sg/x' };

test('uses the Singapore seller and ignores foreign listings labelled as Singapore', () => {
  const p = pickPrice([southAfrica, ireland, usa, tru], '60500');
  assert.equal(p.amount, 45.99);
  assert.equal(p.seller, 'Toys"R"Us');
  assert.equal(p.trusted, true);
  assert.equal(p.url, 'https://www.toysrus.com.sg/product/10120697');
  assert.equal(p.lastSeen, '2026-05-06T21:19:00.931Z');
});

test('prefers a trusted seller over a cheaper unknown one', () => {
  assert.equal(pickPrice([local, tru], '60500').seller, 'Toys"R"Us');
});

test('falls back to an unknown Singapore seller, flagged as unchecked', () => {
  const p = pickPrice([local], '60500');
  assert.equal(p.trusted, false);
  assert.equal(p.seller, 'Brick Bargains');
});

test('rejects other sets and add-ons', () => {
  const other = { ...tru, title: 'LEGO City Fire Station 60414' };
  const longer = { ...tru, title: 'LEGO 605001 Van' };
  const led = { ...tru, title: 'LED light kit for LEGO 60500' };
  assert.equal(pickPrice([other, longer, led], '60500'), null);
});

test('returns null when nothing matches', () => assert.equal(pickPrice([], '60500'), null));

test('parses quoted CSV values', () => {
  const rows = parseCsv('set_num,name\n60500-1,"Van, ""LEGO"""\n');
  assert.deepEqual(rows, [{ set_num: '60500-1', name: 'Van, "LEGO"' }]);
});

test('selects recent City sets, including subthemes', () => {
  const themes = [
    { id: '52', name: 'City', parent_id: '' },
    { id: '60', name: 'Fire', parent_id: '52' },
    { id: '1', name: 'Technic', parent_id: '' },
    { id: '99', name: 'City', parent_id: '1' },
  ];
  const row = (set_num, theme_id, year, num_parts) => ({ set_num, name: set_num, year, theme_id, num_parts, img_url: 'https://x/y.jpg' });
  const out = selectCitySets(themes, [
    row('60500-1', '52', '2026', '276'),
    row('60414-1', '60', '2025', '843'),
    row('60100-1', '52', '2016', '100'),
    row('30700-1', '52', '2026', '20'),
    row('42000-1', '1', '2026', '500'),
    row('43000-1', '99', '2026', '500'),
    row('60500-2', '52', '2026', '276'),
  ], 2025);
  assert.deepEqual(out.map(s => s.num), ['60500', '60414']);
});
