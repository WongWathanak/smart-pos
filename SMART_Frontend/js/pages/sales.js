/*
 * sales.js — Admin "View Sales History" (GET /sales).
 */
(function () {
  "use strict";
  const { api, ui, app } = window.SMART;
  const { $, $$, fmt, escapeHtml, messageRow, setMsg, icon } = ui;

  const state = { sales: [], search: "", sort: { key: "number", dir: "desc" }, selected: null };

  const items = (s) => s.lines.reduce((m, l) => m + l.quantity, 0);

  function visible() {
    const q = state.search.toLowerCase().replace(/^#/, "");
    const list = state.sales
      .map((s) => ({ ...s, items: items(s) }))
      .filter((s) => !q || String(s.number) === q || s.lines.some((l) => l.name.toLowerCase().includes(q)));
    return ui.sortBy(list, state.sort.key, state.sort.dir);
  }

  function render() {
    const list = visible();
    const total = list.reduce((t, s) => t + s.totalUsd, 0);
    $("#sales-sub").textContent = state.search
      ? `${list.length} of ${state.sales.length} sale(s) match "${state.search}" · ${fmt.usd(total)}`
      : `${state.sales.length} sale(s) · ${fmt.usd(total)} total`;
    const tbody = $("#sales-table tbody");
    if (!list.length) {
      messageRow(tbody, 5, state.sales.length ? "No sales match the search." : "No sales history found. No sales have been made yet.");
      showDetail(null);
      return;
    }
    tbody.innerHTML = list.map((s) =>
      `<tr tabindex="0" data-n="${s.number}" aria-selected="${s.number === state.selected}">` +
      `<td><span class="accent">${icon("receipt")}</span> #${s.number}</td>` +
      `<td title="${escapeHtml(s.lines.map((l) => `${l.name} ×${l.quantity}`).join("\n"))}">${escapeHtml(s.lines.map((l) => `${l.name} ×${l.quantity}`).join(", "))}</td>` +
      `<td class="num">${s.items}</td><td class="num accent">${fmt.usd(s.totalUsd)}</td>` +
      `<td class="num">${fmt.khr(s.totalUsd * api.config.khrPerUsd)}</td></tr>`
    ).join("");
    if (!list.some((s) => s.number === state.selected)) select(list[0].number);
  }

  function select(n) {
    state.selected = n;
    $$("#sales-table tbody tr[data-n]").forEach((tr) => tr.setAttribute("aria-selected", String(Number(tr.dataset.n) === n)));
    showDetail(state.sales.find((s) => s.number === n));
  }

  function showDetail(s) {
    $("#detail-title").textContent = s ? `Sale #${s.number}` : "Sale";
    $("#detail").textContent = s
      ? (s.raw || s.lines.map((l) => `${l.quantity}x ${l.name}`).join("\n") + `\nTOTAL_USD:${s.totalUsd}`) +
        `\n\nItems: ${items(s)}\nTotal: ${fmt.usd(s.totalUsd)}\n       ${fmt.khr(s.totalUsd * api.config.khrPerUsd)}`
      : state.sales.length ? "No sale selected." : "No sales recorded yet.";
  }

  async function load() {
    const btn = $("#reload-btn");
    btn.disabled = true;
    messageRow($("#sales-table tbody"), 5, "", true);
    setMsg($("#sales-msg"), "");
    try {
      state.sales = await api.getSales();
      render();
    } catch (err) {
      app.handleError(err, $("#sales-msg"));
      messageRow($("#sales-table tbody"), 5, "Could not load sales history.");
      $("#sales-sub").textContent = "";
    } finally {
      btn.disabled = false;
    }
  }

  async function init() {
    const started = await app.startPage({ page: "sales", role: "admin", searchPlaceholder: "Search sales by product or #" });
    if (!started) return;
    document.querySelectorAll("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
    ui.sortable($("#sales-table"), (key, dir) => { state.sort = { key, dir }; render(); });
    $("#sales-table tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-n]");
      if (tr) select(Number(tr.dataset.n));
    });
    $("#sales-table tbody").addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-n]");
      if (!tr) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(Number(tr.dataset.n)); }
      if (e.key === "ArrowDown" && tr.nextElementSibling) tr.nextElementSibling.focus();
      if (e.key === "ArrowUp" && tr.previousElementSibling) tr.previousElementSibling.focus();
    });
    $("#reload-btn").addEventListener("click", load);
    window.addEventListener("smart:search", (e) => { state.search = e.detail; render(); });
    await load();
  }

  init();
})();
