import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, selectSets } from './update-data.mjs';

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
