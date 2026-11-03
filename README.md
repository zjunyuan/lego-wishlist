# Christmas LEGO list

A private wishlist for LEGO City and Speed Champions sets. Children pick sets from photos, a parent publishes the list, and relatives reserve gifts from a shared link so nothing gets bought twice.

## Pages

- `?kids=KEY`: choose up to 10 sets each and star favourites. Shows no prices or claims.
- `?family=KEY`: reserve a gift, mark it as bought, or cancel it. No sign-in.
- `?admin`: Google sign-in. Get the links, publish picks, set prices, release gifts and hide owned sets.
- `?demo&admin`: try everything with sample data, stored only in your browser.

The links are created when the admin first signs in. Their keys are never stored in this repo.

## Data

`.github/workflows/update-and-deploy.yml` runs daily and on every push:

- `data/sets.json`: recent sets in those themes from Rebrickable, plus older sets listed in `data/details.json`'s public downloads.
- `data/removed.json`: sets taken off the list, plus the MSRP limit. Gift-with-purchase sets are removed too.
- `data/details.json`: age, price, stock, pieces and photos read from LEGO.com Singapore on the date in the file. The daily job doesn't refresh it.
- `data/shops.json`: marketplace prices copied from the price-check sheet. Prices set on the admin page win, shop by shop.

Prices, MSRP and age are entered on the admin page, or imported by pasting the Prices tab of the price-check sheet.

## Set-up

1. Create a Firebase project with Firestore (production mode) and Authentication with the Anonymous and Google providers on.
2. Add `<username>.github.io` under Authentication > Settings > Authorized domains.
3. Copy `firestore.rules` into Firestore > Rules, replacing `ADMIN_EMAIL_HERE` with your Google address.
4. Put your web app settings in `js/firebase-config.js`.
5. In GitHub, set Settings > Pages > Source to GitHub Actions.

## Phone alerts

Family actions and finished lists send an ntfy notification through the Firebase function in `functions/`. It needs the Blaze plan. Deploy it from Google Cloud Shell with `git clone` of this repo, `npm install` in `functions/`, then `npx firebase-tools deploy --only functions --force`. Then use Phone alerts on the admin page. The topic is stored in `admin/notify`, never in this repo.

## Tests

```
node --test 'scripts/*.test.mjs'
node tests/e2e.mjs
```

`tests/e2e.mjs` needs Playwright and runs against the demo store, so it doesn't test `store-firebase.js` or `firestore.rules`.
