/*
 * products.js — Admin "Manage Products":
 *   1 View all products        → GET  /products
 *   2 Add a new product        → POST /products
 *   3 Update stock/price       → PUT  /products/{id}  (price and stock only)
 * The backend has no delete option, so there is no delete button.
 */
(function () {
  "use strict";
  const { api, ui, app, validation, navigation } = window.SMART;
  const { $, $$, fmt, escapeHtml, nameCell, pill, messageRow, setMsg, setBusy, icon, toast } = ui;

  const state = { products: [], search: "", filter: "all", sort: { key: "id", dir: "asc" }, editing: null, loaded: false };

  function visible() {
    const low = api.config.lowStockLimit;
    const q = state.search.toLowerCase();
    return ui.sortBy(state.products.filter((p) =>
      (state.filter === "all" || (state.filter === "low" ? p.stock <= low : p.stock <= 0)) &&
      (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    ), state.sort.key, state.sort.dir);
  }

  function render() {
    const low = api.config.lowStockLimit;
    const list = visible();
    const lowCount = state.products.filter((p) => p.stock <= low).length;
    $("#products-sub").textContent =
      `${list.length} of ${state.products.length} products · ${lowCount} low stock · max ${api.config.maxProducts}`;
    const tbody = $("#products-table tbody");
    if (!list.length) return messageRow(tbody, 5, state.products.length ? "No products match." : "No products yet.");
    tbody.innerHTML = list.map((p) =>
      `<tr tabindex="0" data-id="${escapeHtml(p.id)}" aria-selected="${p.id === state.editing}">` +
      `<td class="muted">${escapeHtml(p.id)}</td><td>${nameCell(p.name)}</td>` +
      `<td class="num">${fmt.usd(p.price)}</td><td class="num">${p.stock}</td><td>${pill(p.stock, low)}</td></tr>`
    ).join("");
  }

  function clearErrors() {
    ["id", "name", "price", "stock"].forEach((f) => {
      $("#e-" + f).textContent = "";
      $("#f-" + f).removeAttribute("aria-invalid");
    });
  }

  function hint(text) {
    $("#form-hint").textContent = api.isPreview ? "Preview mode — nothing can be saved." : text;
  }

  function startNew() {
    state.editing = null;
    clearErrors();
    setMsg($("#form-msg"), "");
    $("#form-title").textContent = "New Product";
    hint("Sent to the backend as Manage Products → 2. Add a new product.");
    $("#save-label").textContent = "Add product";
    const maxId = state.products.reduce((m, p) => (/^\d+$/.test(p.id) ? Math.max(m, Number(p.id)) : m), 0);
    $("#f-id").value = String(maxId + 1).padStart(4, "0");
    $("#f-name").value = "";
    $("#f-price").value = "";
    $("#f-stock").value = "";
    $("#f-id").readOnly = false;
    $("#f-name").readOnly = false;
    $$("#products-table tbody tr").forEach((tr) => tr.setAttribute("aria-selected", "false"));
  }

  function edit(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    state.editing = id;
    clearErrors();
    setMsg($("#form-msg"), "");
    $("#form-title").textContent = "Update Product";
    hint("Sent to the backend as Manage Products → 3. Update stock/price. Only price and stock can change; deleting is not part of SMART.");
    $("#save-label").textContent = "Save price & stock";
    $("#f-id").value = p.id;
    $("#f-name").value = p.name;
    $("#f-price").value = p.price;
    $("#f-stock").value = p.stock;
    $("#f-id").readOnly = true;
    $("#f-name").readOnly = true;
    $$("#products-table tbody tr").forEach((tr) => tr.setAttribute("aria-selected", String(tr.dataset.id === id)));
    $("#f-price").focus();
  }

  function check() {
    clearErrors();
    const errors = {};
    if (!state.editing) {
      errors.id = validation.productId($("#f-id").value, state.products, api.config.maxProducts);
      errors.name = validation.productName($("#f-name").value);
    }
    errors.price = validation.price($("#f-price").value);
    errors.stock = validation.stock($("#f-stock").value);
    let first = null;
    Object.entries(errors).forEach(([f, msg]) => {
      if (!msg) return;
      $("#e-" + f).textContent = msg;
      $("#f-" + f).setAttribute("aria-invalid", "true");
      first = first || f;
    });
    if (first) $("#f-" + first).focus();
    return !first;
  }

  async function save(e) {
    e.preventDefault();
    const btn = $("#save-btn");
    if (btn.disabled) return;                               // no double submit
    if (api.isPreview) return setMsg($("#form-msg"), api.PREVIEW_REFUSED, "error");
    if (!check()) return;
    const values = { price: Number($("#f-price").value), stock: Number($("#f-stock").value) };
    const id = state.editing || $("#f-id").value.trim();
    setBusy(btn, true);
    setMsg($("#form-msg"), "Sending to the backend…", "info");
    try {
      const res = state.editing
        ? await api.updateProduct(id, values)
        : await api.addProduct({ id, name: $("#f-name").value.trim(), ...values });
      await load();                                         // show what the backend now has
      edit(id);
      setMsg($("#form-msg"), res.message, "ok");
      toast(res.message);
    } catch (err) {
      app.handleError(err, $("#form-msg"));
    } finally {
      setBusy(btn, api.isPreview);
    }
  }

  async function load() {
    if (!state.loaded) messageRow($("#products-table tbody"), 5, "", true);
    setMsg($("#list-msg"), "");
    try {
      state.products = await api.getProducts();
      state.loaded = true;
      navigation.setProducts(state.products);
      render();
    } catch (err) {
      app.handleError(err, $("#list-msg"));
      messageRow($("#products-table tbody"), 5, "Could not load products.");
    }
  }

  async function init() {
    const started = await app.startPage({ page: "products", role: "admin", searchPlaceholder: "Search products by name or ID" });
    if (!started) return;
    document.querySelectorAll("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
    $("#filter").options[1].textContent = `Low stock (≤ ${api.config.lowStockLimit})`;
    if (location.hash === "#low") { state.filter = "low"; $("#filter").value = "low"; }

    ui.sortable($("#products-table"), (key, dir) => { state.sort = { key, dir }; render(); });
    $("#filter").addEventListener("change", (e) => { state.filter = e.target.value; render(); });
    $("#new-btn").addEventListener("click", () => { startNew(); $("#f-name").focus(); });
    $("#clear-btn").addEventListener("click", startNew);
    $("#product-form").addEventListener("submit", save);
    $("#products-table tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) edit(tr.dataset.id);
    });
    $("#products-table tbody").addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); edit(tr.dataset.id); }
    });
    window.addEventListener("smart:search", (e) => { state.search = e.detail; render(); });
    window.addEventListener("hashchange", () => {
      if (location.hash === "#low") { state.filter = "low"; $("#filter").value = "low"; render(); }
    });

    if (api.isPreview) {
      $("#save-btn").disabled = true;
      $("#save-btn").title = "Preview mode: nothing can be saved.";
    }
    await load();
    startNew();
  }

  init();
})();
