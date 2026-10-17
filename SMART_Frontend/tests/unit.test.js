// unit.test.js — Node built-in test runner, no packages needed:
//   node --test tests/
// Tests input validation, money display maths and the API layer
// (preview mode + http mode with a fake fetch).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { validation: v, money } = require("../js/validation.js");
require("../js/preview-data.js");
const api = require("../js/api.js");

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, x) => m.set(k, String(x)), removeItem: (k) => m.delete(k) };
}

test("credentials: required, no spaces", () => {
  assert.equal(v.credentials("", "x"), "Please enter your username.");
  assert.equal(v.credentials("admin", ""), "Please enter your password.");
  assert.match(v.credentials("ad min", "x"), /spaces/);
  assert.equal(v.credentials("admin", "123123"), null);
});

test("product ID rules match the backend", () => {
  const list = [{ id: "0001" }];
  assert.match(v.productId("", list), /required/);
  assert.match(v.productId("a b", list), /spaces/);
  assert.match(v.productId("a,b", list), /commas/);
  assert.match(v.productId("0", list), /cashier/);
  assert.match(v.productId("0001", list), /already exists/);
  assert.match(v.productId("0002", new Array(150).fill({ id: "x" }), 150), /full/);
  assert.equal(v.productId("0152", list, 150), null);
});

test("product name is one word (cin >>)", () => {
  assert.match(v.productName("orange juice"), /_/);
  assert.match(v.productName("a,b"), /commas/);
  assert.equal(v.productName("orange_juice"), null);
});

test("price, stock, quantity", () => {
  assert.match(v.price("0"), /greater/);
  assert.match(v.price("abc"), /number/);
  assert.match(v.price("1.234"), /2 decimals/);
  assert.equal(v.price("1.25"), null);
  assert.match(v.stock("-1"), /negative/);
  assert.match(v.stock("1.5"), /whole/);
  assert.equal(v.stock("0"), null);
  assert.match(v.quantity("0"), /greater than 0/);
  assert.match(v.quantity("5", 3), /only 3 are available/);
  assert.equal(v.quantity("3", 3), null);
});

test("money: totals, KHR and change", () => {
  const lines = [{ price: 2, quantity: 3 }, { price: 0.75, quantity: 3 }];
  assert.equal(money.totalCents(lines), 825);
  assert.equal(money.khrFromCents(825, 4000), 33000);
  assert.deepEqual(money.change(10, 825, "USD", 4000), { usd: 1.75, khr: 7000 });
  assert.deepEqual(money.change(40000, 825, "KHR", 4000), { usd: 1.75, khr: 7000 });
  assert.match(v.payment(8, 825, "USD", 4000), /Not enough/);
  assert.equal(v.payment(8.25, 825, "USD", 4000), null);
  assert.match(v.payment(32999, 825, "KHR", 4000), /Not enough/);
});

test("preview mode: sample data, every write refused", async () => {
  api.init({ apiMode: "preview" }, { storage: memoryStorage(), fetch: () => { throw new Error("no network in preview"); } });
  assert.equal(api.isPreview, true);
  const s = await api.login("admin", "admin", "anything");
  assert.equal(s.preview, true);
  assert.equal(api.session.get().mode, "preview");
  const products = await api.getProducts();
  assert.ok(products.length > 0 && products.every((p) => p.name.startsWith("sample_")));
  const sum = await api.getSummary();
  assert.equal(sum.transactions, (await api.getSales()).length);
  await assert.rejects(api.addProduct({ id: "X", name: "x", price: 1, stock: 1 }), /Preview mode/);
  await assert.rejects(api.updateProduct("S001", { price: 1, stock: 1 }), /Preview mode/);
  await assert.rejects(api.checkout([{ id: "S001", quantity: 1 }], { currency: "USD", amount: 5 }), /Preview mode/);
  await api.logout();
  assert.equal(api.session.get(), null);
});

test("http mode: sends the contract requests with the token", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, auth: opts.headers.Authorization, body: opts.body && JSON.parse(opts.body) });
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith("/login")) return reply(200, { ok: true, token: "t1", role: "admin", username: "admin" });
    if (url.endsWith("/products") && opts.method === "GET") return reply(200, { ok: true, products: [{ id: "0001", name: "bread", price: 2, stock: 10 }] });
    if (url.endsWith("/products/0001")) return reply(404, { ok: false, error: "Product ID not found." });
    if (url.endsWith("/summary")) return reply(200, { ok: true, transactions: 2, revenueUsd: 52 });
    return reply(500, { ok: false, error: "boom" });
  };
  api.init({ apiMode: "http", apiBaseUrl: "http://pos.local/api/" }, { storage: memoryStorage(), fetch: fakeFetch });
  assert.equal(api.isPreview, false);
  await api.login("admin", "admin", "123123");
  const products = await api.getProducts();
  assert.deepEqual(products, [{ id: "0001", name: "bread", price: 2, stock: 10 }]);
  assert.equal(calls[1].url, "http://pos.local/api/products");
  assert.equal(calls[1].auth, "Bearer t1");
  assert.deepEqual(calls[0].body, { role: "admin", username: "admin", password: "123123" });
  const sum = await api.getSummary();
  assert.equal(sum.revenueKhr, 208000);                                  // filled from the rate
  await assert.rejects(api.updateProduct("0001", { price: 1, stock: 1 }), (e) => e.status === 404 && /not found/.test(e.message));
});

test("http mode: network down and bad responses give clear errors", async () => {
  api.init({ apiMode: "http", apiBaseUrl: "http://localhost:1/api" }, {
    storage: memoryStorage(),
    fetch: async () => { throw new TypeError("Failed to fetch"); },
  });
  await assert.rejects(api.getProducts(), /Could not reach the SMART API/);
  api.init({ apiMode: "http", apiBaseUrl: "http://x/api" }, {
    storage: memoryStorage(),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, products: "nope" }) }),
  });
  await assert.rejects(api.getProducts(), /Unexpected response/);
  api.init({ apiMode: "http", apiBaseUrl: "http://x/api" }, {
    storage: memoryStorage(),
    fetch: async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: "Incorrect password. Try again." }) }),
  });
  await assert.rejects(api.login("admin", "admin", "bad"), (e) => e.unauthorized && /Incorrect password/.test(e.message));
});
