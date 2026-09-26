"use strict";

/**
 * RISE Dispensary Erie on Lake, PA (risecannabis.com, a Jane/iHeartJane-backed
 * Next.js storefront). The homepage's "All Products" grid caps out well short
 * of the full catalog, so each shelf category is scraped from its own
 * refinementList URL (the same links the site's own nav bar uses), where the
 * page reports an authoritative "Showing N products" total we can check
 * extraction against.
 */

const { sleep, clickIfPresent, scrollUntilStable } = require("../lib/browser");

const SITE = "rise";
const STORE_LABEL = "RISE Dispensary Erie on Lake, PA";
const BASE_URL =
  "https://risecannabis.com/dispensaries/pennsylvania/erie-lake/392/medical-menu/";
const CARD_SELECTOR = 'article[data-testid^="product-card-"]';

const CATEGORIES = [
  { category: "Flower", param: "root_types", value: "flower" },
  { category: "Vape", param: "root_types", value: "vape" },
  { category: "Consumable", param: "root_types", value: "edible" },
  { category: "Concentrate", param: "root_types", value: "extract" },
  { category: "Tinctures", param: "root_types", value: "tincture" },
  { category: "Topicals", param: "root_types", value: "topical" },
  { category: "CBD", param: "category", value: "cbd" },
  { category: "Gear", param: "root_types", value: "gear" },
];

function categoryUrl(entry) {
  return `${BASE_URL}?refinementList[${entry.param}][]=${entry.value}&currentSort=thc-potency-desc`;
}

async function ensureAccess(page) {
  await sleep(800);
  // "ARE YOU OVER 21 YEARS OLD?" gate, shown as an overlay on first visit.
  await clickIfPresent(page, ["yes"]);
  await sleep(500);
  // "Store is closed for pickup" and similar dismissible notices.
  await clickIfPresent(page, ["continue shopping", "close"]);
  await sleep(300);
  await clickIfPresent(page, ["accept all cookies", "accept cookies", "i accept", "allow all"]);
}

async function declaredTotal(page) {
  return page.evaluate(() => {
    const match = document.body.innerText.match(/Showing\s+([\d,]+)\s+products?/i);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  });
}

function extractCards(page, category) {
  return page.evaluate((categoryLabel) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const money = (value) => {
      const match = clean(value).match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
      return match ? Number(match[1].replace(/,/g, "")) : null;
    };

    return [...document.querySelectorAll('article[data-testid^="product-card-"]')].map(
      (card) => {
        const id = card.getAttribute("data-testid").replace(/^product-card-/, "");
        const field = (suffix) =>
          clean(card.querySelector(`[data-testid="product-card-${suffix}-${id}"]`)?.textContent);

        const potencyText = field("potency");
        const thcMatch = potencyText.match(/THC\s*(\d+(?:\.\d+)?)\s*%/i);
        const cbdMatch = potencyText.match(/CBD\s*(\d+(?:\.\d+)?)\s*%/i);

        const radiogroup = card.querySelector('[role="radiogroup"]');
        const checkedInput = radiogroup?.querySelector("input:checked");
        const firstLabel = radiogroup?.querySelector("label");
        const weight =
          clean((checkedInput?.closest("label") || firstLabel)?.textContent) || null;

        const link = card.querySelector('a[href*="/medical-menu/product/"]');

        return {
          productId: id,
          category: categoryLabel,
          subcategory: field("type") || null,
          brand: field("brand") || null,
          title: field("name") || null,
          strainType: field("lineage-badge") || null,
          rating: field("rating") || null,
          thcPercent: thcMatch ? Number(thcMatch[1]) : null,
          cbdPercent: cbdMatch ? Number(cbdMatch[1]) : null,
          weight,
          price: money(field("price")),
          regPrice: money(field("original-price")),
          url: link ? link.href : null,
        };
      }
    );
  }, category);
}

async function scrapeCategory(page, entry, { timeout, log }) {
  const url = categoryUrl(entry);
  log(`RISE: ${entry.category} (${url})`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await ensureAccess(page);

  try {
    await page.waitForSelector(CARD_SELECTOR, { visible: true, timeout });
  } catch {
    log(`  No product cards found for ${entry.category}; skipping.`);
    return [];
  }

  const total = await declaredTotal(page);
  // RISE's category view renders one preview batch server-side and does not
  // fetch more on scroll (confirmed: no follow-up network request fires no
  // matter how much or how long you scroll). The loop below is cheap
  // insurance in case that ever changes; it will not find more today.
  await scrollUntilStable(page, {
    cardSelector: CARD_SELECTOR,
    maxPasses: 5,
    stablePassesNeeded: 2,
    waitMs: 1000,
  });

  const products = await extractCards(page, entry.category);
  if (total != null && products.length < total) {
    log(
      `  ${products.length} of ${total} declared ${entry.category} products captured ` +
        "(RISE only renders one preview batch per category; see README)."
    );
  } else {
    log(`  Found ${products.length} products${total != null ? ` of ${total} declared` : ""}.`);
  }
  return products;
}

async function scrape(page, { timeout, log }) {
  const collected = new Map();

  for (const entry of CATEGORIES) {
    const products = await scrapeCategory(page, entry, { timeout, log });
    for (const product of products) {
      const key = `${product.category}|${product.productId}|${product.weight || ""}`;
      collected.set(key, product);
    }
  }

  const scrapedAt = new Date().toISOString();
  return [...collected.values()].map((product) => ({ ...product, site: SITE, scrapedAt }));
}

module.exports = { scrape, SITE, STORE_LABEL, BASE_URL, CATEGORIES };
