/*
 * ui.js — small shared UI helpers: icons, formatting, dialogs, toasts,
 * table rows, avatars and stock status. No data access here (see api.js).
 */
(function (root) {
  "use strict";
  const SMART = (root.SMART = root.SMART || {});
  const doc = root.document;

  // ------------------------------------------------------------------ icons
  // Line icons on a 24x24 grid; colour follows the text colour (currentColor).
  const ICONS = {
    home: '<path d="M4 11 12 4l8 7v9H4z" class="fill"/>',
    receipt: '<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    box: '<path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4z"/><path d="M3.8 7.6 12 12l8.2-4.4M12 12v9M7.8 5.2l8.4 4.6"/>',
    cart: '<path d="M2.5 4h3L8 15.5h10.5l2-8H6.6"/><circle cx="9.5" cy="19.5" r="1.4" class="fill"/><circle cx="17" cy="19.5" r="1.4" class="fill"/>',
    logout: '<path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/><path d="M4 12h10.5M4 12l4-4M4 12l4 4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    menu: '<path d="M4 6h16M4 12h11M4 18h16"/>',
    bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 1.5h-15z"/><path d="M10 21h4"/>',
    chart: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 16v-4M12 16V8M15.5 16v-5"/>',
    dollar: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M14.6 8.8c-.6-1-1.6-1.3-2.6-1.3-1.6 0-2.6.8-2.6 2 0 2.8 5.4 1.5 5.4 4.8 0 1.3-1.2 2.1-2.8 2.1-1.2 0-2.2-.4-2.8-1.4M12 5.8v1.7M12 16.4v1.8"/>',
    coins: '<circle cx="12" cy="12" r="5.2"/><path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M12 9v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9.5 7 10 4h4l.5 3M6 7l1 13h10l1-13"/>',
    check: '<path d="m5 12.5 5 5 9.5-10.5"/>',
    refresh: '<path d="M18.5 9A7 7 0 1 0 19 13"/><path d="M18.5 4.5V9H14"/>',
  };
  function icon(name, extraClass) {
    const body = (ICONS[name] || "").replace(/class="fill"/g, 'fill="currentColor"');
    return `<svg class="icon ${extraClass || ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  // ------------------------------------------------------------- formatting
  const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmt = {
    usd: (v) => (v < 0 ? "-$" : "$") + nf2.format(Math.abs(Number(v) || 0)),
    khr: (v) => "KHR " + nf0.format(Math.round(Number(v) || 0)),
    int: (v) => nf0.format(Number(v) || 0),
  };

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const $ = (sel, rootEl) => (rootEl || doc).querySelector(sel);
  const $$ = (sel, rootEl) => Array.from((rootEl || doc).querySelectorAll(sel));

  // ------------------------------------------------------- product helpers
  function hash(s) {
    let h = 0;
    for (const ch of String(s).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }
  function avatar(name) {
    const letter = escapeHtml((String(name || "?").replace(/^sample_/, "")[0] || "?").toUpperCase());
    return `<span class="mini-avatar c${hash(name) % 4}" aria-hidden="true">${letter}</span>`;
  }
  function nameCell(name) {
    return `<span class="name-cell">${avatar(name)}<span>${escapeHtml(name)}</span></span>`;
  }
  function stockStatus(stock, low) {
    if (stock <= 0) return { label: "Out of stock", cls: "out" };
    if (stock <= low) return { label: "Low stock", cls: "low" };
    return { label: "In stock", cls: "in" };
  }
  function pill(stock, low) {
    const s = stockStatus(stock, low);
    return `<span class="pill ${s.cls}">${s.label}</span>`;
  }

  /** One full-width message row (loading, empty, error). */
  function messageRow(tbody, cols, text, loading) {
    tbody.innerHTML = `<tr class="empty"><td colspan="${cols}">${loading ? '<span class="skeleton">Loading data…</span>' : escapeHtml(text)}</td></tr>`;
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg " + (kind || "info");
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = !!busy;
    button.classList.toggle("loading", !!busy);
    button.setAttribute("aria-busy", busy ? "true" : "false");
  }

  // ------------------------------------------------------- dialogs & toasts
  function modal({ title, html, buttons, details }) {
    return new Promise((resolve) => {
      const d = doc.createElement("dialog");
      d.className = "modal";
      d.setAttribute("aria-labelledby", "modal-title");
      d.innerHTML =
        `<div class="modal-body"><h2 id="modal-title">${escapeHtml(title)}</h2>${html || ""}` +
        (details ? `<details><summary>Details</summary><pre class="receipt-text">${escapeHtml(details)}</pre></details>` : "") +
        `</div><div class="modal-actions"></div>`;
      const actions = d.querySelector(".modal-actions");
      (buttons || [{ label: "OK", value: true, primary: true }]).forEach((b) => {
        const el = doc.createElement("button");
        el.type = "button";
        el.className = "btn " + (b.primary ? "btn-primary" : "btn-secondary");
        el.textContent = b.label;
        el.addEventListener("click", () => d.close(String(b.value)));
        actions.appendChild(el);
      });
      d.addEventListener("close", () => {
        const v = d.returnValue;
        d.remove();
        resolve(v === "true" ? true : v === "false" || v === "" ? false : v);
      });
      doc.body.appendChild(d);
      d.showModal();
      const primary = actions.querySelector(".btn-primary");
      if (primary) primary.focus();
    });
  }
  const dialogs = {
    confirm: (title, message, confirmLabel) =>
      modal({
        title,
        html: `<p>${escapeHtml(message)}</p>`,
        buttons: [{ label: "Cancel", value: false }, { label: confirmLabel || "Confirm", value: true, primary: true }],
      }),
    alert: (title, message) => modal({ title, html: `<p>${escapeHtml(message)}</p>` }),
    html: (title, html) => modal({ title, html }),
  };

  function toast(message, kind) {
    let box = $(".toasts");
    if (!box) {
      box = doc.createElement("div");
      box.className = "toasts";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      doc.body.appendChild(box);
    }
    const t = doc.createElement("div");
    t.className = "toast " + (kind || "ok");
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), kind === "error" ? 7000 : 4000);
  }

  /** Makes table headers with data-sort clickable. onSort(key, dir). */
  function sortable(table, onSort) {
    $$("th[data-sort]", table).forEach((th) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "th-sort";
      b.textContent = th.textContent;
      th.textContent = "";
      th.appendChild(b);
      b.addEventListener("click", () => {
        const dir = b.dataset.dir === "asc" ? "desc" : "asc";
        $$(".th-sort", table).forEach((x) => delete x.dataset.dir);
        b.dataset.dir = dir;
        th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
        onSort(th.dataset.sort, dir);
      });
    });
  }
  function sortBy(list, key, dir) {
    const m = dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = a[key], y = b[key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * m;
    });
  }

  SMART.ui = { icon, fmt, escapeHtml, $, $$, avatar, nameCell, stockStatus, pill, messageRow, setMsg, setBusy,
               dialogs, toast, sortable, sortBy };
})(typeof window !== "undefined" ? window : globalThis);
