/*
 * navigation.js — builds the shared shell of every logged-in page:
 * header (logo, menu, search, low-stock bell, user) and the icon sidebar.
 *
 * Which pages a role sees follows the backend menus:
 *   ADMIN   → 1 View Sales History, 2 View Daily Summary, 3 Manage Products, 4 Logout
 *   CASHIER → the sale screen (cashier_mainMenu)
 */
(function (root) {
  "use strict";
  const SMART = (root.SMART = root.SMART || {});

  const NAV = {
    admin: [
      { id: "dashboard", href: "dashboard.html", icon: "home", label: "Daily Summary" },
      { id: "sales", href: "sales.html", icon: "receipt", label: "Sales History" },
      { id: "products", href: "products.html", icon: "box", label: "Manage Products" },
    ],
    cashier: [{ id: "cashier", href: "cashier.html", icon: "cart", label: "New Sale" }],
  };

  let lowStock = [];
  let loaded = false;   // product list received from the API yet?

  function render({ page, session, preview, configNote, searchPlaceholder, rootPath }) {
    const { icon, escapeHtml, $, dialogs } = SMART.ui;
    const role = session.role === "cashier" ? "cashier" : "admin";
    const header = $("#app-header");
    header.innerHTML = `
      <a class="brand" href="${NAV[role][0].href}" aria-label="SMART home">
        <span class="logo-tile"><img src="${rootPath}/assets/images/smart_logo.png" alt="SMART — Sales Management and Retail Tracking" width="72" height="72"></span>
        <span class="brand-text"><span class="brand-title">SMART</span>
          <span class="brand-sub">${role === "admin" ? "Admin panel" : "Cashier"}</span></span>
      </a>
      <button class="menu-btn" type="button" id="menu-btn" aria-label="Show or hide the sidebar" aria-controls="sidebar" aria-expanded="true">${icon("menu")}</button>
      <div class="search" role="search">
        ${icon("search")}
        <label class="visually-hidden" for="global-search">Search</label>
        <input id="global-search" type="search" placeholder="${escapeHtml(searchPlaceholder || "Search here")}" autocomplete="off">
      </div>
      <div class="header-actions">
        ${role === "admin" ? `<div style="position:relative">
          <button class="icon-btn" type="button" id="bell-btn" aria-haspopup="true" aria-expanded="false" aria-label="Low stock alerts">
            ${icon("bell")}<span class="badge" id="bell-badge" hidden>0</span></button>
          <div class="popover" id="bell-pop" hidden></div></div>` : ""}
        <div class="user-chip">
          <span class="avatar" aria-hidden="true">${escapeHtml((session.username || "?")[0].toUpperCase())}</span>
          <span class="user-text"><div class="user-name">${escapeHtml(session.username)}</div>
            <div class="user-role">${role === "admin" ? "Administrator" : "Cashier"}</div></span>
        </div>
      </div>`;

    const banner = $("#preview-banner");
    if (preview) {
      banner.className = "preview-banner";
      banner.setAttribute("role", "note");
      banner.textContent =
        "PREVIEW MODE — sample data only. Nothing you do here is saved." + (configNote ? " " + configNote : "");
    } else {
      banner.remove();
    }

    const sidebar = $("#sidebar");
    sidebar.innerHTML =
      `<ul class="nav">` +
      NAV[role].map((n) =>
        `<li><a class="nav-link" href="${n.href}" title="${n.label}" aria-label="${n.label}"${n.id === page ? ' aria-current="page"' : ""}>${icon(n.icon)}</a></li>`
      ).join("") +
      `</ul><button class="logout-btn" type="button" id="logout-btn" title="Log out" aria-label="Log out">${icon("logout")}</button>`;

    // Sidebar toggle
    $("#menu-btn").addEventListener("click", (e) => {
      const collapsed = sidebar.classList.toggle("collapsed");
      e.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    });

    // Search → pages listen for "smart:search"
    $("#global-search").addEventListener("input", (e) =>
      root.dispatchEvent(new CustomEvent("smart:search", { detail: e.target.value.trim() })));

    // Logout = admin menu 4
    $("#logout-btn").addEventListener("click", async () => {
      if (!(await dialogs.confirm("Log out", "Log out of SMART?", "Log out"))) return;
      try { await SMART.api.logout(); } catch (e) { /* session is cleared anyway */ }
      root.location.href = rootPath + "/index.html";
    });

    // Bell
    const bell = $("#bell-btn");
    if (bell) {
      const pop = $("#bell-pop");
      bell.addEventListener("click", () => {
        const open = pop.hidden;
        pop.hidden = !open;
        bell.setAttribute("aria-expanded", String(open));
        if (open) renderBell();
      });
      root.document.addEventListener("click", (e) => {
        if (!pop.hidden && !pop.contains(e.target) && !bell.contains(e.target)) {
          pop.hidden = true;
          bell.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  function renderBell() {
    const { $, escapeHtml, avatar } = SMART.ui;
    const pop = $("#bell-pop");
    if (!pop) return;
    const limit = SMART.api.config.lowStockLimit;
    pop.innerHTML = `<h3>Low stock (≤ ${limit} units)</h3><ul>` +
      (!loaded ? "<li>Loading…</li>" : lowStock.length ? lowStock.slice(0, 8).map((p) =>
        `<li>${avatar(p.name)}<span class="n">${escapeHtml(p.name)}</span><strong>${p.stock}</strong></li>`).join("")
        : "<li>All products are well stocked.</li>") +
      `</ul><a href="products.html#low">Open in Manage Products</a>`;
  }

  /** Called by pages after they load products from the API. */
  function setProducts(products) {
    const limit = SMART.api.config.lowStockLimit;
    lowStock = products.filter((p) => p.stock <= limit).sort((a, b) => a.stock - b.stock);
    loaded = true;
    const pop = SMART.ui.$("#bell-pop");
    if (pop && !pop.hidden) renderBell();
    const badge = SMART.ui.$("#bell-badge");
    if (badge) {
      badge.textContent = lowStock.length;
      badge.hidden = lowStock.length === 0;
    }
  }

  SMART.navigation = { NAV, render, setProducts };
})(typeof window !== "undefined" ? window : globalThis);
