import test from 'node:test';
import assert from 'node:assert/strict';
import { keepSet, markAdminOnly, markNew, parseCsv, selectSets, tomicaSets } from './update-data.mjs';

test('Tomica cars join the catalogue with no pieces', () => {
  const [car] = tomicaSets([{ num: 'T11', name: 'Huracán', series: 'Regular' }]);
  assert.equal(car.theme, 'Tomica');
  assert.equal(car.parts, null);
  assert.equal(car.series, 'Regular');
  assert.equal(car.adminOnly, true);
});

test('the Tomica list is well formed', async () => {
  const { readFile } = await import('node:fs/promises');
  const list = JSON.parse(await readFile(new URL('../data/tomica.json', import.meta.url), 'utf8'));
  assert.ok(list.length >= 20 && list.length <= 150);
  assert.equal(new Set(list.map(t => t.num)).size, list.length);
  for (const t of list) {
    assert.match(t.num, /^T[A-Z0-9]+$/);
    assert.ok(['Regular', 'Premium', 'Older cars', 'Gift sets & specials'].includes(t.series), t.num);
    assert.match(t.img, /^https:\/\//);
  }
});

test('typed Tomica numbers become cars', async () => {
  globalThis.document ??= { addEventListener() {} };
  const { parseTomicaNumber, regularPhotoGuesses, addExtraCars } = await import('../js/util.js');
  assert.deepEqual(parseTomicaNumber('No. 23'), { num: 'T23', code: 'No. 23', series: 'Regular', age: '3+', jpy: 594, n: 23 });
  assert.equal(parseTomicaNumber('133').code, 'No. 133 (long)');
  assert.equal(parseTomicaNumber('133').jpy, 1100);
  assert.equal(parseTomicaNumber('p5').num, 'TP05');
  assert.equal(parseTomicaNumber('Premium 41').code, 'Premium 41');
  assert.equal(parseTomicaNumber('U11').num, 'TU11');
  assert.equal(parseTomicaNumber('hello'), null);
  assert.equal(parseTomicaNumber('999'), null);
  assert.ok(regularPhotoGuesses(7)[0].endsWith('/007.jpg'));
  const sets = [{ num: '60500' }, { num: 'T11' }];
  addExtraCars(sets, [{ num: 'T11', name: 'dup' }, { num: 'T23', name: 'GT-R' }]);
  assert.deepEqual(sets.map(s => s.num), ['60500', 'T11', 'T23']);
  assert.equal(sets[2].theme, 'Tomica');
});

test('marks new sets and leaves the rest alone', () => {
  assert.deepEqual(markNew([{ num: '76934' }, { num: '60500' }], ['76934']), [{ num: '76934', isNew: true }, { num: '60500' }]);
  assert.deepEqual(markNew([{ num: '60500' }]), [{ num: '60500' }]);
});

test('marks admin-only sets and leaves the rest alone', () => {
  const out = markAdminOnly([{ num: '76934' }, { num: '60500' }], ['76934']);
  assert.deepEqual(out, [{ num: '76934', adminOnly: true }, { num: '60500' }]);
  assert.deepEqual(markAdminOnly([{ num: '60500' }]), [{ num: '60500' }]);
});

test('removes named, gift-with-purchase and over-limit sets', () => {
  const removed = { maxMsrp: 200, sets: ['60473'] };
  const details = { 30719: ['5+', 5.9, 'Gift with purchase'], 60508: ['7+', 299.9, 'Available now'], 60500: ['6+', 45.9, 'Available now'], 60999: ['6+', 200, 'Available now'] };
  assert.equal(keepSet('60473', removed, details), false);
  assert.equal(keepSet('30719', removed, details), false);
  assert.equal(keepSet('60508', removed, details), false);
  assert.equal(keepSet('60500', removed, details), true);
  assert.equal(keepSet('60999', removed, details), true);
  assert.equal(keepSet('77777', removed, details), true);
});

test('keeps an older set that is still on sale', () => {
  const themes = [{ id: '52', name: 'City', parent_id: '' }];
  const row = (set_num, year) => ({ set_num, name: set_num, year, theme_id: '52', num_parts: '100', img_url: 'https://x/y.jpg' });
  const out = selectSets(themes, [row('60414-1', '2024'), row('60300-1', '2024'), row('60500-1', '2026')], 2025, ['60414']);
  assert.deepEqual(out.map(s => s.num), ['60500', '60414']);
});

test('parses quoted CSV values', () => {
  const rows = parseCsv('set_num,name\n60500-1,"Van, ""LEGO"""\n');
  assert.deepEqual(rows, [{ set_num: '60500-1', name: 'Van, "LEGO"' }]);
});

test('selects recent sets from the wanted themes, including subthemes', () => {
  const themes = [
    { id: '52', name: 'City', parent_id: '' },
    { id: '60', name: 'Fire', parent_id: '52' },
    { id: '1', name: 'Technic', parent_id: '' },
    { id: '99', name: 'City', parent_id: '1' },
    { id: '601', name: 'Speed Champions', parent_id: '' },
  ];
  const row = (set_num, theme_id, year, num_parts) => ({ set_num, name: set_num, year, theme_id, num_parts, img_url: 'https://x/y.jpg' });
  const out = selectSets(themes, [
    row('60500-1', '52', '2026', '276'),
    row('60414-1', '60', '2025', '843'),
    row('76934-1', '601', '2025', '300'),
    row('60100-1', '52', '2016', '100'),
    row('30700-1', '52', '2026', '20'),
    row('42000-1', '1', '2026', '500'),
    row('43000-1', '99', '2026', '500'),
    row('60500-2', '52', '2026', '276'),
  ], 2025);
  assert.deepEqual(out.map(s => [s.num, s.theme]), [['60500', 'City'], ['60414', 'City'], ['76934', 'Speed Champions']]);
});
