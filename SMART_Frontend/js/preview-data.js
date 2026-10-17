/*
 * preview-data.js — PREVIEW MODE SAMPLE DATA ONLY.
 * Used when config.json has "apiMode": "preview". These are NOT your
 * products or sales (every name starts with "sample_"). Nothing here is ever
 * saved, and the UI disables every action that would save.
 */
(function (root) {
  "use strict";
  const SMART = (root.SMART = root.SMART || {});

  const products = [
    { id: "S001", name: "sample_bread", price: 2.0, stock: 12 },
    { id: "S002", name: "sample_water", price: 1.0, stock: 40 },
    { id: "S003", name: "sample_milk", price: 2.5, stock: 6 },
    { id: "S004", name: "sample_rice", price: 5.0, stock: 30 },
    { id: "S005", name: "sample_eggs", price: 3.0, stock: 0 },
    { id: "S006", name: "sample_coffee", price: 3.5, stock: 9 },
    { id: "S007", name: "sample_tea", price: 2.0, stock: 25 },
    { id: "S008", name: "sample_noodles", price: 0.75, stock: 50 },
    { id: "S009", name: "sample_juice", price: 1.5, stock: 18 },
    { id: "S010", name: "sample_soap", price: 1.5, stock: 4 },
  ];

  function sale(number, lines, totalUsd) {
    const raw =
      "--- SAMPLE SALE (preview) ---\n" +
      lines.map((l) => `${l.quantity}x ${l.name}`).join("\n") +
      `\nTOTAL_USD:${totalUsd}\n----------------`;
    return { number, lines, totalUsd, raw };
  }

  const sales = [
    sale(1, [{ name: "sample_bread", quantity: 4 }, { name: "sample_milk", quantity: 2 }], 13),
    sale(2, [{ name: "sample_rice", quantity: 3 }], 15),
    sale(3, [{ name: "sample_coffee", quantity: 2 }, { name: "sample_water", quantity: 6 }, { name: "sample_bread", quantity: 1 }], 15),
    sale(4, [{ name: "sample_noodles", quantity: 8 }], 6),
  ];

  const data = Object.freeze({ products, sales, isSample: true });
  SMART.previewData = data;
  if (typeof module !== "undefined" && module.exports) module.exports = data;
})(typeof window !== "undefined" ? window : globalThis);
