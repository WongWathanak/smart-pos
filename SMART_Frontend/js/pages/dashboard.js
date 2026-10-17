/*
 * dashboard.js — Admin "View Daily Summary" laid out like the reference.
 * Data: GET /summary, GET /sales, GET /products (see docs/API_CONTRACT.md).
 */
(function () {
  "use strict";
  const { api, ui, app, charts, navigation } = window.SMART;
  const { $, fmt, escapeHtml, nameCell, pill, messageRow, icon } = ui;

  const state = { products: [], sales: [], summary: null, search: "" };

  function fillIcons() {
    document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
  }

  function renderKpis() {
    const s = state.summary;
    const items = state.sales.reduce((n, x) => n + x.lines.reduce((m, l) => m + l.quantity, 0), 0);
    const best = Math.max(0, ...state.sales.map((x) => x.totalUsd));
    ["#kpi-revenue", "#kpi-sales", "#kpi-avg"].forEach((id) => $(id).classList.remove("skeleton"));
    $("#kpi-revenue").textContent = fmt.usd(s.revenueUsd);
    $("#kpi-revenue-khr").textContent = fmt.khr(s.revenueKhr);
    $("#kpi-sales").textContent = fmt.int(s.transactions);
    $("#kpi-items").textContent = `${fmt.int(items)} items`;
    $("#kpi-avg").textContent = fmt.usd(s.transactions ? s.revenueUsd / s.transactions : 0);
    $("#kpi-max").textContent = "max " + fmt.usd(best);
  }

  function renderChart() {
    const limit = Number($("#range").value);
    const list = limit > 0 ? state.sales.slice(-limit) : state.sales;
    let running = state.sales.slice(0, state.sales.length - list.length).reduce((t, x) => t + x.totalUsd, 0);
    const cumulative = list.map((x) => (running += x.totalUsd));
    charts.lineChart($("#perf-chart"), {
      ariaLabel: "Sales performance per sale",
      series: [
        { name: "Sale total", color: "var(--green)", values: list.map((x) => x.totalUsd) },
        { name: "Running revenue", color: "var(--blue)", values: cumulative },
      ],
      labels: list.map((x) => "#" + String(x.number).padStart(2, "0")),
      tips: list.map((x) => `Sale #${x.number} · ${x.lines.reduce((m, l) => m + l.quantity, 0)} item(s)`),
      format: fmt.usd,
      emptyText: "No sales recorded yet",
    });
  }

  function renderStock() {
    const low = Number($("#threshold").value);
    let inN = 0, lowN = 0, outN = 0;
    state.products.forEach((p) => (p.stock <= 0 ? outN++ : p.stock <= low ? lowN++ : inN++));
    charts.donut($("#stock-donut"), [
      { label: "In stock", value: inN, color: "var(--green)" },
      { label: "Low", value: lowN, color: "var(--green-light)" },
      { label: "Out", value: outN, color: "var(--blue)", text: "#fff" },
    ], String(state.products.length), "Products");
    $("#stock-legend").innerHTML =
      `<span style="--dot:var(--green)">In stock (${inN})</span>` +
      `<span style="--dot:var(--green-light)">Low (${lowN})</span>` +
      `<span style="--dot:var(--blue)">Out (${outN})</span>`;

    const q = state.search.toLowerCase();
    const alerts = state.products
      .filter((p) => p.stock <= low && (!q || p.name.toLowerCase().includes(q) || p.id.includes(q)))
      .sort((a, b) => a.stock - b.stock);
    const box = $("#alerts");
    if (!alerts.length) {
      box.innerHTML = `<p class="card-note">${state.products.length ? `No products at or below ${low} units.` : "No products."}</p>`;
      return;
    }
    box.innerHTML = alerts.slice(0, 5).map((p) =>
      `<div class="list-row">${ui.avatar(p.name)}<span class="name" title="ID ${escapeHtml(p.id)}">${escapeHtml(p.name)}</span><span class="count-box">${p.stock}</span></div>`
    ).join("") + (alerts.length > 5 ? `<p class="card-note"><a href="products.html#low">+ ${alerts.length - 5} more low-stock product(s)</a></p>` : "");
  }

  function renderTop() {
    const low = Number($("#threshold").value);
    const qty = new Map();
    state.sales.forEach((s) => s.lines.forEach((l) => {
      const k = l.name.toLowerCase();
      qty.set(k, { name: l.name, quantity: (qty.get(k)?.quantity || 0) + l.quantity });
    }));
    const q = state.search.toLowerCase();
    const rows = [...qty.values()].filter((r) => !q || r.name.toLowerCase().includes(q)).sort((a, b) => b.quantity - a.quantity);
    const tbody = $("#top-table tbody");
    if (!rows.length) return messageRow(tbody, 4, state.sales.length ? "No products match the search." : "No sales recorded yet.");
    tbody.innerHTML = rows.map((r) => {
      const p = state.products.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
      return `<tr><td>${nameCell(r.name)}</td><td class="num">${fmt.int(r.quantity)}</td>` +
        `<td class="num">${p ? fmt.usd(p.price * r.quantity) : "—"}</td>` +
        `<td>${p ? pill(p.stock, low) : '<span class="pill out">Not in product list</span>'}</td></tr>`;
    }).join("");
  }

  function renderRecent() {
    const tbody = $("#recent-table tbody");
    const last = state.sales.slice(-4).reverse();
    if (!last.length) messageRow(tbody, 3, "No sales yet.");
    else tbody.innerHTML = last.map((s) =>
      `<tr><td class="muted">${icon("receipt")} #${s.number}</td><td class="muted num">${s.lines.reduce((m, l) => m + l.quantity, 0)}</td><td class="num">${fmt.usd(s.totalUsd)}</td></tr>`
    ).join("");
    $("#recent-items").textContent = fmt.int(state.sales.reduce((n, x) => n + x.lines.reduce((m, l) => m + l.quantity, 0), 0));
    $("#recent-total").textContent = fmt.usd(state.sales.reduce((t, x) => t + x.totalUsd, 0));
  }

  function renderAll() {
    renderKpis();
    renderChart();
    renderStock();
    renderTop();
    renderRecent();
  }

  async function load() {
    messageRow($("#top-table tbody"), 4, "", true);
    messageRow($("#recent-table tbody"), 3, "", true);
    try {
      const [summary, sales, products] = await Promise.all([api.getSummary(), api.getSales(), api.getProducts()]);
      Object.assign(state, { summary, sales, products });
      navigation.setProducts(products);
      $("#dash-msg").hidden = true;
      renderAll();
    } catch (err) {
      const box = $("#dash-msg");
      box.hidden = false;
      app.handleError(err, box);
      messageRow($("#top-table tbody"), 4, "Could not load data.");
      messageRow($("#recent-table tbody"), 3, "Could not load data.");
    }
  }

  async function init() {
    const started = await app.startPage({ page: "dashboard", role: "admin", searchPlaceholder: "Search products" });
    if (!started) return;
    fillIcons();
    $("#range").addEventListener("change", () => state.summary && renderChart());
    $("#threshold").addEventListener("change", () => state.summary && (renderStock(), renderTop()));
    window.addEventListener("smart:search", (e) => {
      state.search = e.detail;
      if (state.summary) { renderStock(); renderTop(); }
    });
    await load();
  }

  init();
})();
