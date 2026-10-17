// contract-stub-server.js — TEST ONLY. NOT YOUR BACKEND.
//
// A tiny in-memory server that answers the endpoints in docs/API_CONTRACT.md,
// so the frontend's "http" mode can be checked in a browser before a real
// SMART API exists. It never reads or writes your .txt files and its data is
// thrown away when it stops.
//
//   node tests/contract-stub-server.js [port]     (default 8790)
//   then open http://localhost:8790/
//
// It serves the frontend files and replies to /config/config.json with
// "apiMode": "http" pointing at itself (the real config file is not changed).
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.argv[2] || 8790);
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".md": "text/plain" };

// Stub data (shape of your product.txt / sales_history.txt, values for testing).
const users = { admin: { user: "admin", pass: "123123" }, cashier: { user: "cashier", pass: "123123" } };
const products = [
  { id: "0001", name: "bread", price: 2, stock: 10 },
  { id: "0002", name: "water", price: 1, stock: 42 },
  { id: "0099", name: "grapes", price: 4, stock: 20 },
  { id: "0100", name: "strawberries", price: 5, stock: 40 },
];
const sales = [
  { number: 1, lines: [{ name: "bread", quantity: 10 }], totalUsd: 20, raw: "================ RECEIPT ================\nbread x10\nTOTAL_USD:20\n=========================================" },
  { number: 2, lines: [{ name: "strawberries", quantity: 4 }, { name: "grapes", quantity: 3 }], totalUsd: 32, raw: "================ RECEIPT ================\nstrawberries x4\ngrapes x3\nTOTAL_USD:32\n=========================================" },
];
const tokens = new Map();

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" });
  res.end(JSON.stringify(body));
}
const fail = (res, status, error) => send(res, status, { ok: false, error });

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve(null); } });
  });
}

async function api(req, res, route) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const body = await readBody(req);
  if (body === null) return fail(res, 400, "Invalid JSON.");
  if (route === "/login" && req.method === "POST") {
    const u = users[body.role];
    if (!u) return fail(res, 400, "Unknown role.");
    if (body.username !== u.user) return fail(res, 401, "Incorrect username. Try again.");
    if (body.password !== u.pass) return fail(res, 401, "Incorrect password. Try again.");
    const token = Math.random().toString(36).slice(2);
    tokens.set(token, body.role);
    return send(res, 200, { ok: true, token, role: body.role, username: body.username });
  }
  const role = tokens.get((req.headers.authorization || "").replace("Bearer ", ""));
  if (!role) return fail(res, 401, "Please log in.");
  if (route === "/logout") { tokens.delete((req.headers.authorization || "").slice(7)); return send(res, 200, { ok: true }); }
  if (route === "/products" && req.method === "GET") return send(res, 200, { ok: true, products });

  if (route.startsWith("/products") || route === "/sales" || route === "/summary") {
    if (role !== "admin") return fail(res, 403, "Admins only.");
  }
  if (route === "/products" && req.method === "POST") {
    if (products.length >= 150) return fail(res, 409, "Inventory is full! Cannot add more products.");
    if (products.some((p) => p.id === body.id)) return fail(res, 409, `A product with ID ${body.id} already exists.`);
    products.push({ id: body.id, name: body.name, price: Number(body.price), stock: Number(body.stock) });
    return send(res, 200, { ok: true, message: "Product added successfully!" });
  }
  const m = route.match(/^\/products\/(.+)$/);
  if (m && req.method === "PUT") {
    const p = products.find((x) => x.id === decodeURIComponent(m[1]));
    if (!p) return fail(res, 404, "Product ID not found.");
    p.price = Number(body.price);
    p.stock = Number(body.stock);
    return send(res, 200, { ok: true, message: "Product updated successfully!" });
  }
  if (route === "/sales" && req.method === "GET") return send(res, 200, { ok: true, sales });
  if (route === "/summary") {
    const revenueUsd = sales.reduce((t, s) => t + s.totalUsd, 0);
    return send(res, 200, { ok: true, transactions: sales.length, revenueUsd, revenueKhr: revenueUsd * 4000 });
  }
  if (route === "/sales/checkout" && req.method === "POST") {
    if (role !== "cashier") return fail(res, 403, "Cashiers only.");
    const items = body.items || [];
    if (!items.length) return fail(res, 400, "Cart is empty.");
    if (items.length > 100) return fail(res, 400, "Cart limit reached! Cannot add more items.");
    const need = new Map();
    const lines = [];
    for (const it of items) {
      const p = products.find((x) => x.id === it.id);
      if (!p) return fail(res, 404, `Error: Product ID '${it.id}' not found. Try again.`);
      const q = Number(it.quantity);
      if (!(q > 0)) return fail(res, 400, "Error: Please enter a valid quantity greater than 0.");
      need.set(p.id, (need.get(p.id) || 0) + q);
      if (need.get(p.id) > p.stock) return fail(res, 409, `Error: Not enough stock! You requested ${need.get(p.id)}, but only ${p.stock} are available.`);
      lines.push({ id: p.id, name: p.name, quantity: q, price: p.price, subtotal: p.price * q });
    }
    const cents = lines.reduce((t, l) => t + Math.round(l.price * 100) * l.quantity, 0);
    const totalKhr = cents * 40;
    const pay = body.payment || {};
    const enough = pay.currency === "KHR" ? Number(pay.amount) >= totalKhr : Math.round(Number(pay.amount) * 100) >= cents;
    if (!enough) return fail(res, 400, `Not enough money: total is $${(cents / 100).toFixed(2)}.`);
    lines.forEach((l) => (products.find((p) => p.id === l.id).stock -= l.quantity));
    const number = sales.length + 1;
    sales.push({ number, lines: lines.map((l) => ({ name: l.name, quantity: l.quantity })), totalUsd: cents / 100,
      raw: "--- NEW SALE ---\n" + lines.map((l) => `${l.quantity}x ${l.name}`).join("\n") + `\nTOTAL_USD:${cents / 100}\n----------------` });
    const changeKhr = pay.currency === "KHR" ? Number(pay.amount) - totalKhr : (Math.round(Number(pay.amount) * 100) - cents) * 40;
    return send(res, 200, { ok: true, receipt: { lines, totalUsd: cents / 100, totalKhr },
      change: { usd: changeKhr / 4000, khr: changeKhr }, saleNumber: number });
  }
  return fail(res, 404, "No such endpoint.");
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) return api(req, res, url.pathname.slice(4));
  if (url.pathname === "/config/config.json") {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config/config.json"), "utf8"));
    return send(res, 200, { ...cfg, apiMode: "http", apiBaseUrl: `http://localhost:${PORT}/api` });
  }
  const file = path.join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`TEST STUB (not the SMART backend) on http://localhost:${PORT}/`));
