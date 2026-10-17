/*
 * validation.js — input checks done in the browser BEFORE anything is sent.
 * They mirror how the C++ backend reads input (cin >>, comma-separated files)
 * so the user gets a clear message instead of a backend error.
 * The backend stays the authority: it re-checks stock, totals and logins.
 *
 * Pure functions (no DOM) so they also run in Node for the tests.
 */
(function (root) {
  "use strict";
  const SMART = (root.SMART = root.SMART || {});

  // cin >> stops at whitespace; product.txt separates fields with commas.
  const TOKEN = /^[^\s,]+$/;

  function isNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function toNumber(v) {
    if (typeof v === "number") return v;
    if (typeof v !== "string" || v.trim() === "") return NaN;
    return Number(v.trim());
  }

  const validation = {
    /** Username/password: required, no spaces (the backend reads them with cin >>). */
    credentials(username, password) {
      if (!username || !username.trim()) return "Please enter your username.";
      if (!password) return "Please enter your password.";
      if (/\s/.test(username.trim()) || /\s/.test(password)) return "Username and password cannot contain spaces.";
      return null;
    },

    /** New product ID. `existing` = list of products already loaded. */
    productId(id, existing, maxProducts) {
      const v = (id || "").trim();
      if (!v) return "Product ID is required.";
      if (!TOKEN.test(v)) return "Product ID cannot contain spaces or commas.";
      if (v === "0") return "ID 0 can't be used: the cashier types 0 to finish a sale.";
      if (v.length > 20) return "Product ID is too long (max 20 characters).";
      if ((existing || []).some((p) => p.id === v)) return `A product with ID ${v} already exists.`;
      if (maxProducts && (existing || []).length >= maxProducts)
        return "Inventory is full! Cannot add more products.";
      return null;
    },

    /** Product name: one word for the backend — use _ instead of spaces. */
    productName(name) {
      const v = (name || "").trim();
      if (!v) return "Product name is required.";
      if (/\s/.test(v)) return "Use _ instead of spaces (e.g. orange_juice). The backend reads one word.";
      if (v.includes(",")) return "Product name cannot contain commas.";
      if (v.length > 40) return "Product name is too long (max 40 characters).";
      return null;
    },

    price(value) {
      const n = toNumber(value);
      if (!isNumber(n)) return "Price must be a number.";
      if (n <= 0) return "Price must be greater than 0.";
      if (Math.round(n * 100) !== Math.round(n * 1000) / 10) return "Price can have at most 2 decimals.";
      return null;
    },

    stock(value) {
      const n = toNumber(value);
      if (!isNumber(n) || !Number.isInteger(n)) return "Stock must be a whole number.";
      if (n < 0) return "Stock cannot be negative.";
      return null;
    },

    /** Quantity for the cart. `available` = stock not already in the cart (optional). */
    quantity(value, available) {
      const n = toNumber(value);
      if (!isNumber(n) || !Number.isInteger(n) || n <= 0) return "Error: Please enter a valid quantity greater than 0.";
      if (isNumber(available) && n > available)
        return `Error: Not enough stock! You requested ${n}, but only ${Math.max(0, available)} are available.`;
      return null;
    },

    /** Money given must cover the total (the console backend doesn't check this). */
    payment(amount, totalCents, currency, khrPerUsd) {
      const n = toNumber(amount);
      if (!isNumber(n) || n <= 0) return "Enter the money given.";
      if (currency === "KHR") {
        if (!Number.isInteger(n)) return "KHR must be a whole number.";
        if (n < money.khrFromCents(totalCents, khrPerUsd)) return "Not enough money for the total.";
      } else if (money.toCents(n) < totalCents) {
        return "Not enough money for the total.";
      }
      return null;
    },
  };

  /** Display arithmetic only. The backend's receipt numbers are the real ones. */
  const money = {
    toCents(usd) {
      return Math.round(toNumber(usd) * 100);
    },
    lineCents(price, quantity) {
      return Math.round(price * 100) * quantity;
    },
    totalCents(lines) {
      return (lines || []).reduce((sum, l) => sum + money.lineCents(l.price, l.quantity), 0);
    },
    khrFromCents(cents, khrPerUsd) {
      return Math.round((cents * (khrPerUsd || 4000)) / 100);
    },
    /** Change for an amount given; negative = short. */
    change(amount, totalCents, currency, khrPerUsd) {
      const rate = khrPerUsd || 4000;
      if (currency === "KHR") {
        const khr = Math.round(toNumber(amount) || 0) - money.khrFromCents(totalCents, rate);
        return { usd: khr / rate, khr };
      }
      const cents = money.toCents(toNumber(amount) || 0) - totalCents;
      return { usd: cents / 100, khr: money.khrFromCents(cents, rate) };
    },
  };

  SMART.validation = validation;
  SMART.money = money;
  if (typeof module !== "undefined" && module.exports) module.exports = { validation, money };
})(typeof window !== "undefined" ? window : globalThis);
