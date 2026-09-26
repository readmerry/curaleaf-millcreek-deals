"use strict";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// Clicks the first visible button/link/checkbox whose text or aria-label
// matches one of `labels` (case-insensitive, whitespace-normalized).
async function clickIfPresent(page, labels) {
  return page.evaluate((wantedLabels) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const wanted = wantedLabels.map(normalize);
    const candidates = [
      ...document.querySelectorAll("button, a, [role='button'], [role='checkbox']"),
    ];
    const element = candidates.find((candidate) => {
      const label = normalize(
        candidate.getAttribute("aria-label") || candidate.textContent || ""
      );
      const visible = Boolean(candidate.offsetWidth || candidate.offsetHeight);
      return visible && wanted.some((want) => label === want || label.includes(want));
    });
    if (!element) return false;
    element.click();
    return true;
  }, labels);
}

async function clickAllCheckboxes(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll("[role='checkbox'], input[type='checkbox']")];
    let clicked = 0;
    for (const box of boxes) {
      const checked =
        box.getAttribute("aria-checked") === "true" || box.checked === true;
      const visible = Boolean(box.offsetWidth || box.offsetHeight);
      if (!checked && visible) {
        box.click();
        clicked += 1;
      }
    }
    return clicked;
  });
}

// Repeatedly scrolls to the bottom of the page (or a container) and waits for
// new cards to mount, until the matched-selector count is stable for a few
// passes or the pass ceiling is hit. Returns the final count.
async function scrollUntilStable(page, { cardSelector, maxPasses = 40, stablePassesNeeded = 3, waitMs = 1200 }) {
  let previousCount = 0;
  let stablePasses = 0;

  for (let pass = 0; pass < maxPasses && stablePasses < stablePassesNeeded; pass += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(waitMs);
    const count = await page.$$eval(cardSelector, (nodes) => nodes.length);
    if (count === previousCount) stablePasses += 1;
    else stablePasses = 0;
    previousCount = count;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  return previousCount;
}

module.exports = { sleep, clickIfPresent, clickAllCheckboxes, scrollUntilStable };
