"use strict";

const COLUMNS = [
  "site",
  "category",
  "subcategory",
  "brand",
  "title",
  "strainType",
  "rating",
  "thcPercent",
  "cbdPercent",
  "weight",
  "weightGrams",
  "price",
  "regPrice",
  "savings",
  "discountPercent",
  "unitPrice",
  "unitLabel",
  "productId",
  "url",
  "scrapedAt",
];

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(products) {
  const rows = [COLUMNS.map(csvCell).join(",")];
  for (const product of products) {
    rows.push(COLUMNS.map((column) => csvCell(product[column])).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

// Best deals first within each category: biggest discount, then cheapest unit price.
function sortForReview(products) {
  return [...products].sort((left, right) => {
    if (left.category !== right.category)
      return (left.category || "").localeCompare(right.category || "");
    const leftDiscount = left.discountPercent ?? -1;
    const rightDiscount = right.discountPercent ?? -1;
    if (rightDiscount !== leftDiscount) return rightDiscount - leftDiscount;
    const leftUnit = left.unitPrice ?? Infinity;
    const rightUnit = right.unitPrice ?? Infinity;
    return leftUnit - rightUnit;
  });
}

module.exports = { COLUMNS, toCsv, sortForReview };
