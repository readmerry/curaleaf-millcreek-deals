# Curaleaf Millcreek live-deal checker

This project reads the live Curaleaf Millcreek, Pennsylvania menu with
Puppeteer, extracts every displayed product and ranks advertised markdowns,
whole flower and ground flower. The store URL is fixed inside the script.

GitHub Actions supplies the Linux computer and Chrome browser. Your Android
phone only starts the run and downloads the finished reports, so Termux does
not need to launch Chromium.

## First-time setup from Android

1. Download `curaleaf-millcreek-github.zip` into your phone's Download folder.
2. Open Termux and run these commands one line at a time:

```bash
pkg install git gh unzip -y
cd ~/storage/downloads
unzip curaleaf-millcreek-github.zip
cd curaleaf-millcreek-github
git init
git config user.name "Curaleaf Scraper"
git config user.email "scraper@localhost"
git add .
git commit -m "Add Curaleaf Millcreek live-deal checker"
gh auth login --web --git-protocol https
gh repo create curaleaf-millcreek-deals --private --source=. --remote=origin --push
```

During `gh auth login`, Termux will display a temporary code and open or tell
you to open GitHub in your normal phone browser. Enter that code and approve
GitHub CLI access. Do not paste your GitHub password or the temporary code into
the scraper.

If `~/storage/downloads` is unavailable, first run `termux-setup-storage`, tap
**Allow**, and then repeat the commands beginning with `cd ~/storage/downloads`.

## Run it whenever you want

1. Open the `curaleaf-millcreek-deals` repository on GitHub.
2. Tap **Actions**.
3. Select **Check Curaleaf Millcreek Deals**.
4. Tap **Run workflow**, then tap the green **Run workflow** button.
5. Open the completed run and download the `curaleaf-results-...` artifact.

The downloaded artifact contains:

- `curaleaf-products.json` — every extracted product.
- `curaleaf-products.csv` — spreadsheet-friendly complete results.
- `curaleaf-best-deals.json` — largest advertised discounts and unit values.
- `curaleaf-flower-deals.json` — ground and whole flower ranked separately.

If the live website cannot be read, the artifact instead contains
`scrape-failure.txt` and usually `scrape-failure.png`. Those files show the
actual cloud-browser failure without crashing Termux.

Prices and inventory can change at any time. Check the Curaleaf product page
before placing an order.
