/*
 * api.js — the ONLY place the frontend gets or sends data.
 *
 * Two modes, chosen by config/config.json → "apiMode":
 *   "preview" — built-in SAMPLE data (js/preview-data.js). No network calls.
 *               Every write (add/update product, checkout) is refused.
 *   "http"    — calls the endpoints in docs/API_CONTRACT.md with fetch().
 *               Your C++ backend has no HTTP interface yet, so this mode
 *               needs a server that implements that contract.
 *
 * Every method is async: it resolves with data or throws SMART.ApiError
 * whose message can be shown to the user.
 */
(function (root) {
  "use strict";
  const SMART = (root.SMART = root.SMART || {});

  class ApiError extends Error {
    constructor(message, status, extra) {
      super(message);
      this.name = "ApiError";
      this.status = status || 0;
      Object.assign(this, extra || {});
    }
  }

  const PREVIEW_REFUSED =
    "Preview mode: this is sample data and nothing can be saved. " +
    'Connect a SMART API (set "apiMode": "http" in config/config.json).';

  // ---------------------------------------------------------------- session
  const SESSION_KEY = "smart.session";
  function makeSession(storage) {
    return {
      get() {
        try {
          const raw = storage && storage.getItem(SESSION_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          return null;
        }
      },
      set(value) {
        try { storage && storage.setItem(SESSION_KEY, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
      },
      clear() {
        try { storage && storage.removeItem(SESSION_KEY); } catch (e) { /* storage blocked */ }
      },
    };
  }

  // ------------------------------------------------------- response checks
  function req(cond, what) {
    if (!cond) throw new ApiError(`Unexpected response from the SMART API (${what}).`, 0);
  }
  function normProduct(p) {
    req(p && typeof p.id === "string" && typeof p.name === "string", "product id/name");
    const price = Number(p.price), stock = Number(p.stock);
    req(Number.isFinite(price) && Number.isInteger(stock), "product price/stock");
    return { id: p.id, name: p.name, price, stock };
  }
  function normSale(s, i) {
    req(s && Array.isArray(s.lines), "sale lines");
    return {
      number: Number.isInteger(s.number) ? s.number : i + 1,
      lines: s.lines.map((l) => {
        req(l && typeof l.name === "string" && Number.isInteger(Number(l.quantity)), "sale line");
        return { name: l.name, quantity: Number(l.quantity) };
      }),
      totalUsd: Number(s.totalUsd) || 0,
      raw: typeof s.raw === "string" ? s.raw : "",
    };
  }

  // ------------------------------------------------------------ preview mode
  function previewAdapter(config) {
    const data = SMART.previewData;
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const delay = (v) => new Promise((r) => setTimeout(() => r(v), 120));
    const refuse = () => Promise.reject(new ApiError(PREVIEW_REFUSED, 0, { preview: true }));
    return {
      async login(role, username, password) {
        const err = SMART.validation.credentials(username, password);
        if (err) throw new ApiError(err, 400);
        return delay({ token: "preview", role, username: username.trim(), preview: true });
      },
      async logout() { return { ok: true }; },
      getProducts: () => delay(clone(data.products)),
      getSales: () => delay(clone(data.sales)),
      async getSummary() {
        const revenueUsd = data.sales.reduce((s, x) => s + x.totalUsd, 0);
        return delay({ transactions: data.sales.length, revenueUsd, revenueKhr: revenueUsd * config.khrPerUsd });
      },
      addProduct: refuse,
      updateProduct: refuse,
      checkout: refuse,
    };
  }

  // --------------------------------------------------------------- http mode
  function httpAdapter(config, fetchImpl, session) {
    const base = String(config.apiBaseUrl || "").replace(/\/+$/, "");

    async function request(method, path, body) {
      if (typeof fetchImpl !== "function") throw new ApiError("This browser cannot make network requests.", 0);
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), config.requestTimeoutMs || 8000) : null;
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const s = session.get();
      if (s && s.token) headers.Authorization = "Bearer " + s.token;
      let res;
      try {
        res = await fetchImpl(base + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller ? controller.signal : undefined,
        });
      } catch (e) {
        const timedOut = e && e.name === "AbortError";
        throw new ApiError(
          timedOut
            ? `The SMART API did not answer in time (${base}).`
            : `Could not reach the SMART API at ${base}. Is the server running?`,
          0,
          { network: true }
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
      let json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      if (!res.ok || !json || json.ok === false) {
        const msg = (json && json.error) || `The SMART API returned an error (HTTP ${res.status}).`;
        throw new ApiError(msg, res.status, { unauthorized: res.status === 401 });
      }
      return json;
    }

    return {
      async login(role, username, password) {
        const j = await request("POST", "/login", { role, username, password });
        req(typeof j.token === "string" && j.token, "login token");
        return { token: j.token, role: j.role || role, username: j.username || username };
      },
      logout: () => request("POST", "/logout", {}),
      async getProducts() {
        const j = await request("GET", "/products");
        req(Array.isArray(j.products), "products");
        return j.products.map(normProduct);
      },
      async addProduct(p) {
        const j = await request("POST", "/products", { id: p.id, name: p.name, price: p.price, stock: p.stock });
        return { message: j.message || "Product added successfully!" };
      },
      async updateProduct(id, values) {
        const j = await request("PUT", "/products/" + encodeURIComponent(id), { price: values.price, stock: values.stock });
        return { message: j.message || "Product updated successfully!" };
      },
      async getSales() {
        const j = await request("GET", "/sales");
        req(Array.isArray(j.sales), "sales");
        return j.sales.map(normSale);
      },
      async getSummary() {
        const j = await request("GET", "/summary");
        req(Number.isFinite(Number(j.transactions)) && Number.isFinite(Number(j.revenueUsd)), "summary");
        return {
          transactions: Number(j.transactions),
          revenueUsd: Number(j.revenueUsd),
          revenueKhr: Number(j.revenueKhr) || Number(j.revenueUsd) * config.khrPerUsd,
          message: j.message || "",
        };
      },
      async checkout(items, payment) {
        const j = await request("POST", "/sales/checkout", { items, payment });
        req(j.receipt && Array.isArray(j.receipt.lines) && Number.isFinite(Number(j.receipt.totalUsd)), "receipt");
        req(j.change && Number.isFinite(Number(j.change.usd)), "change");
        return j;
      },
    };
  }

  // ------------------------------------------------------------- public API
  const DEFAULT_CONFIG = {
    apiMode: "preview",
    apiBaseUrl: "http://localhost:8080/api",
    requestTimeoutMs: 8000,
    khrPerUsd: 4000,
    maxProducts: 150,
    maxCartItems: 100,
    lowStockLimit: 10,
  };

  let adapter = null;
  let current = { ...DEFAULT_CONFIG };
  let session = makeSession(root.sessionStorage);

  const api = {
    ApiError,
    DEFAULT_CONFIG,
    PREVIEW_REFUSED,

    /** options.fetch / options.storage are for tests. */
    init(config, options) {
      const opts = options || {};
      current = { ...DEFAULT_CONFIG, ...(config || {}) };
      session = makeSession(opts.storage !== undefined ? opts.storage : root.sessionStorage);
      const fetchImpl = opts.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
      adapter = current.apiMode === "http" ? httpAdapter(current, fetchImpl, session) : previewAdapter(current);
      return current;
    },
    get config() { return current; },
    get isPreview() { return current.apiMode !== "http"; },
    session: {
      get: () => session.get(),
      clear: () => session.clear(),
    },

    async login(role, username, password) {
      const s = await adapter.login(role, username, password);
      session.set({ ...s, mode: current.apiMode });
      return s;
    },
    async logout() {
      try { await adapter.logout(); } finally { session.clear(); }
    },
    getProducts: () => adapter.getProducts(),
    addProduct: (p) => adapter.addProduct(p),
    updateProduct: (id, values) => adapter.updateProduct(id, values),
    getSales: () => adapter.getSales(),
    getSummary: () => adapter.getSummary(),
    /** items: [{id, quantity}], payment: {currency: "USD"|"KHR", amount} */
    checkout: (items, payment) => adapter.checkout(items, payment),
  };

  SMART.ApiError = ApiError;
  SMART.api = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
