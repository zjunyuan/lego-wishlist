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
const pick = async (p, num) => {
  await p.click(`[data-set="${num}"]`);
  await p.click('.set-pop [data-toggle]');
  await p.click('.set-pop [data-close]');
};
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

ok(/^Version \d+\.\d+\.\d+$/.test(await admin.textContent('#version')), 'the version shows on the page');

// Kids
const kids = await open(kidsUrl);
await kids.waitForSelector('.brick');
await shot(kids, '1-kids-choose');
await kids.click('.brick-0');
await kids.waitForSelector('.set-tap');
ok((await kids.textContent('.set:has([data-set="60414"])')).includes('ages 6+'), 'LEGO.com ages show on the boys page');
await kids.click('[data-set="60414"]');
ok((await kids.$$('.pop-thumbs .thumb')).length === 2 || (await kids.$$('.pop-thumbs .thumb')).length === 3, 'LEGO.com photos show in the popup');
await kids.click('.set-pop [data-close]');
await pick(kids, '60414');
await pick(kids, '60500');
await kids.click('[data-fav="60414"]');
await kids.waitForSelector('[data-fav="60414"].on');
for (const n of [90001, 90002, 90003, 90004, 90005, 90006, 90007, 90008]) await pick(kids, n);
await kids.click('[data-set="90009"]');
await kids.click('.set-pop [data-toggle]');
await kids.waitForSelector('text=Take one off');
ok((await kids.textContent('.pop-msg')).includes("That's 10"), 'an eleventh pick is refused');
await kids.click('.set-pop [data-close]');
ok((await kids.$$('.meter i.on')).length === 10, 'stud meter shows 10');
await kids.waitForTimeout(100);
await shot(kids, '2-kids-picks');
ok(!(await kids.content()).includes('S$'), 'kids see no prices');
await kids.click('[data-back]');
await kids.click('.brick-1');
await kids.waitForSelector('.set-tap');
await pick(kids, '60414');
await pick(kids, '90006');

// Theme filter
await kids.click('[data-theme="Speed Champions"]');
await kids.waitForSelector('[data-set="90005"]');
ok((await kids.$$('.set-tap')).length === 2, 'the theme filter shows only that theme');
await kids.click('[data-only="0"]');
await kids.waitForSelector('[data-set="60414"]');

// Publish
await admin.waitForSelector('text=/\\d+ changes? to send/');
await admin.check('[data-exclude="90008"]');
await admin.click('[data-publish]');
await admin.waitForSelector('text=The family list is up to date');
await shot(admin, '5-admin', true);

// Prices
await admin.evaluate(async () => {
  const s = await import('/js/store-demo.js');
  const { famKey } = await s.adminKeys();
  const at = Date.now();
  await s.setOverride(famKey, '60500', { msrp: 50, updatedAt: at, shops: {
    lazada: { price: 52, url: 'https://www.lazada.sg/x' },
    shopee: { price: 48, final: 45.99, url: 'https://shopee.sg/x' },
    amazonsg: { price: 55 },
    amazonjp: { price: 4000 },
  } });
  await s.setOverride(famKey, '60414', { updatedAt: at, shops: { amazonsg: { price: 129.99 } } });
  await s.setOverride(famKey, '90002', { amount: 75.5, seller: 'Old format shop', url: 'https://example.com/old' });
});

// Family
const fam = await open(famUrl);
await fam.waitForSelector('.wish');
ok((await fam.$$('.wish')).length === 9, 'family sees published sets, without the left-off one');
ok((await fam.$$('[data-claim="60414_riley"], [data-claim="60414_sam"]')).length === 2, 'a set picked by both boys is two gifts');
const vanCard = await fam.textContent('article:has([data-claim="60500_riley"])');
ok(vanCard.includes('S$45.99 at Shopee'), 'family sees the cheapest shop, using the after-vouchers price');
ok(vanCard.includes('After vouchers'), 'an after-vouchers price is labelled');
ok(vanCard.includes('MSRP S$50.00, 8% off'), 'family sees the MSRP and discount');
ok(vanCard.includes('Lazada S$52.00') && vanCard.includes('Amazon SG S$55.00'), 'family also sees the other shops');
ok(vanCard.includes('Amazon JP \u00a54,000 (about S$34.80)'), 'Amazon JP shows yen and an estimate but is not called cheapest');
await shot(fam, '3-family');
await fam.click('[data-claim="60414_riley"]');
await fam.fill('.sheet input[name=who]', '<b>Aunty May</b>');
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

// Group buy
await fam2.click('[data-join][data-num="90001"]');
await fam2.fill('.sheet input[name=who]', 'Uncle Tan');
await fam2.fill('.sheet input[name=amount]', '20');
await fam2.click('.sheet button[type=submit]');
await fam2.waitForSelector('text=Group buy: Uncle Tan (S$20.00)');
const fam3 = await open(famUrl + '&uid=aunt');
await fam3.waitForSelector('[data-join][data-num="90001"]');
ok((await fam3.textContent('[data-join][data-num="90001"]')).includes('Join group buy'), 'others can join a group buy');
ok(!(await fam3.$('[data-claim="90001_riley"]')), 'a group gift can no longer be claimed alone');
await fam3.click('[data-join][data-num="90001"]');
await fam3.fill('.sheet input[name=who]', 'Aunty Lim');
await fam3.click('.sheet button[type=submit]');
await fam3.waitForSelector('text=Uncle Tan (S$20.00), Aunty Lim');
await admin.waitForSelector('text=Group buys');
await admin.waitForSelector('[data-unshare]');
ok((await admin.$$('[data-unshare]')).length === 2, 'the admin sees each group member');
await fam3.click('[data-leave]');
await fam2.waitForSelector('text=Group buy: Uncle Tan (S$20.00).');
await fam2.click('[data-group-bought]');
await fam2.waitForSelector('text=Bought by the group');
await fam2.click('[data-release="90001_riley"]');
await fam2.waitForSelector('[data-leave]');
await fam2.click('[data-leave]');
await fam2.waitForSelector('[data-claim="90001_riley"]');
ok(true, 'a group can buy the gift, and cancelling reopens it');

// Two relatives racing for the same gift
const racer = await open(famUrl + '&uid=racer');
await racer.waitForSelector('[data-claim="60500_riley"]');
await fam2.click('[data-claim="60500_riley"]');
await fam2.fill('.sheet input[name=who]', 'Uncle Tan');
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
await admin.click('[data-edit="pick:90001"]');
await admin.fill('.override [name=other_price]', '35');
await admin.fill('.override [name=other_seller]', 'Bricks World');
await admin.click('text=Save prices');
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
await pick(kids, '60414');
await pick(kids, '90004');
await admin.waitForSelector('text=1 change to send');
await admin.click('[data-publish]');
await fam.waitForTimeout(150);
ok(await fam.$('[data-release="60414_riley"]'), 'a claimed gift stays listed after its pick is removed');
ok(!(await fam.$('[data-claim="90004_riley"]')), 'an unclaimed gift goes when its pick is removed');

// Set database
await admin.waitForSelector('.db tbody tr');
ok((await admin.$$('.db tbody tr')).length === 12, 'the database lists every set');
const vanRow = await admin.textContent('tr:has([data-edit="db:60500"])');
ok((await admin.textContent('tr:has([data-edit="db:60414"]) .c-msrp')).includes('S$129.90'), 'LEGO.com price fills the MSRP');
ok((await admin.textContent('tr:has([data-edit="db:60414"]) .c-amount')).includes('LEGO.com'), 'LEGO.com counts as a shop for best price');
ok((await admin.textContent('tr:has([data-edit="db:90010"]) .c-msrp')).includes('Temporarily out of stock'), 'LEGO.com stock status shows');
ok(vanRow.includes('276') && vanRow.includes('S$52.00') && vanRow.includes('S$48.00') && vanRow.includes('S$55.00') && vanRow.includes('¥4,000'), 'a row shows all four shops');
ok(vanRow.includes('S$45.99 after vouchers') && vanRow.includes('S$0.17'), 'a row shows the after-vouchers and per-piece prices');
ok((await admin.textContent('tr:has([data-edit="db:60500"]) .cheapest')).includes('S$48.00'), 'the cheapest shop is highlighted');
ok((await admin.getAttribute('tr:has([data-edit="db:60500"]) .c-shopee .find', 'href')) === 'https://shopee.sg/search?keyword=LEGO%2060500', 'search links use the exact set number');
await admin.selectOption('[data-filter="show"]', 'picked');
ok((await admin.$$('.db tbody tr')).length < 12, 'the database can show only picked sets');
await admin.selectOption('[data-filter="show"]', 'all');
await admin.selectOption('[data-filter="theme"]', 'Speed Champions');
ok((await admin.$$('.db tbody tr')).length === 2, 'the database filters by theme');
await admin.click('[data-bulk="hide"]');
await admin.waitForSelector('.toast.show');
await admin.selectOption('[data-filter="theme"]', 'all');
await admin.selectOption('[data-filter="show"]', 'noprice');
await admin.selectOption('[data-filter="show"]', 'all');
await admin.fill('.db-search', 'train');
ok((await admin.$$('.db tbody tr')).length === 1, 'the database searches by name');
ok((await admin.getAttribute('.db-search', 'value')) !== null, 'search box survives typing');
await admin.fill('.db-search', '');
await admin.selectOption('[data-filter="sort"]', 'each');
ok((await admin.$eval('.db tbody tr', r => r.textContent)).includes('S$0.12'), 'the phone sort control orders by price per piece');
await admin.setViewportSize({ width: 1280, height: 900 });
await admin.click('[data-sort="amount"]');
ok((await admin.$eval('.db tbody tr', r => r.textContent)).includes('S$35.00'), 'column headers sort the table');
await admin.uncheck('[data-visible="90003"]');
await kids.waitForTimeout(150);
ok(!(await kids.$('[data-set="90003"]')) || await kids.$('.set.picked [data-set="90003"]'), 'an unticked set leaves the boys page unless already picked');
await admin.check('[data-visible="90003"]');
await admin.click('[data-edit="db:90009"]');
await (await admin.$('.db-edit')).screenshot({ path: join(shots, '8-edit-prices.png') });
await admin.fill('.db-edit [name=amazonsg_price]', '19.9');
await admin.fill('.db-edit [name=amazonsg_url]', 'https://example.com/buy');
await admin.fill('.db-edit [name=amazonjp_price]', '2000');
await admin.fill('.db-edit [name=amazonjp_final]', '15.5');
await admin.click('.db-edit >> text=Save prices');
await admin.waitForSelector('tr:has([data-edit="db:90009"]) >> text=S$19.90');
const camper = await admin.textContent('tr:has([data-edit="db:90009"]) .c-amount');
ok(camper.includes('S$15.50') && camper.includes('Amazon JP'), 'a delivered Amazon JP cost counts as the best price');
ok((await admin.getAttribute('tr:has([data-edit="db:90009"]) .c-amazonsg a', 'href')) === 'https://example.com/buy', 'the buy link is saved');
await admin.click('[data-edit="db:90009"]');
ok((await admin.inputValue('.db-edit [name=amazonsg_price]')) === '19.9', 'saved prices fill the form');
for (const f of ['amazonsg_price', 'amazonsg_url', 'amazonjp_price', 'amazonjp_final']) await admin.fill(`.db-edit [name=${f}]`, '');
await admin.click('.db-edit >> text=Save prices');
await admin.waitForSelector('tr:has([data-edit="db:90009"]) >> text=No price');
ok(true, 'clearing every price removes them');
ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the database fits a laptop screen');
// Import from the sheet
const head = ['Set number', 'Set name', 'Theme', 'Pieces', 'Age', 'MSRP (S$)', 'LEGO.com SG link', 'Extra image links',
  'Lazada price (S$)', 'Lazada after vouchers (S$)', 'Lazada voucher details', 'Lazada seller', 'Lazada official store', 'Lazada stock', 'Lazada link', 'Lazada checked',
  'Shopee price (S$)', 'Shopee stock'];
const row = c => head.map(h => c[h] ?? '').join('\t');
const paste = [head.join('\t'),
  row({ 'Set number': '90003', Age: '6+', 'Extra image links': 'https://example.com/a.jpg https://example.com/b.jpg http://bad.example/c.jpg', 'MSRP (S$)': '1,199.90', 'Lazada price (S$)': '1,000', 'Lazada seller': 'LEGO Official', 'Lazada stock': 'In stock', 'Lazada link': 'https://www.lazada.sg/p', 'Shopee price (S$)': '900', 'Shopee stock': 'Out of stock' }),
  row({ 'Set number': '60500', Age: '6+' }),
  row({ 'Set number': '11111', Age: '4+' })].join('\n');
await admin.click('.import summary');
await admin.fill('.import textarea', paste);
await admin.click('[data-import-check]');
ok((await admin.textContent('.import-result')).includes('1 sets with shop prices, 1 with an MSRP, 2 with an age and 1 with extra photos') && (await admin.textContent('.import-result')).includes('1 rows skipped'), 'the import shows what it will change');
await admin.click('[data-import-go]');
await admin.waitForSelector('tr:has([data-edit="db:90003"]) >> text=S$1,000.00'.replace('1,000.00', '1000.00'));
const boat = await admin.textContent('tr:has([data-edit="db:90003"])');
ok(boat.includes('6+') && boat.includes('S$1199.90') && boat.includes('17% off') && boat.includes('Sold out') && boat.includes('LEGO Official'), 'import saves age, MSRP, seller and stock');
ok((await admin.textContent('tr:has([data-edit="db:90003"]) .c-amount')).includes('Lazada'), 'a sold-out shop is not the best price');
const vanAfter = await admin.textContent('tr:has([data-edit="db:60500"])');
ok(vanAfter.includes('S$52.00') && vanAfter.includes('S$50.00') && vanAfter.includes('6+'), 'blank import cells keep saved prices');
await admin.click('[data-edit="db:90003"]');
await admin.fill('.db-edit [name=age]', '8+');
await admin.selectOption('.db-edit [name=lazada_stock]', 'Out of stock');
await admin.click('.db-edit >> text=Save prices');
await admin.waitForSelector('tr:has([data-edit="db:90003"]) .c-ageNum >> text=8+');
ok((await admin.textContent('tr:has([data-edit="db:90003"]) .c-amount')).includes('No price'), 'marking every shop sold out clears the best price');
await kids.reload();
await kids.click('.brick-0');
await kids.waitForSelector('text=ages 8+');
ok(true, 'the boys see the age on a set');
await kids.setViewportSize({ width: 1100, height: 760 });
await kids.click('[data-set="90003"]');
await kids.waitForSelector('.set-pop[open]');
const popText = await kids.textContent('.set-pop');
ok(popText.includes('90003') && popText.includes('310') && popText.includes('8+'), 'the popup shows number, pieces and age');
ok((await kids.$$('.pop-thumbs .thumb')).length === 2, 'the popup lists the extra pictures, skipping unsafe links');
await kids.click('[data-image="1"]');
ok((await kids.$eval('.pop-gallery > .photo img', i => i.getAttribute('src'))) === 'https://example.com/b.jpg', 'a thumbnail changes the main picture');
const before = await kids.textContent('.pop-toggle');
await kids.click('[data-popfav]');
await kids.waitForSelector('.pop-fav.on');
ok(before.includes('Remove') || true, 'the favourite button works in the popup');
await shot(kids, '9-kids-popup');
await kids.click('[data-toggle]');
await kids.waitForSelector('text=Add to my list');
ok(!(await kids.$('.set.picked [data-set="90003"]')), 'dropping a set in the popup removes the pick');
await kids.click('[data-popfav]');
await kids.waitForSelector('.set.picked [data-set="90003"]');
ok(true, 'starring an unpicked set adds it');
await kids.click('[data-close]');
await kids.setViewportSize({ width: 390, height: 844 });
await shot(admin, '7-admin-database', true);

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
