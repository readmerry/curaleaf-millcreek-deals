# PA Dispensary Deals

Reads a live PA medical dispensary menu with Puppeteer and writes every product,
with computed savings/discount/unit-price columns, to a single CSV. Choose one
of two menus each run:

1. **Curaleaf Millcreek** — every displayed product across all categories.
2. **RISE Dispensary Erie on Lake** — every category, though RISE's own site
   only ever renders one preview batch per category (see [Known limitations](#known-limitations)).

GitHub Actions supplies the Linux computer and Chrome browser. Your phone only
starts the run and downloads the finished CSV, so Termux does not need to
launch Chromium.

## First-time setup from Android

Download `pa-dispensary-deals-github.zip` into your phone's Download folder.
Open Termux and run these commands one line at a time:

```
pkg install git gh unzip -y
cd ~/storage/downloads
unzip pa-dispensary-deals-github.zip
cd pa-dispensary-deals-github
git init
git config user.name "Dispensary Deals Scraper"
git config user.email "scraper@localhost"
git add .
git commit -m "Add PA dispensary deals scraper"
gh auth login --web --git-protocol https
gh repo create curaleaf-millcreek-deals --private --source=. --remote=origin --push
```

During `gh auth login`, Termux will display a temporary code and open or tell
you to open GitHub in your normal phone browser. Enter that code and approve
GitHub CLI access. Do not paste your GitHub password or the temporary code
into the scraper.

If `~/storage/downloads` is unavailable, first run `termux-setup-storage`, tap
Allow, and then repeat the commands beginning with `cd ~/storage/downloads`.

## Run it whenever you want

1. Open the repository on GitHub.
2. Tap **Actions**.
3. Select **Check PA Dispensary Deals**.
4. Tap **Run workflow**, choose `curaleaf`, `rise`, or `both`, then tap the
   green **Run workflow** button.
5. Open the completed run and download the `deals-<site>-...` artifact.

The downloaded artifact contains `<site>-deals.csv` — every extracted
product, with the best deals sorted to the top of each category. Open it in
any spreadsheet app.

CSV columns: `site, category, subcategory, brand, title, strainType, rating,
thcPercent, cbdPercent, weight, weightGrams, price, regPrice, savings,
discountPercent, unitPrice, unitLabel, productId, url, scrapedAt`.

If the live website cannot be read, the artifact instead contains
`scrape-failure.txt` and usually `scrape-failure.png`. Those files show the
actual cloud-browser failure without crashing Termux.

Prices and inventory can change at any time. Check the store's own product
page before placing an order.

## Running locally

```
npm install
node scrape.js --site curaleaf
node scrape.js --site rise
```

Add `--headful` to watch the browser, or `--out <dir>` to change where the
CSV is written (default: `./results`). Both sites need a real Chrome —
Puppeteer's own bundled Chromium is not installed by `npm install` in this
project; point `PUPPETEER_EXECUTABLE_PATH` at a Chrome/Chromium binary if one
isn't already on your PATH.

## Why the old version broke

Curaleaf rebuilt its storefront in September 2026. A fresh browser session is
now sent through a separate `/age-gate` page with two required checkboxes and
a button labeled **"I'm over 21"** — the previous script only tried to click
a button labeled "I am over 21" and never checked the boxes, so every run
past that date landed on the age gate instead of the menu and errored out.
This version checks every checkbox on the gate and matches the button by a
looser, case-insensitive comparison so small wording changes like this don't
break it again.

## Known limitations

- **RISE category coverage is partial.** RISE's menu (`risecannabis.com`) is
  built on Jane/iHeartJane behind Cloudflare bot-detection. Each category page
  reports an authoritative "Showing N products" count, but the grid itself
  renders one server-side batch (typically 25-40 items, sorted by THC
  potency) and does **not** fetch more on scroll — confirmed by watching the
  network panel through repeated scrolling in a real, non-headless Chrome:
  no further request ever fires. There is no "Load more" button or numbered
  pagination on this view either. The scraper logs `N of <declared total>
  captured` for every category where the batch is incomplete, and that same
  count is exactly what a human visiting the page and scrolling down would
  see, so nothing is being silently hidden from the CSV.
- **Curaleaf coverage is complete.** Its `?page=2`, `?page=3`, ... numbered
  pagination still works, so the scraper follows it until a page comes back
  empty.
- Both sites run bot/fingerprint checks (Cloudflare on RISE, a Datadog +
  device-fingerprint stack on Curaleaf). The scraper hides the automation
  flag Chrome sets by default (`navigator.webdriver`) because leaving it set
  was observed to trigger outright 403s from RISE's backend; if either site
  changes its bot-detection further, scraping may need more changes here.
- Unit pricing (`unitPrice`, `$/g`) is only computed when a weight or total
  dose can be parsed from the product's size/pack text, and is only
  meaningful when comparing products within the same category — a $/g
  troche and a $/g flower eighth are not the same kind of gram.
