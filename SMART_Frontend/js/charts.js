/*
 * charts.js — the two charts from the reference, drawn as inline SVG:
 *   lineChart: area/line chart with dashed grid and a hover tooltip
 *   donut:     ring chart with a centre value and % labels
 * Colours are CSS custom properties, e.g. "var(--green)".
 */
(function (root) {
  "use strict";
  const SMART = (root.SMART = root.SMART || {});
  const NS = "http://www.w3.org/2000/svg";

  function niceMax(max) {
    if (max <= 0) return 10;
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    for (const s of [1, 2, 2.5, 5, 10]) if (s * mag >= max * 1.1) return s * mag;
    return 10 * mag;
  }
  function short(v) {
    if (v >= 1e6) return +(v / 1e6).toPrecision(3) + "M";
    if (v >= 1e3) return +(v / 1e3).toPrecision(3) + "k";
    return String(+v.toPrecision(4));
  }

  /**
   * opts: { series: [{name, color, values[]}], labels: [], tips: [], format(v), emptyText }
   */
  function lineChart(container, opts) {
    const { escapeHtml } = SMART.ui;
    // Draw at the real pixel width so text is never stretched; redraw on resize.
    if (!container._chartObserver && typeof ResizeObserver !== "undefined") {
      let lastW = container.clientWidth;
      container._chartObserver = new ResizeObserver(() => {
        if (Math.abs(container.clientWidth - lastW) > 4 && container._chartOpts) {
          lastW = container.clientWidth;
          lineChart(container, container._chartOpts);
        }
      });
      container._chartObserver.observe(container);
    }
    container._chartOpts = opts;
    const W = Math.max(320, container.clientWidth - 28 || 900), H = 300, L = 48, R = 16, T = 12, B = 40;
    const pw = W - L - R, ph = H - T - B;
    const n = opts.labels.length;
    const max = niceMax(Math.max(0, ...opts.series.flatMap((s) => s.values)));
    const x = (i) => (n <= 1 ? L + pw / 2 : L + 14 + ((pw - 28) * i) / (n - 1));
    const y = (v) => T + ph - (v / max) * ph;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel || "Chart")}">`;
    svg += '<defs>' + opts.series.map((s, k) =>
      `<linearGradient id="g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.28"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`).join("") + "</defs>";
    svg += '<g class="grid">';
    for (let i = 0; i <= 5; i++) {
      const yy = T + ph - (ph * i) / 5;
      svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    }
    svg += '</g><g class="axis">';
    for (let i = 0; i <= 5; i++) {
      const yy = T + ph - (ph * i) / 5;
      svg += `<text x="${L - 10}" y="${yy + 4}" text-anchor="end">${short((max * i) / 5)}</text>`;
    }
    const step = Math.max(1, Math.ceil(n / 12));
    for (let i = 0; i < n; i += step) svg += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">${escapeHtml(opts.labels[i])}</text>`;
    svg += "</g>";

    if (n === 0) {
      svg += `<text class="empty" x="${L + pw / 2}" y="${T + ph / 2}" text-anchor="middle">${escapeHtml(opts.emptyText || "No data yet")}</text>`;
    } else {
      [...opts.series].reverse().forEach((s) => {
        const k = opts.series.indexOf(s);
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
        if (n > 1) svg += `<path d="M${pts.join("L")}L${x(n - 1)},${T + ph}L${x(0)},${T + ph}Z" fill="url(#g${k})"/>`;
        svg += `<polyline points="${pts.join(" ")}" fill="none" style="stroke:${s.color}" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
        if (n <= 30) s.values.forEach((v, i) => {
          svg += `<circle cx="${x(i)}" cy="${y(v)}" r="3.4" style="fill:var(--surface);stroke:${s.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
        });
      });
      svg += `<line class="hover-line" x1="0" x2="0" y1="${T}" y2="${T + ph}" style="stroke:var(--green)" stroke-dasharray="3 4" visibility="hidden" vector-effect="non-scaling-stroke"/>`;
    }
    svg += "</svg>";
    container.innerHTML = svg + '<div class="chart-tip" hidden></div>';
    if (n === 0) return;

    const el = container.querySelector("svg");
    const tip = container.querySelector(".chart-tip");
    const line = el.querySelector(".hover-line");
    el.addEventListener("mousemove", (ev) => {
      const rect = el.getBoundingClientRect();
      const vx = ((ev.clientX - rect.left) / rect.width) * W;
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(x(i) - vx) < Math.abs(x(best) - vx)) best = i;
      line.setAttribute("x1", x(best));
      line.setAttribute("x2", x(best));
      line.setAttribute("visibility", "visible");
      const f = opts.format || String;
      tip.innerHTML = `<div class="t">${escapeHtml(opts.tips ? opts.tips[best] : opts.labels[best])}</div>` +
        opts.series.map((s, k) => `<div class="${k ? "v2" : "v"}">${escapeHtml(s.name)}: ${escapeHtml(f(s.values[best]))}</div>`).join("");
      tip.hidden = false;
      const px = (x(best) / W) * rect.width;
      const left = px + 18 + tip.offsetWidth > rect.width ? px - 18 - tip.offsetWidth : px + 18;
      tip.style.left = left + "px";
      tip.style.top = Math.max(0, (y(opts.series[0].values[best]) / H) * rect.height - tip.offsetHeight / 2) + "px";
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; line.setAttribute("visibility", "hidden"); });
  }

  /** segments: [{label, value, color}] */
  function donut(container, segments, centerValue, caption) {
    const { escapeHtml } = SMART.ui;
    const C = 140, r = 104, w = 44;
    const total = segments.reduce((s, x) => s + x.value, 0);
    let svg = `<svg viewBox="0 0 280 280" role="img" aria-label="${escapeHtml(caption)}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}">`;
    svg += `<circle cx="${C}" cy="${C}" r="${r}" fill="none" style="stroke:var(--surface-high)" stroke-width="${w * 0.78}"/>`;
    let start = -90;
    segments.forEach((s, i) => {
      if (!total || s.value <= 0) return;
      const span = (360 * s.value) / total;
      const gap = span < 359 ? 1.2 : 0;
      const a0 = ((start + gap) * Math.PI) / 180, a1 = ((start + span - gap) * Math.PI) / 180;
      const large = span - 2 * gap > 180 ? 1 : 0;
      const sw = i === 0 ? w : w * 0.86;
      if (span >= 359.9) {
        svg += `<circle cx="${C}" cy="${C}" r="${r}" fill="none" style="stroke:${s.color}" stroke-width="${sw}"/>`;
      } else {
        svg += `<path d="M${C + r * Math.cos(a0)} ${C + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${C + r * Math.cos(a1)} ${C + r * Math.sin(a1)}" fill="none" style="stroke:${s.color}" stroke-width="${sw}"/>`;
      }
      if (span >= 22) {
        const mid = ((start + span / 2) * Math.PI) / 180;
        svg += `<text class="pct" x="${C + r * Math.cos(mid)}" y="${C + r * Math.sin(mid) + 4}" text-anchor="middle" style="fill:${s.text || "var(--on-green)"}">${((100 * s.value) / total).toFixed(1)}%</text>`;
      }
      start += span;
    });
    svg += `<circle cx="${C}" cy="${C}" r="${r - w * 0.8}" style="fill:var(--surface-alt)"/>`;
    svg += `<text class="center-value" x="${C}" y="${C}" text-anchor="middle">${escapeHtml(centerValue)}</text>`;
    svg += `<text class="center-caption" x="${C}" y="${C + 30}" text-anchor="middle">${escapeHtml(caption)}</text></svg>`;
    container.innerHTML = svg;
  }

  SMART.charts = { lineChart, donut, niceMax };
})(typeof window !== "undefined" ? window : globalThis);
