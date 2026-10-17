/*
 * app.js — start-up shared by every page:
 *   1. load config/config.json (falls back to Preview mode if it can't be read)
 *   2. set up the API layer
 *   3. check the login session and the role allowed on this page
 *   4. draw the header and sidebar
 */
(function (root) {
  "use strict";
  const SMART = (root.SMART = root.SMART || {});

  function rootPath() {
    return (root.document.body.dataset.root || ".").replace(/\/+$/, "");
  }

  async function loadConfig() {
    const base = rootPath();
    try {
      const res = await fetch(base + "/config/config.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { config: await res.json(), note: "" };
    } catch (e) {
      // Browsers block fetch() for pages opened from disk (file://).
      const fromDisk = root.location.protocol === "file:";
      return {
        config: { apiMode: "preview" },
        note: fromDisk
          ? "(Opened from disk, so config.json can't be read — run a local web server to use your API.)"
          : "(config/config.json could not be loaded.)",
      };
    }
  }

  function homeFor(role) {
    return role === "cashier" ? "cashier.html" : "dashboard.html";
  }

  const app = {
    rootPath,
    homeFor,
    loadConfig,

    /** For pages/*.html. role = "admin" or "cashier". Returns {session, config} or null (redirecting). */
    async startPage({ page, role, searchPlaceholder }) {
      const { config, note } = await loadConfig();
      SMART.api.init(config);
      const session = SMART.api.session.get();
      const base = rootPath();
      if (!session || session.mode !== SMART.api.config.apiMode) {
        SMART.api.session.clear();
        root.location.replace(base + "/index.html");
        return null;
      }
      if (session.role !== role) {           // e.g. a cashier opening an admin page
        root.location.replace(homeFor(session.role));
        return null;
      }
      SMART.navigation.render({ page, session, preview: SMART.api.isPreview, configNote: note, searchPlaceholder, rootPath: base });
      return { session, config: SMART.api.config };
    },

    /** Shows an API error; sends the user back to login if the session expired. */
    handleError(err, msgEl) {
      const message = (err && err.message) || "Something went wrong.";
      if (err && err.unauthorized) {
        SMART.api.session.clear();
        SMART.ui.toast("Your session has ended. Please log in again.", "error");
        setTimeout(() => root.location.replace(rootPath() + "/index.html"), 1200);
      }
      if (msgEl) SMART.ui.setMsg(msgEl, message, "error");
      return message;
    },
  };

  SMART.app = app;
})(typeof window !== "undefined" ? window : globalThis);
