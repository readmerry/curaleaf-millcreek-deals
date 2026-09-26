"use strict";

const GRAMS_PER_OUNCE = 28.3495;

// Normalizes a free-text weight/size ("3.5g", "1/2g", "7g", "300mg", "2000mg",
// "100mg 20pk") to grams so unit prices are comparable within a category.
function parseWeightToGrams(text) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();

  // "10mg ea | 10-Pack", "100mg each, 10 pack", "20mg ea 20pk", etc: total
  // content is the per-piece dose times the pack count, not the first number.
  const perPiecePack = clean.match(
    /(\d+(?:\.\d+)?)\s*mg\s*(?:ea\.?|each)\b.*?(\d+)\s*[- ]?(?:pack|pk)\b/i
  );
  if (perPiecePack) {
    const each = Number(perPiecePack[1]);
    const count = Number(perPiecePack[2]);
    return { grams: (each * count) / 1000, unit: "g", basis: "mg-per-pack" };
  }

  const multipliedPackage = clean.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mg|g)\b/i);
  if (multipliedPackage) {
    const count = Number(multipliedPackage[1]);
    const each = Number(multipliedPackage[2]);
    const unit = multipliedPackage[3].toLowerCase();
    const grams = unit === "mg" ? (each * count) / 1000 : each * count;
    return { grams, unit: "g", basis: "count-x-each" };
  }

  const fraction = clean.match(/^(\d+)\/(\d+)\s*(oz|ounce)\b/i);
  if (fraction) {
    const value = Number(fraction[1]) / Number(fraction[2]);
    return { grams: value * GRAMS_PER_OUNCE, unit: "g", basis: "fraction-oz" };
  }

  const simple = clean.match(/^(\d+(?:\.\d+)?)\s*(kg|g|mg|oz|ounce)\b/i);
  if (simple) {
    const value = Number(simple[1]);
    const unit = simple[2].toLowerCase();
    if (unit === "kg") return { grams: value * 1000, unit: "g", basis: "kg" };
    if (unit === "mg") return { grams: value / 1000, unit: "g", basis: "mg" };
    if (unit === "oz" || unit === "ounce")
      return { grams: value * GRAMS_PER_OUNCE, unit: "g", basis: "oz" };
    return { grams: value, unit: "g", basis: "g" };
  }

  return null;
}

function parsePercent(text) {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function parseMoney(text) {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

// Adds savings/discount/unit-price fields. Mutates nothing; returns a new object.
function addDealMetrics(product) {
  const savings =
    product.price != null &&
    product.regPrice != null &&
    product.regPrice > product.price
      ? product.regPrice - product.price
      : null;
  const discountPercent =
    savings != null ? (savings / product.regPrice) * 100 : null;

  const weightInfo = parseWeightToGrams(product.weight);
  const unitPrice =
    weightInfo && weightInfo.grams && product.price != null
      ? product.price / weightInfo.grams
      : null;

  return {
    ...product,
    weightGrams: weightInfo ? Number(weightInfo.grams.toFixed(4)) : null,
    savings: savings == null ? null : Number(savings.toFixed(2)),
    discountPercent:
      discountPercent == null ? null : Number(discountPercent.toFixed(2)),
    unitPrice: unitPrice == null ? null : Number(unitPrice.toFixed(4)),
    unitLabel: unitPrice == null ? null : "$/g",
  };
}

module.exports = { parseWeightToGrams, parsePercent, parseMoney, addDealMetrics };
