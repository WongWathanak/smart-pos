/*
 * login.js — the backend's welcome menu as a screen:
 * 1 ADMIN / 2 CASHIER, then username and password (POST /login).
 */
(function () {
  "use strict";
  const { api, ui, app, validation } = window.SMART;
  const { $, $$, setMsg, setBusy, escapeHtml } = ui;
  let role = "admin";

  async function init() {
    const { config, note } = await app.loadConfig();
    api.init(config);

    // Already logged in (same mode) → go straight to the home page.
    const s = api.session.get();
    if (s && s.mode === api.config.apiMode) {
      location.replace("pages/" + app.homeFor(s.role));
      return;
    }
    api.session.clear();

    const conn = $("#connection");
    if (api.isPreview) {
      conn.classList.add("preview");
      conn.innerHTML = `<span><strong>PREVIEW MODE</strong> — sample data, nothing is saved. Login is not checked. ${escapeHtml(note)}</span>`;
    } else {
      conn.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>SMART API: ${escapeHtml(api.config.apiBaseUrl)}</span>`;
    }

    $$(".segmented button").forEach((b) =>
      b.addEventListener("click", () => {
        role = b.dataset.role;
        $$(".segmented button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        $("#role-hint").textContent =
          role === "admin" ? "Sales history, daily summary and product management" : "Sell products and take payment";
        setMsg($("#login-msg"), "");
        $("#username").focus();
      })
    );

    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#login-btn");
      if (btn.disabled) return;                       // no double submit
      const user = $("#username").value;
      const pass = $("#password").value;
      const err = validation.credentials(user, pass);
      $("#username").setAttribute("aria-invalid", String(!!err && !user.trim()));
      $("#password").setAttribute("aria-invalid", String(!!err && !!user.trim()));
      if (err) return setMsg($("#login-msg"), err, "error");
      setBusy(btn, true);
      setMsg($("#login-msg"), "Checking…", "info");
      try {
        const s = await api.login(role, user.trim(), pass);
        location.href = "pages/" + app.homeFor(s.role);
      } catch (ex) {
        setBusy(btn, false);
        setMsg($("#login-msg"), ex.message, "error");
        $("#password").value = "";
        $("#password").focus();
      }
    });
    $("#username").focus();
  }

  init();
})();
