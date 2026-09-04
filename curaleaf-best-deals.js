#!/usr/bin/env node

/**
 * Scrape Curaleaf's live Millcreek menu with Puppeteer and rank its deals.
 *
 * The store URL is intentionally fixed. This script never substitutes cached,
 * hard-coded, search-engine, or third-party prices for the prices displayed on
 * Curaleaf's JavaScript-rendered product cards at run time.
 *
 * Setup:
 *   npm install puppeteer
 *
 * Run:
 *   node curaleaf-best-deals.js
 *   node curaleaf-best-deals.js --headful --out ./results
 *
 * Outputs:
 *   <out>/curaleaf-products.json
 *   <out>/curaleaf-products.csv
 *   <out>/curaleaf-best-deals.json
 *   <out>/curaleaf-flower-deals.json
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MILLCREEK_URL =
  "https://curaleaf.com/shop/pennsylvania/curaleaf-pa-millcreek/menu";
const SCRAPER_VERSION = "2026-09-04-github-actions";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function readArguments(argv) {
  const options = {
    out: path.resolve(process.cwd(), "curaleaf-results"),
    headless: true,
    maxPages: 100,
    timeout: 60_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--headful") options.headless = false;
    else if (argument === "--out") options.out = path.resolve(argv[++index]);
    else if (argument === "--max-pages") options.maxPages = Number(argv[++index]);
    else if (argument === "--timeout") options.timeout = Number(argv[++index]);
    else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: node ${path.basename(__filename)} [options]\n\n` +
        "Options:\n" +
        "  --out <directory>    Output directory (default: ./curaleaf-results)\n" +
        "  --max-pages <count>  Safety cap for pagination (default: 100)\n" +
        "  --timeout <ms>       Navigation/selector timeout (default: 60000)\n" +
        "  --headful            Show the browser window\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }

  if (!Number.isFinite(options.maxPages) || options.maxPages < 1) {
    throw new Error("Invalid arguments. Run with --help for usage.");
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 1_000) {
    throw new Error("--timeout must be at least 1000 milliseconds.");
  }

  return options;
}

function pageUrl(pageNumber) {
  const url = new URL(MILLCREEK_URL);
  if (pageNumber === 1) url.searchParams.delete("page");
  else url.searchParams.set("page", String(pageNumber));
  return url.toString();
}

function parseAmount(amountText, title) {
  // Prefer the selected package amount. Falling back to the title is useful for
  // cards where the amount control is not rendered as a checkbox.
  const source = `${amountText || ""} ${title || ""}`;
  const perPiecePackage = source.match(
    /(\d+(?:\.\d+)?)\s*(mg|g)\s*(?:ea\.?|each).*?(\d+)\s*[- ]?pack\b/i
  );
  if (perPiecePackage) {
    const each = Number(perPiecePackage[1]);
    const count = Number(perPiecePackage[3]);
    const unit = perPiecePackage[2].toLowerCase();
    return {
      amountValue: each * count,
      amountUnit: unit,
      normalizedAmount: each * count,
      normalizedUnit: unit,
    };
  }

  const multipliedPackage = source.match(
    /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mg|g)\b/i
  );
  if (multipliedPackage) {
    const count = Number(multipliedPackage[1]);
    const each = Number(multipliedPackage[2]);
    const unit = multipliedPackage[3].toLowerCase();
    return {
      amountValue: each * count,
      amountUnit: unit,
      normalizedAmount: each * count,
      normalizedUnit: unit,
    };
  }

  const match = source.match(/(?:^|\s|\|)(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|oz)\b/i);
  if (!match) return { amountValue: null, amountUnit: null, normalizedAmount: null };

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  let normalizedAmount = value;
  let normalizedUnit = unit;

  if (unit === "kg") {
    normalizedAmount = value * 1_000;
    normalizedUnit = "g";
  } else if (unit === "oz") {
    normalizedAmount = value * 28.3495;
    normalizedUnit = "g";
  }

  return {
    amountValue: value,
    amountUnit: unit,
    normalizedAmount,
    normalizedUnit,
  };
}

function classifyFlower(product) {
  const text = `${product.category || ""} ${product.title || ""}`.toLowerCase();
  if (!/(flower|buds|ground|shake)/.test(text)) return null;
  if (/(ground|shake|pre-ground|preground)/.test(text)) return "ground";
  return "whole";
}

function addDealMetrics(product) {
  const savings =
    product.price != null &&
    product.previousPrice != null &&
    product.previousPrice > product.price
      ? product.previousPrice - product.price
      : null;
  const discountPercent =
    savings != null ? (savings / product.previousPrice) * 100 : null;
  const amount = parseAmount(product.selectedAmount, product.title);
  const unitPrice =
    amount.normalizedAmount && product.price != null
      ? product.price / amount.normalizedAmount
      : null;

  return {
    ...product,
    ...amount,
    flowerType: classifyFlower(product),
    savings: savings == null ? null : Number(savings.toFixed(2)),
    discountPercent:
      discountPercent == null ? null : Number(discountPercent.toFixed(2)),
    unitPrice: unitPrice == null ? null : Number(unitPrice.toFixed(4)),
  };
}

async function clickIfPresent(page, labels) {
  return page.evaluate((wantedLabels) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const wanted = wantedLabels.map(normalize);
    const element = [...document.querySelectorAll("button, [role='button']")].find(
      (candidate) => {
        const label = normalize(
          candidate.getAttribute("aria-label") || candidate.textContent || ""
        );
        const visible = Boolean(candidate.offsetWidth || candidate.offsetHeight);
        return visible && wanted.includes(label);
      }
    );
    if (!element) return false;
    element.click();
    return true;
  }, labels);
}

async function dismissOverlays(page) {
  // These are harmless no-ops when an age/cookie prompt is absent.
  const labelGroups = [
    ["Accept All Cookies", "Accept Cookies", "Allow All"],
    ["I am 21 or older", "I am over 21", "Enter Site", "Yes, I am 21+"],
  ];

  for (const labels of labelGroups) {
    try {
      if (await clickIfPresent(page, labels)) await sleep(500);
    } catch {
      // Cross-origin or transient overlays should not abort the scrape.
    }
  }
}

async function exhaustDynamicProducts(page) {
  let stablePasses = 0;
  let previousCount = 0;

  // Supports either infinite scrolling or a "Load more" implementation. The
  // current storefront also exposes numbered pages, handled by the outer loop.
  for (let pass = 0; pass < 40 && stablePasses < 3; pass += 1) {
    const clicked = await clickIfPresent(page, ["Load more", "Show more products"]);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(clicked ? 1_500 : 800);

    const count = await page.$$eval("a[id^='product-']", (cards) => cards.length);
    if (count === previousCount && !clicked) stablePasses += 1;
    else stablePasses = 0;
    previousCount = count;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
}

async function extractPage(page, pageNumber) {
  return page.evaluate((scrapedPage) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const money = (value) => {
      const match = clean(value).match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
      return match ? Number(match[1].replace(/,/g, "")) : null;
    };

    return [...document.querySelectorAll("a[id^='product-']")].map((card) => {
      const ariaLabel = clean(
        card.getAttribute("aria-label") || card.getAttribute("ariaLabel")
      );
      const title = clean(card.querySelector("h2")?.textContent) ||
        clean(ariaLabel.split(",")[0]);
      const subtitle = clean(
        [...card.querySelectorAll("div, span")]
          .find((node) => /\sby\s/i.test(clean(node.textContent)) && node.children.length === 0)
          ?.textContent
      );
      const category = subtitle.match(/^(.+?)\s+by\s+/i)?.[1] || null;
      const brand = subtitle.match(/\s+by\s+(.+)$/i)?.[1] || null;
      const amountNodes = [...card.querySelectorAll("[role='checkbox']")];
      const amountOptions = amountNodes.map((node) => clean(node.textContent)).filter(Boolean);
      const selectedAmount = clean(
        amountNodes.find((node) => node.getAttribute("aria-checked") === "true")?.textContent
      ) || amountOptions[0] || null;
      const previousPriceNode = card.querySelector(
        "[aria-label='Previous price'], [aria-label^='Previous price' i]"
      );
      const previousPrice = money(previousPriceNode?.textContent);
      const explicitCurrentPriceNode = card.querySelector(
        "[aria-label='Current price'], [aria-label^='Current price' i], " +
        "[data-testid*='current-price' i]"
      );
      const ariaPrice = ariaLabel.match(/-\s*(\$[\d,]+(?:\.\d{1,2})?)\s*$/)?.[1];
      const priceLeaves = [...card.querySelectorAll("span, div")].filter((node) => {
        const label = node.getAttribute("aria-label") || "";
        return node.children.length === 0 &&
          !/^previous price/i.test(label) &&
          /^(?:from\s+)?\$\s*[\d,]+(?:\.\d{1,2})?$/i.test(clean(node.textContent));
      });
      const priceLeaf = priceLeaves.find((node) => {
        const value = money(node.textContent);
        return value != null && (previousPrice == null || value !== previousPrice);
      }) || priceLeaves[0];
      const price = money(explicitCurrentPriceNode?.textContent) ??
        money(ariaPrice) ?? money(priceLeaf?.textContent);
      const priceSource = explicitCurrentPriceNode
        ? "current-price element"
        : ariaPrice
          ? "product aria-label"
          : priceLeaf
            ? "visible price text"
            : null;
      const dealText = clean(
        [...card.querySelectorAll("div")]
          .find((node) =>
            node.children.length === 0 &&
            /(off|save|only\s+\$|savings)/i.test(clean(node.textContent))
          )?.textContent
      ) || null;

      return {
        productId: card.id.replace(/^product-/, "") || null,
        title,
        category,
        brand,
        price,
        priceSource,
        previousPrice,
        selectedAmount,
        amountOptions,
        dealText,
        url: new URL(card.getAttribute("href"), location.href).href,
        scrapedPage,
      };
    });
  }, pageNumber);
}

function csvCell(value) {
  const text = Array.isArray(value)
    ? value.join(" | ")
    : value == null
      ? ""
      : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(products) {
  const columns = [
    "productId", "title", "category", "brand", "price", "previousPrice",
    "savings", "discountPercent", "selectedAmount", "amountOptions",
    "unitPrice", "normalizedUnit", "flowerType", "priceSource", "dealText",
    "url", "scrapedPage",
  ];
  return [
    columns.map(csvCell).join(","),
    ...products.map((product) =>
      columns.map((column) => csvCell(product[column])).join(",")
    ),
  ].join("\n") + "\n";
}

function rankDeals(products) {
  const biggestDiscounts = products
    .filter((product) => product.discountPercent != null)
    .sort((left, right) =>
      right.discountPercent - left.discountPercent ||
      (left.unitPrice ?? Infinity) - (right.unitPrice ?? Infinity)
    );

  // Unit prices are only comparable within a category and normalized unit.
  const bestUnitValue = products
    .filter((product) => product.unitPrice != null && product.normalizedUnit)
    .sort((left, right) =>
      `${left.category}|${left.normalizedUnit}`.localeCompare(
        `${right.category}|${right.normalizedUnit}`
      ) || left.unitPrice - right.unitPrice
    );

  const flowerByUnitPrice = (type) => products
    .filter((product) =>
      product.flowerType === type &&
      product.normalizedUnit === "g" &&
      product.unitPrice != null
    )
    .sort((left, right) =>
      left.unitPrice - right.unitPrice ||
      (right.discountPercent ?? -1) - (left.discountPercent ?? -1)
    );

  return {
    biggestDiscounts,
    bestUnitValue,
    groundFlower: flowerByUnitPrice("ground"),
    wholeFlower: flowerByUnitPrice("whole"),
  };
}

function printTopDeals(deals) {
  const rows = deals.biggestDiscounts.slice(0, 20).map((product, index) => ({
    rank: index + 1,
    title: product.title,
    amount: product.selectedAmount || "",
    price: `$${product.price.toFixed(2)}`,
    was: `$${product.previousPrice.toFixed(2)}`,
    discount: `${product.discountPercent.toFixed(1)}%`,
    perUnit: product.unitPrice == null
      ? ""
      : `$${product.unitPrice.toFixed(2)}/${product.normalizedUnit}`,
  }));

  console.log("\nTop deals by advertised markdown:\n");
  if (rows.length) console.table(rows);
  else console.log("No products with both a current and previous price were found.");

  for (const [label, products] of [
    ["Ground flower", deals.groundFlower],
    ["Whole flower", deals.wholeFlower],
  ]) {
    const flowerRows = products.slice(0, 15).map((product, index) => ({
      rank: index + 1,
      title: product.title,
      amount: product.selectedAmount || "",
      price: `$${product.price.toFixed(2)}`,
      discount: product.discountPercent == null
        ? ""
        : `${product.discountPercent.toFixed(1)}%`,
      perGram: `$${product.unitPrice.toFixed(2)}/g`,
    }));
    console.log(`\nBest ${label.toLowerCase()} by live price per gram:\n`);
    if (flowerRows.length) console.table(flowerRows);
    else console.log(`No priced ${label.toLowerCase()} cards were found.`);
  }
}

async function navigateToLiveMenu(page, url, timeout) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });
    } catch (error) {
      lastError = error;
      if (!/net::ERR_ABORTED/i.test(error.message || "")) throw error;

      // Curaleaf sometimes replaces its initial document during client-side
      // routing. If the browser reached the correct menu, the product-card
      // wait in main() remains the authoritative readiness check.
      await sleep(3_000);
      if (page.url().includes("/curaleaf-pa-millcreek/menu")) {
        console.warn(
          "  Chromium replaced the initial navigation; continuing to wait for live product cards."
        );
        return null;
      }

      console.warn(
        `  Navigation attempt ${attempt} was aborted at ${page.url()}; retrying.`
      );
      await dismissOverlays(page);
      if (attempt < 3) await sleep(1_500);
    }
  }

  throw lastError;
}

async function saveFailureDiagnostics(page, outputDirectory, error) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const lines = [
    `Scraper version: ${SCRAPER_VERSION}`,
    `Time: ${new Date().toISOString()}`,
    `Current URL: ${page ? page.url() : "browser page was not created"}`,
    "",
    String(error?.stack || error?.message || error),
    "",
  ];
  fs.writeFileSync(
    path.join(outputDirectory, "scrape-failure.txt"),
    lines.join("\n")
  );

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
  console.log(`Curaleaf Millcreek scraper ${SCRAPER_VERSION}`);
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
    await page.setExtraHTTPHeaders({
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    });
    const browserUserAgent = await browser.userAgent();
    await page.setUserAgent(browserUserAgent.replace(/HeadlessChrome/g, "Chrome"));

    const collected = new Map();

    for (let number = 1; number <= options.maxPages; number += 1) {
      const url = pageUrl(number);
      console.log(`Scraping page ${number}: ${url}`);
      const response = await navigateToLiveMenu(page, url, options.timeout);
      if (response && !response.ok()) {
        throw new Error(`Curaleaf returned HTTP ${response.status()} on page ${number}.`);
      }
      if (!page.url().includes("/curaleaf-pa-millcreek/menu")) {
        throw new Error(`Unexpected redirect away from Curaleaf Millcreek: ${page.url()}`);
      }

      // Explicitly wait for the client-rendered product cards. networkidle2 can
      // be delayed by analytics, so it is treated as a best-effort extra wait.
      await dismissOverlays(page);
      await page.waitForSelector("a[id^='product-']", { visible: true });
      try {
        await page.waitForNetworkIdle({ idleTime: 750, timeout: 10_000 });
      } catch {
        // The product selector above is the authoritative readiness condition.
      }

      if (number === 1) {
        try {
          await page.waitForFunction(
            () => [...document.querySelectorAll("a[id^='product-']")]
              .some((card) => /\$\s*[\d,]+(?:\.\d{1,2})?/.test(card.textContent || "")),
            { timeout: 15_000 }
          );
        } catch {
          throw new Error(
            "The live product cards loaded, but Curaleaf did not display any prices. " +
            "Try running with --headful; the script will not substitute cached prices."
          );
        }
      }

      await exhaustDynamicProducts(page);
      const pageProducts = await extractPage(page, number);
      let newProducts = 0;

      for (const product of pageProducts) {
        const key = `${product.productId || product.url.split("?")[0]}|${product.selectedAmount || ""}`;
        if (!collected.has(key)) newProducts += 1;
        collected.set(key, product);
      }

      console.log(`  Found ${pageProducts.length} cards (${newProducts} new).`);
      // Keep trying numbered pages until Curaleaf returns an empty page or the
      // same products again. This also works if the storefront omits rel=next.
      if (pageProducts.length === 0 || newProducts === 0) break;
    }

    const products = [...collected.values()].map(addDealMetrics);
    if (!products.length) {
      throw new Error("No product cards were extracted. The storefront markup may have changed.");
    }
    const pricedProducts = products.filter((product) => product.price != null);
    const priceCoverage = pricedProducts.length / products.length;
    if (!pricedProducts.length || priceCoverage < 0.5) {
      throw new Error(
        `Only ${pricedProducts.length} of ${products.length} live cards contained prices. ` +
        "The report was not written because incomplete prices could produce a false ranking."
      );
    }

    const deals = rankDeals(products);
    const scrapedAt = new Date().toISOString();
    const report = {
      store: "Curaleaf Millcreek, Pennsylvania",
      source: MILLCREEK_URL,
      scrapedAt,
      productCount: products.length,
      pricedProductCount: pricedProducts.length,
      livePriceCoveragePercent: Number((priceCoverage * 100).toFixed(2)),
      rankingNotes: {
        biggestDiscounts: "Current price compared with displayed previous price.",
        bestUnitValue: "Price per normalized weight/volume, comparable only within category and unit.",
        flower: "Ground and whole flower are ranked separately by displayed price per gram.",
      },
      biggestDiscounts: deals.biggestDiscounts,
      bestUnitValue: deals.bestUnitValue,
    };
    const flowerReport = {
      store: "Curaleaf Millcreek, Pennsylvania",
      source: MILLCREEK_URL,
      scrapedAt,
      groundFlower: deals.groundFlower,
      wholeFlower: deals.wholeFlower,
    };

    fs.mkdirSync(options.out, { recursive: true });
    fs.writeFileSync(
      path.join(options.out, "curaleaf-products.json"),
      JSON.stringify(products, null, 2) + "\n"
    );
    fs.writeFileSync(
      path.join(options.out, "curaleaf-products.csv"),
      toCsv(products)
    );
    fs.writeFileSync(
      path.join(options.out, "curaleaf-best-deals.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
    fs.writeFileSync(
      path.join(options.out, "curaleaf-flower-deals.json"),
      JSON.stringify(flowerReport, null, 2) + "\n"
    );

    printTopDeals(deals);
    console.log(`\nSaved ${products.length} products to ${options.out}`);
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

module.exports = {
  MILLCREEK_URL,
  SCRAPER_VERSION,
  addDealMetrics,
  classifyFlower,
  pageUrl,
  parseAmount,
  rankDeals,
  saveFailureDiagnostics,
  toCsv,
};
