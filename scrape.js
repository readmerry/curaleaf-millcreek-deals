#!/usr/bin/env node

/**
 * Scrape a PA medical-menu dispensary site with Puppeteer and write every
 * product, with deal metrics, to a single CSV. Choose the site with
 * --site curaleaf|rise (or the SITE environment variable).
 *
 * This script never substitutes cached, hard-coded, or third-party prices for
 * what the live, JavaScript-rendered menu displays at run time.
 *
 * Setup:
 *   npm install
 *
 * Run:
 *   node scrape.js --site curaleaf
 *   node scrape.js --site rise --headful --out ./results
 *
 * Output:
 *   <out>/<site>-deals.csv
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { addDealMetrics } = require("./lib/metrics");
const { toCsv, sortForReview } = require("./lib/csv");

const SITES = {
  curaleaf: require("./sites/curaleaf"),
  rise: require("./sites/rise"),
};

function readArguments(argv) {
  const options = {
    site: process.env.SITE || null,
    out: path.resolve(process.cwd(), "results"),
    headless: true,
    maxPages: 100,
    timeout: 60_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--site") options.site = argv[++index];
    else if (argument === "--headful") options.headless = false;
    else if (argument === "--out") options.out = path.resolve(argv[++index]);
    else if (argument === "--max-pages") options.maxPages = Number(argv[++index]);
    else if (argument === "--timeout") options.timeout = Number(argv[++index]);
    else if (argument === "--help" || argument === "-h") {
      console.log(
        `Usage: node ${path.basename(__filename)} --site <curaleaf|rise> [options]\n\n` +
          "Options:\n" +
          "  --site <name>        Which menu to scrape: curaleaf or rise (required;\n" +
          "                       falls back to the SITE environment variable)\n" +
          "  --out <directory>    Output directory (default: ./results)\n" +
          "  --max-pages <count>  Safety cap for Curaleaf's numbered pagination (default: 100)\n" +
          "  --timeout <ms>       Navigation/selector timeout (default: 60000)\n" +
          "  --headful            Show the browser window\n"
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }

  if (!options.site || !SITES[options.site]) {
    throw new Error(
      `--site must be one of: ${Object.keys(SITES).join(", ")}. Run with --help for usage.`
    );
  }
  if (!Number.isFinite(options.maxPages) || options.maxPages < 1) {
    throw new Error("Invalid arguments. Run with --help for usage.");
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 1_000) {
    throw new Error("--timeout must be at least 1000 milliseconds.");
  }

  return options;
}

function printTopDeals(products) {
  const withDiscount = products
    .filter((product) => product.discountPercent != null)
    .sort((left, right) => right.discountPercent - left.discountPercent);

  const rows = withDiscount.slice(0, 20).map((product, index) => ({
    rank: index + 1,
    category: product.category || "",
    title: product.title || "",
    weight: product.weight || "",
    price: product.price == null ? "" : `$${product.price.toFixed(2)}`,
    was: product.regPrice == null ? "" : `$${product.regPrice.toFixed(2)}`,
    discount: `${product.discountPercent.toFixed(1)}%`,
    perGram: product.unitPrice == null ? "" : `$${product.unitPrice.toFixed(2)}/g`,
  }));

  console.log("\nTop deals by advertised markdown:\n");
  if (rows.length) console.table(rows);
  else console.log("No products with both a current and a regular price were found.");
}

async function saveFailureDiagnostics(page, outputDirectory, error) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const lines = [
    `Time: ${new Date().toISOString()}`,
    `Current URL: ${page ? page.url() : "browser page was not created"}`,
    "",
    String(error?.stack || error?.message || error),
    "",
  ];
  fs.writeFileSync(path.join(outputDirectory, "scrape-failure.txt"), lines.join("\n"));

  if (page) {
    try {
      await page.screenshot({
        path: path.join(outputDirectory, "scrape-failure.png"),
        fullPage: true,
      });
    } catch (screenshotError) {
      fs.appendFileSync(
        path.join(outputDirectory, "scrape-failure.txt"),
        `Screenshot failed: ${screenshotError.message}\n`
      );
    }
  }
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const site = SITES[options.site];
  console.log(`Scraping ${site.STORE_LABEL} (${options.site})`);

  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: options.headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  let page;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(options.timeout);
    page.setDefaultNavigationTimeout(options.timeout);
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setCacheEnabled(false);
    const browserUserAgent = await browser.userAgent();
    await page.setUserAgent(browserUserAgent.replace(/HeadlessChrome/g, "Chrome"));
    // Both storefronts run bot-detection (Cloudflare/Jane device fingerprinting)
    // that keys partly off the automation flag Puppeteer sets by default.
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const rawProducts = await site.scrape(page, {
      timeout: options.timeout,
      maxPages: options.maxPages,
      log: (message) => console.log(message),
    });

    if (!rawProducts.length) {
      throw new Error("No products were extracted. The storefront markup may have changed.");
    }

    const pricedProducts = rawProducts.filter((product) => product.price != null);
    const priceCoverage = pricedProducts.length / rawProducts.length;
    if (!pricedProducts.length || priceCoverage < 0.5) {
      throw new Error(
        `Only ${pricedProducts.length} of ${rawProducts.length} live cards contained prices. ` +
          "The report was not written because incomplete prices could produce a false ranking."
      );
    }

    const products = sortForReview(rawProducts.map(addDealMetrics));

    fs.mkdirSync(options.out, { recursive: true });
    const csvPath = path.join(options.out, `${options.site}-deals.csv`);
    fs.writeFileSync(csvPath, toCsv(products));

    printTopDeals(products);
    console.log(`\nSaved ${products.length} products to ${csvPath}`);
  } catch (error) {
    await saveFailureDiagnostics(page, options.out, error);
    throw error;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Scrape failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { readArguments };
