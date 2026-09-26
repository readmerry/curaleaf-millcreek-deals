"use strict";

/**
 * Curaleaf Millcreek, PA. Since the 2026-09 storefront refresh, a fresh
 * browser context is sent through /age-gate (two checkboxes + an "I'm over
 * 21" button) before it can reach the menu, and a "New Shopping Experience"
 * sign-in modal is layered on top of the first product grid. Neither blocks
 * DOM extraction once dismissed, but the age-gate's returnurl does not always
 * preserve deep links, so we re-navigate to the intended page afterward.
 */

const { sleep, clickIfPresent, clickAllCheckboxes, scrollUntilStable } = require("../lib/browser");

const SITE = "curaleaf";
const STORE_LABEL = "Curaleaf Millcreek, PA";
const MILLCREEK_URL = "https://curaleaf.com/shop/pennsylvania/curaleaf-pa-millcreek/menu";
const CARD_SELECTOR = "a[id^='product-']";

function pageUrl(pageNumber) {
  const url = new URL(MILLCREEK_URL);
  if (pageNumber === 1) url.searchParams.delete("page");
  else url.searchParams.set("page", String(pageNumber));
  return url.toString();
}

async function ensureAccess(page, targetUrl, timeout) {
  await sleep(500);

  if (/\/age-gate/i.test(page.url())) {
    await clickAllCheckboxes(page);
    await sleep(400);
    const clicked = await clickIfPresent(page, [
      "i'm over 21",
      "i am over 21",
      "yes, i am 21+",
      "enter site",
    ]);
    if (clicked) {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout }).catch(() => {});
    }
    if (!page.url().includes(new URL(targetUrl).pathname)) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout });
      await sleep(500);
    }
  }

  // Cookie banner and the "New Shopping Experience" sign-in nag are cosmetic
  // overlays; harmless no-ops when absent, but dismissed for clean screenshots
  // and so they cannot intercept clicks on later runs.
  await clickIfPresent(page, ["accept cookies", "accept all cookies", "allow all"]);
  await sleep(300);
  await clickIfPresent(page, ["close"]);
}

function extractPage(page) {
  return page.evaluate(() => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const money = (value) => {
      const match = clean(value).match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
      return match ? Number(match[1].replace(/,/g, "")) : null;
    };
    const percent = (value) => {
      const match = clean(value).match(/(\d+(?:\.\d+)?)\s*%/);
      return match ? Number(match[1]) : null;
    };

    return [...document.querySelectorAll("a[id^='product-']")].map((card) => {
      const ariaLabel = clean(
        card.getAttribute("aria-label") || card.getAttribute("ariaLabel")
      );
      const title =
        clean(card.querySelector("h2")?.textContent) || clean(ariaLabel.split(",")[0]);
      const subtitle = clean(
        [...card.querySelectorAll("div, span")]
          .find(
            (node) => /\sby\s/i.test(clean(node.textContent)) && node.children.length === 0
          )
          ?.textContent
      );
      const category = subtitle.match(/^(.+?)\s+by\s+/i)?.[1] || null;
      const brand = subtitle.match(/\s+by\s+(.+)$/i)?.[1] || null;

      const strainType =
        clean(
          [...card.querySelectorAll("div")]
            .find(
              (node) =>
                node.children.length === 0 &&
                /^(hybrid|indica|sativa)$/i.test(clean(node.textContent))
            )
            ?.textContent
        ) || null;

      const cannabinoidSpans = [...card.querySelectorAll("span")].filter((node) =>
        /^(THC|CBD):/i.test(clean(node.textContent))
      );
      const thcText = cannabinoidSpans.find((node) => /^THC:/i.test(clean(node.textContent)))
        ?.textContent;
      const cbdText = cannabinoidSpans.find((node) => /^CBD:/i.test(clean(node.textContent)))
        ?.textContent;

      const amountNodes = [...card.querySelectorAll("[role='checkbox']")];
      const amountOptions = amountNodes.map((node) => clean(node.textContent)).filter(Boolean);
      const selectedAmount =
        clean(
          amountNodes.find((node) => node.getAttribute("aria-checked") === "true")?.textContent
        ) ||
        amountOptions[0] ||
        null;

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
        return (
          node.children.length === 0 &&
          !/^previous price/i.test(label) &&
          /^(?:from\s+)?\$\s*[\d,]+(?:\.\d{1,2})?$/i.test(clean(node.textContent))
        );
      });
      const priceLeaf =
        priceLeaves.find((node) => {
          const value = money(node.textContent);
          return value != null && (previousPrice == null || value !== previousPrice);
        }) || priceLeaves[0];
      const price =
        money(explicitCurrentPriceNode?.textContent) ?? money(ariaPrice) ?? money(priceLeaf?.textContent);

      return {
        productId: card.id.replace(/^product-/, "") || null,
        category,
        subcategory: null,
        brand,
        title,
        strainType,
        rating: null,
        thcPercent: percent(thcText),
        cbdPercent: percent(cbdText),
        weight: selectedAmount,
        price,
        regPrice: previousPrice,
        url: new URL(card.getAttribute("href"), location.href).href,
      };
    });
  });
}

async function scrape(page, { timeout, maxPages, log }) {
  const collected = new Map();

  for (let number = 1; number <= maxPages; number += 1) {
    const url = pageUrl(number);
    log(`Curaleaf: page ${number} (${url})`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await ensureAccess(page, url, timeout);

    if (!page.url().includes("/curaleaf-pa-millcreek/menu")) {
      throw new Error(`Unexpected redirect away from Curaleaf Millcreek: ${page.url()}`);
    }

    try {
      await page.waitForSelector(CARD_SELECTOR, {
        visible: true,
        timeout: number === 1 ? timeout : 15_000,
      });
    } catch (error) {
      if (number === 1) throw error;
      log(`  No product cards on page ${number}; reached the end of the menu.`);
      break;
    }

    await scrollUntilStable(page, { cardSelector: CARD_SELECTOR, maxPasses: 40, waitMs: 900 });
    const pageProducts = await extractPage(page);

    let newProducts = 0;
    for (const product of pageProducts) {
      const key = `${product.productId || product.url}|${product.weight || ""}`;
      if (!collected.has(key)) newProducts += 1;
      collected.set(key, product);
    }
    log(`  Found ${pageProducts.length} cards (${newProducts} new).`);
    if (pageProducts.length === 0 || newProducts === 0) break;
  }

  const scrapedAt = new Date().toISOString();
  return [...collected.values()].map((product) => ({ ...product, site: SITE, scrapedAt }));
}

module.exports = { scrape, SITE, STORE_LABEL, BASE_URL: MILLCREEK_URL };
