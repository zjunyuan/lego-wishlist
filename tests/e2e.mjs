// Runs the whole flow in Chromium against the in-browser demo store.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(root, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'text/html' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const shots = join(root, 'tests/shots');
await mkdir(shots, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.route(/fonts\.g|rebrickable/, r => r.abort());
const errors = [];
const open = async url => {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.goto(base + url);
  return p;
};
const shot = (p, name, fullPage = false) => p.screenshot({ path: join(shots, `${name}.png`), fullPage });
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log('ok -', label); };

// Admin set-up
const admin = await open('?demo&admin');
await admin.fill('input[name=a]', 'Riley');
await admin.fill('input[name=b]', 'Sam');
await admin.click('text=Create the list');
await admin.waitForSelector('text=Run the list');
const links = await admin.$$eval('[data-copy]', b => b.map(x => x.dataset.copy));
const [kidsUrl, famUrl] = links.map(l => l.replace(base, ''));
ok(kidsUrl.includes('kids=') && famUrl.includes('family='), 'setup makes two different secret links');
ok(new URL(kidsUrl, base).searchParams.get('kids') !== new URL(famUrl, base).searchParams.get('family'), 'kid and family keys differ');

// Kids
const kids = await open(kidsUrl);
await kids.waitForSelector('.brick');
await shot(kids, '1-kids-choose');
await kids.click('.brick-0');
await kids.waitForSelector('.set-tap');
await kids.click('[data-set="60414"]');
await kids.click('[data-set="60500"]');
await kids.click('[data-fav="60414"]');
await kids.waitForSelector('[data-fav="60414"].on');
for (const n of [90001, 90002, 90003, 90004, 90005, 90006, 90007, 90008]) await kids.click(`[data-set="${n}"]`);
await kids.click('[data-set="90009"]');
await kids.waitForSelector('.toast.show');
ok((await kids.textContent('.toast')).includes("That's 10"), 'an eleventh pick is refused');
ok((await kids.$$('.meter i.on')).length === 10, 'stud meter shows 10');
await kids.waitForTimeout(100);
await shot(kids, '2-kids-picks');
ok(!(await kids.content()).includes('S$'), 'kids see no prices');
await kids.click('[data-back]');
await kids.click('.brick-1');
await kids.waitForSelector('.set-tap');
await kids.click('[data-set="60414"]');
await kids.click('[data-set="90006"]');

// Publish
await admin.waitForSelector('text=/\\d+ changes? to send/');
await admin.check('[data-exclude="90008"]');
await admin.click('[data-publish]');
await admin.waitForSelector('text=The family list is up to date');
await shot(admin, '5-admin', true);

// Family
const fam = await open(famUrl);
await fam.waitForSelector('.wish');
ok((await fam.$$('.wish')).length === 9, 'family sees published sets, without the left-off one');
ok((await fam.$$('[data-claim="60414_riley"], [data-claim="60414_sam"]')).length === 2, 'a set picked by both boys is two gifts');
ok((await fam.textContent('body')).includes('Last seen 7 May'), 'old prices are flagged');
ok((await fam.textContent('body')).includes('Check this seller'), 'unknown sellers are flagged');
await shot(fam, '3-family');
await fam.click('[data-claim="60414_riley"]');
await fam.fill('.sheet input', '<b>Aunty May</b>');
await fam.click('text=Reserve this gift');
await fam.waitForSelector('text=Reserved by <b>Aunty May</b>');
ok(!(await fam.$('.gift b')), 'names are shown as text, not code');
await fam.click('[data-bought="60414_riley"]');
await fam.waitForSelector('text=Bought by <b>Aunty May</b>');
await fam.waitForTimeout(100);
await shot(fam, '4-family-claimed');

// A second relative
const fam2 = await open(famUrl + '&uid=uncle');
await fam2.waitForSelector('.wish');
ok((await fam2.textContent('body')).includes('Bought by'), 'other relatives see who claimed it');
ok(!(await fam2.$('[data-claim="60414_riley"]')), 'a claimed gift has no button');
ok(!(await fam2.$('[data-release="60414_riley"]')), 'others cannot cancel it');
ok(await fam2.$('[data-claim="60414_sam"]'), 'the second copy is still free');

// Two relatives racing for the same gift
const racer = await open(famUrl + '&uid=racer');
await racer.waitForSelector('[data-claim="60500_riley"]');
await fam2.click('[data-claim="60500_riley"]');
await fam2.fill('.sheet input', 'Uncle Tan');
await racer.evaluate(async () => {
  const s = await import('/js/store-demo.js');
  await s.claim('x', '60500', 'riley', 'Racer');
});
await fam2.evaluate(() => localStorage.getItem('lego-wishlist-demo'));
await fam2.click('text=Reserve this gift');
await fam2.waitForSelector('.toast.show');
ok((await fam2.textContent('.toast')).includes('Racer has just taken'), 'the slower relative is told it has gone');

// Kids must never see claims
await kids.reload();
await kids.waitForSelector('.brick');
const kidText = await kids.textContent('body');
ok(!/Aunty|Reserved|Bought/.test(kidText), 'kids page shows nothing about claims');

// Price filter and manual price
await fam.click('[data-band="low"]');
ok((await fam.$$('.wish')).length === 1, 'price filter works');
await fam.click('[data-band="all"]');
await admin.click('[data-edit="90001"]');
await admin.fill('.override [name=amount]', '35');
await admin.fill('.override [name=seller]', 'Bricks World');
await admin.click('text=Save price');
await fam.waitForSelector('text=S$35.00');
ok(true, 'a manual price reaches the family page');

// Admin release, unpick, owned sets
await admin.waitForSelector('[data-release="60414_riley"]');
await admin.click('[data-release="60500_riley"]');
await fam2.waitForSelector('[data-claim="60500_riley"]');
ok(true, 'the admin can release a gift');
await admin.fill('.own-form input', '90010');
await admin.click('text=Hide this set');
await kids.click('.brick-0');
await kids.waitForSelector('.set-tap');
await kids.waitForTimeout(100);
ok(!(await kids.$('[data-set="90010"]')), 'owned sets are hidden from the boys');
await kids.click('[data-only="1"]');
await kids.click('[data-set="60414"]');
await kids.click('[data-set="90004"]');
await admin.waitForSelector('text=1 change to send');
await admin.click('[data-publish]');
await fam.waitForTimeout(150);
ok(await fam.$('[data-release="60414_riley"]'), 'a claimed gift stays listed after its pick is removed');
ok(!(await fam.$('[data-claim="90004_riley"]')), 'an unclaimed gift goes when its pick is removed');

// Bad links and wide screens
const bad = await open('?demo&family=nope');
await bad.waitForSelector('text=This link doesn\'t work');
ok(true, 'a wrong key shows a clear message');
ok((await (await open(kidsUrl.replace(/kids=/, 'family='))).waitForSelector('text=This link doesn\'t work')) !== null, 'a kids key does not open the family page');

for (const [name, url] of [['kids', kidsUrl], ['family', famUrl], ['admin', '?demo&admin']]) {
  const p = await open(url);
  await p.waitForTimeout(200);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(over <= 0, `${name} has no sideways scroll on a phone`);
}
const wide = await open(kidsUrl);
await wide.setViewportSize({ width: 1200, height: 800 });
await wide.waitForSelector('.brick');
await shot(wide, '6-kids-desktop');

assert.deepEqual(errors, []);
console.log(`\n${passed} checks passed, no page errors`);
await browser.close();
server.close();
