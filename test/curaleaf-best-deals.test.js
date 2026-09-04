"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MILLCREEK_URL,
  addDealMetrics,
  classifyFlower,
  pageUrl,
  parseAmount,
  rankDeals,
} = require("../curaleaf-best-deals.js");

test("store URL is permanently fixed to Millcreek", () => {
  assert.equal(
    MILLCREEK_URL,
    "https://curaleaf.com/shop/pennsylvania/curaleaf-pa-millcreek/menu"
  );
  assert.equal(pageUrl(1), MILLCREEK_URL);
  assert.equal(pageUrl(3), `${MILLCREEK_URL}?page=3`);
});

test("parses ordinary flower weights", () => {
  assert.deepEqual(parseAmount("3.5g", "Example Flower"), {
    amountValue: 3.5,
    amountUnit: "g",
    normalizedAmount: 3.5,
    normalizedUnit: "g",
  });
});

test("parses dose-per-piece packages", () => {
  assert.deepEqual(parseAmount("10mg each 10-pack", "Mango Troches"), {
    amountValue: 100,
    amountUnit: "mg",
    normalizedAmount: 100,
    normalizedUnit: "mg",
  });
});

test("classifies whole and ground flower separately", () => {
  assert.equal(classifyFlower({ category: "Flower", title: "Whole Flower" }), "whole");
  assert.equal(classifyFlower({ category: "Flower", title: "Ground Flower" }), "ground");
  assert.equal(classifyFlower({ category: "Vape", title: "Cartridge" }), null);
});

test("calculates and ranks flower unit prices", () => {
  const products = [
    addDealMetrics({ title: "Whole A 7g", category: "Flower", price: 28, previousPrice: 40, selectedAmount: "7g" }),
    addDealMetrics({ title: "Whole B 3.5g", category: "Flower", price: 21, previousPrice: 30, selectedAmount: "3.5g" }),
  ];
  const ranked = rankDeals(products);
  assert.equal(ranked.wholeFlower[0].title, "Whole A 7g");
  assert.equal(ranked.wholeFlower[0].unitPrice, 4);
  assert.equal(ranked.biggestDiscounts[0].discountPercent, 30);
});
