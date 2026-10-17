/*
 * cashier.js — the sale screen (backend cashier_mainMenu).
 * The cart is built in the browser using the product list (GET /products);
 * "Complete sale" sends everything to POST /sales/checkout, where the backend
 * checks stock, totals and money, saves the sale, and returns the receipt.
 * Only the backend's answer is shown as a completed sale.
 */
(function () {
  "use strict";
  const { api, ui, app, validation, money, navigation } = window.SMART;
  const { $, $$, fmt, escapeHtml, nameCell, messageRow, setMsg, setBusy, icon, dialogs, toast } = ui;

  const state = { products: [], cart: [], search: "", currency: "USD", sort: { key: "id", dir: "asc" }, busy: false };

  const inCart = (id) => state.cart.filter((l) => l.id === id).reduce((n, l) => n + l.quantity, 0);
  const available = (p) => p.stock - inCart(p.id);
  const totalCents = () => money.totalCents(state.cart);

  // ---------------------------------------------------------------- catalog
  function renderCatalog() {
    const q = state.search.toLowerCase();
    const rows = ui.sortBy(
      state.products
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
        .map((p) => ({ ...p, available: available(p) })),
      state.sort.key, state.sort.dir);
    const tbody = $("#catalog tbody");
    if (!rows.length) return messageRow(tbody, 4, state.products.length ? "No products match." : "No products.");
    const low = api.config.lowStockLimit;
    tbody.innerHTML = rows.map((p) => {
      const cls = p.available <= 0 ? "available-out" : p.available <= low ? "available-low" : "available-ok";
      return `<tr tabindex="0" data-id="${escapeHtml(p.id)}"><td class="muted">${escapeHtml(p.id)}</td><td>${nameCell(p.name)}</td>` +
        `<td class="num">${fmt.usd(p.price)}</td><td class="num ${cls}">${p.available}</td></tr>`;
    }).join("");
    $("#product-ids").innerHTML = state.products.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
  }

  // ------------------------------------------------------------------- cart
  function renderCart() {
    const tbody = $("#cart tbody");
    if (!state.cart.length) {
      messageRow(tbody, 4, "Cart is empty");
    } else {
      tbody.innerHTML = state.cart.map((l, i) =>
        `<tr><td>${escapeHtml(l.name)}</td><td class="num">x${l.quantity}</td><td class="num">${fmt.usd(money.lineCents(l.price, l.quantity) / 100)}</td>` +
        `<td><button type="button" class="icon-only" data-remove="${i}" aria-label="Remove ${escapeHtml(l.name)} from cart">${icon("trash")}</button></td></tr>`
      ).join("");
    }
    const cents = totalCents();
    $("#total-usd").textContent = fmt.usd(cents / 100);
    $("#total-khr").textContent = fmt.khr(money.khrFromCents(cents, api.config.khrPerUsd));
    $("#clear-btn").disabled = !state.cart.length || state.busy;
    renderPayment();
  }

  function renderPayment() {
    const amount = $("#given").value;
    const cents = totalCents();
    const err = state.cart.length ? validation.payment(amount, cents, state.currency, api.config.khrPerUsd) : "Cart is empty.";
    const hasAmount = amount !== "" && Number(amount) > 0;
    const ch = money.change(amount, cents, state.currency, api.config.khrPerUsd);
    const short = hasAmount && state.cart.length && (ch.khr < 0 || ch.usd < 0);
    $("#change-usd").textContent = !hasAmount || !state.cart.length ? "$0.00" : short ? "Short " + fmt.usd(-ch.usd) : fmt.usd(ch.usd);
    $("#change-khr").textContent = !hasAmount || !state.cart.length ? "KHR 0" : short ? "Short " + fmt.khr(-ch.khr) : fmt.khr(ch.khr);
    $$(".change-grid .v").forEach((v) => v.classList.toggle("short", !!short));
    const btn = $("#complete-btn");
    btn.disabled = state.busy || !!err || api.isPreview;
    btn.title = api.isPreview ? "Preview mode: sales cannot be completed." : err || "";
  }

  function addToCart(e) {
    if (e) e.preventDefault();
    const id = $("#product-id").value.trim();
    const qty = $("#qty").value;
    if (!id) { setMsg($("#entry-msg"), "Error: enter a Product ID.", "error"); return $("#product-id").focus(); }
    const p = state.products.find((x) => x.id === id);
    if (!p) { setMsg($("#entry-msg"), `Error: Product ID '${id}' not found. Try again.`, "error"); return $("#product-id").select(); }
    const err = validation.quantity(qty, available(p));
    if (err) { setMsg($("#entry-msg"), err, "error"); return $("#qty").select(); }
    if (state.cart.length >= api.config.maxCartItems) return setMsg($("#entry-msg"), "Cart limit reached! Cannot add more items.", "error");
    state.cart.push({ id: p.id, name: p.name, price: p.price, quantity: Number(qty) });
    setMsg($("#entry-msg"), `-> Added ${Number(qty)}x ${p.name} to cart.`, "ok");
    $("#product-id").value = "";
    $("#qty").value = 1;
    $("#product-id").focus();
    renderCart();
    renderCatalog();
  }

  async function clearCart() {
    if (!state.cart.length) return;
    if (!(await dialogs.confirm("Clear cart", "Remove all items from the cart? Nothing has been sold yet.", "Clear cart"))) return;
    state.cart = [];
    setMsg($("#entry-msg"), "Cart cleared.", "info");
    renderCart();
    renderCatalog();
  }

  async function completeSale() {
    if (state.busy || !state.cart.length || api.isPreview) return;   // no double submit
    const err = validation.payment($("#given").value, totalCents(), state.currency, api.config.khrPerUsd);
    if (err) return setMsg($("#pay-msg"), err, "error");
    const amount = Number($("#given").value);
    const ok = await dialogs.confirm("Complete sale",
      `Total ${fmt.usd(totalCents() / 100)} · Given ${state.currency === "KHR" ? fmt.khr(amount) : fmt.usd(amount)}. Send this sale to the backend?`,
      "Complete sale");
    if (!ok) return;

    state.busy = true;
    setBusy($("#complete-btn"), true);
    $("#clear-btn").disabled = true;
    setMsg($("#pay-msg"), "Sending to the backend…", "info");
    try {
      const res = await api.checkout(
        state.cart.map((l) => ({ id: l.id, quantity: l.quantity })),
        { currency: state.currency, amount });
      // Show ONLY what the backend returned.
      const r = res.receipt;
      const lines = r.lines.map((l) =>
        `${escapeHtml(String(l.name).padEnd(20))} x${String(l.quantity).padEnd(4)} ${fmt.usd(l.subtotal ?? l.price * l.quantity)}`).join("\n");
      await dialogs.html("Sale completed",
        `<pre class="receipt-text">================= RECEIPT =================\n${lines}\n-------------------------------------------\n` +
        `TOTAL DUE:      ${fmt.usd(r.totalUsd)}\nTOTAL DUE KHR:  ${fmt.khr(r.totalKhr)}\n` +
        `CHANGE (USD):   ${fmt.usd(res.change.usd)}\nCHANGE (KHR):   ${fmt.khr(res.change.khr)}\n` +
        `===========================================</pre>` +
        (res.saleNumber ? `<p>Saved by the backend as sale #${escapeHtml(res.saleNumber)}.</p>` : ""));
      state.cart = [];
      $("#given").value = "";
      setMsg($("#pay-msg"), "");
      setMsg($("#entry-msg"), "Sale completed. Ready for the next customer.", "ok");
      toast("Sale completed.");
      await loadProducts();
    } catch (ex) {
      app.handleError(ex, $("#pay-msg"));
      setMsg($("#entry-msg"), "The sale was not completed. The cart is unchanged.", "error");
      await loadProducts();                                  // show the backend's current stock
    } finally {
      state.busy = false;
      setBusy($("#complete-btn"), false);
      renderCart();
    }
  }

  function setCurrency(c) {
    state.currency = c;
    $$(".segmented button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.currency === c)));
    $("#given-unit").textContent = c;
    $("#given").step = c === "KHR" ? "100" : "0.01";
    $("#given").placeholder = c === "KHR" ? "0" : "0.00";
    $("#given").value = "";
    renderPayment();
  }

  async function loadProducts() {
    try {
      state.products = await api.getProducts();
      navigation.setProducts(state.products);
      renderCatalog();
    } catch (err) {
      app.handleError(err, $("#entry-msg"));
      messageRow($("#catalog tbody"), 4, "Could not load products.");
    }
  }

  async function init() {
    const started = await app.startPage({ page: "cashier", role: "cashier", searchPlaceholder: "Search products by name or ID" });
    if (!started) return;
    document.querySelectorAll("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
    $("#rate").textContent = `Exchange rate: 1 USD = ${fmt.int(api.config.khrPerUsd)} KHR`;
    if (api.isPreview) $("#catalog-note").textContent = "Preview mode: sample products. Sales cannot be completed.";

    ui.sortable($("#catalog"), (key, dir) => { state.sort = { key, dir }; renderCatalog(); });
    $("#entry-form").addEventListener("submit", addToCart);
    $("#catalog tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      $("#product-id").value = tr.dataset.id;
      $("#qty").focus();
      $("#qty").select();
    });
    $("#catalog tbody").addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr && e.key === "Enter") { $("#product-id").value = tr.dataset.id; $("#qty").focus(); $("#qty").select(); }
    });
    $("#cart tbody").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove]");
      if (!b) return;
      const [line] = state.cart.splice(Number(b.dataset.remove), 1);
      setMsg($("#entry-msg"), `Removed ${line.name} from cart.`, "info");
      renderCart();
      renderCatalog();
    });
    $$(".segmented button").forEach((b) => b.addEventListener("click", () => setCurrency(b.dataset.currency)));
    $("#given").addEventListener("input", renderPayment);
    $("#complete-btn").addEventListener("click", completeSale);
    $("#clear-btn").addEventListener("click", clearCart);
    window.addEventListener("smart:search", (e) => { state.search = e.detail; renderCatalog(); });

    messageRow($("#catalog tbody"), 4, "", true);
    renderCart();
    await loadProducts();
    $("#product-id").focus();
  }

  init();
})();
