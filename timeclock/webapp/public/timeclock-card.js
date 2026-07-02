/**
 * timeclock-card — custom dashboard card for the Time Clock add-on.
 *
 * Reads everything from sensor.timeclock_summary (pushed by the add-on):
 * live status per person, today/week/month/quarter/year totals, a 42-day
 * daily series, a 26-week series, and recent punches. Clock in/out buttons
 * call rest_command.timeclock_punch (installed by the add-on's package).
 *
 * No dependencies, no build step. Install: Admin → Settings → Integration,
 * then add resource /local/timeclock-card.js (module) and a manual card:
 *   type: custom:timeclock-card
 */
"use strict";

const CARD_VERSION = "1.1.0";
const PALETTE = ["#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f472b6", "#facc15", "#22d3ee", "#f87171"];

const fmtMin = (min) => {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m % 60}m`;
};
const fmtH = (min) => (min / 60).toFixed(1) + "h";
const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const dayLabel = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

class TimeclockCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "today";
    this._graph = "daily";
    this._logFilter = null;
    this._pending = {};
  }

  static getStubConfig() {
    return { entity: "sensor.timeclock_summary" };
  }

  setConfig(config) {
    this._config = {
      entity: "sensor.timeclock_summary",
      history_entity: "sensor.timeclock_history",
      title: "Time Clock",
      show_seconds: false,
      ...config,
    };
  }

  getCardSize() {
    return 6;
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config.entity];
    const hi = hass.states[this._config.history_entity];
    const stamp = (st ? st.last_updated + st.state : "missing") + (hi ? hi.last_updated : "");
    if (stamp !== this._stamp || !this._rendered) {
      this._stamp = stamp;
      this._render();
    }
    this._ensureTicker();
  }

  connectedCallback() {
    this._ensureTicker();
  }
  disconnectedCallback() {
    clearInterval(this._ticker);
    this._ticker = null;
  }

  _ensureTicker() {
    if (this._ticker) return;
    // Live totals: re-render every 30s while anyone is clocked in.
    this._ticker = setInterval(() => {
      const d = this._data();
      if (d && d.employees.some((e) => e.status !== "out")) this._render();
    }, 30_000);
  }

  /**
   * Summary sensor carries slim live data; the graph/punch series live on the
   * separate history sensor (pushed less often, recorder-friendly). Merge by
   * employee id; default to empty series when history hasn't arrived yet.
   */
  _data() {
    const st = this._hass && this._hass.states[this._config.entity];
    if (!st || !st.attributes.employees) return null;
    const hist = this._hass.states[this._config.history_entity];
    const byId = {};
    ((hist && hist.attributes.employees) || []).forEach((e) => (byId[e.id] = e));
    return {
      ...st.attributes,
      updated: st.attributes.updated || st.last_updated,
      employees: st.attributes.employees.map((e) => ({
        daily: [],
        weekly: [],
        punches: [],
        ...e,
        ...(byId[e.id] || {}),
      })),
    };
  }

  /** Live minutes: attribute totals age while clocked in (breaks don't count). */
  _live(e, base, updated) {
    if (e.status !== "in") return base;
    return base + Math.max(0, (Date.now() - new Date(updated).getTime()) / 60_000);
  }

  _color(i) {
    return PALETTE[i % PALETTE.length];
  }

  async _punch(employeeId, action, btn) {
    if (this._pending[employeeId]) return;
    this._pending[employeeId] = true;
    if (btn) btn.classList.add("busy");
    try {
      await this._hass.callService("rest_command", "timeclock_punch", {
        employee: employeeId,
        action,
      });
    } catch (err) {
      this._toast(
        "Punch failed — is the Time Clock package installed? (Admin → Settings → Integration)",
      );
      console.error("timeclock-card punch failed", err);
    }
    // The add-on pushes fresh sensor state ~2s after a punch.
    setTimeout(() => {
      this._pending[employeeId] = false;
      this._render();
    }, 3000);
  }

  _toast(msg) {
    const el = this.shadowRoot.querySelector(".toast");
    if (el) {
      el.textContent = msg;
      el.classList.add("show");
      setTimeout(() => el.classList.remove("show"), 4000);
    }
  }

  // ---------------------------------------------------------------- render
  _render() {
    this._rendered = true;
    const d = this._data();
    if (!d) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px">
        <b>Time Clock</b><br>Waiting for <code>${esc(this._config.entity)}</code>…<br>
        <small>Start the Time Clock add-on (it pushes this sensor), then reload.</small>
      </div></ha-card>`;
      return;
    }
    const tabs = ["today", "logs", "totals", "graphs"]
      .map(
        (t) =>
          `<button class="tab ${this._tab === t ? "on" : ""}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`,
      )
      .join("");

    let body = "";
    if (this._tab === "today") body = this._renderToday(d);
    else if (this._tab === "logs") body = this._renderLogs(d);
    else if (this._tab === "totals") body = this._renderTotals(d);
    else body = this._renderGraphs(d);

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <ha-card>
        <div class="head">
          <div class="title">${esc(this._config.title)}</div>
          <div class="sub">${d.clockedIn} clocked in</div>
        </div>
        <div class="tabs">${tabs}</div>
        <div class="body">${body}</div>
        <div class="toast"></div>
      </ha-card>`;

    this.shadowRoot.querySelectorAll(".tab").forEach((b) =>
      b.addEventListener("click", () => {
        this._tab = b.dataset.tab;
        this._render();
      }),
    );
    this.shadowRoot.querySelectorAll("[data-punch]").forEach((b) =>
      b.addEventListener("click", () => {
        const [id, action] = b.dataset.punch.split("|");
        this._punch(id, action, b);
      }),
    );
    this.shadowRoot.querySelectorAll("[data-graph]").forEach((b) =>
      b.addEventListener("click", () => {
        this._graph = b.dataset.graph;
        this._render();
      }),
    );
    this.shadowRoot.querySelectorAll("[data-logfilter]").forEach((b) =>
      b.addEventListener("click", () => {
        const v = b.dataset.logfilter;
        this._logFilter = v === "*" ? null : v;
        this._render();
      }),
    );
  }

  _renderToday(d) {
    return `<div class="people">${d.employees
      .map((e, i) => {
        const liveToday = this._live(e, e.todayMin, d.updated);
        const badge =
          e.status === "in"
            ? `<span class="badge in">on the clock</span>`
            : e.status === "break"
              ? `<span class="badge break">on break</span>`
              : `<span class="badge out">off</span>`;
        const since =
          e.status !== "out" && e.since
            ? `<div class="since">${e.status === "break" ? "break" : "in"} since ${fmtTime(e.since)}${e.job ? " · " + esc(e.job) : ""}</div>`
            : `<div class="since">${e.punches[0] && e.punches[0].out ? "last out " + fmtTime(e.punches[0].out) : "no punches yet"}</div>`;
        const busy = this._pending[e.id] ? "busy" : "";
        const btn =
          e.status === "out"
            ? `<button class="punch in ${busy}" data-punch="${e.id}|in">Clock in</button>`
            : `<button class="punch out ${busy}" data-punch="${e.id}|out">Clock out</button>`;
        return `
        <div class="person ${e.status}">
          <div class="avatar" style="--pc:${this._color(i)}">${esc(e.name.slice(0, 2).toUpperCase())}</div>
          <div class="info">
            <div class="name">${esc(e.name)} ${badge}</div>
            ${since}
          </div>
          <div class="today">
            <div class="big">${fmtMin(liveToday)}</div>
            <div class="lbl">today · ${fmtH(this._live(e, e.weekMin, d.updated))} wk</div>
          </div>
          ${btn}
        </div>`;
      })
      .join("")}</div>`;
  }

  _renderLogs(d) {
    const filters = [`<button class="pill ${!this._logFilter ? "on" : ""}" data-logfilter="*">All</button>`]
      .concat(
        d.employees.map(
          (e, i) =>
            `<button class="pill ${this._logFilter === e.id ? "on" : ""}" data-logfilter="${e.id}" style="--pc:${this._color(i)}">${esc(e.name)}</button>`,
        ),
      )
      .join("");
    const rows = d.employees
      .flatMap((e, i) =>
        e.punches.map((p) => ({ e, i, p })),
      )
      .filter((r) => !this._logFilter || r.e.id === this._logFilter)
      .sort((a, b) => new Date(b.p.in) - new Date(a.p.in))
      .slice(0, 30)
      .map(
        ({ e, i, p }) => `
        <tr>
          <td><span class="dot" style="background:${this._color(i)}"></span>${esc(e.name)}</td>
          <td>${fmtDate(p.in)}</td>
          <td>${fmtTime(p.in)} → ${p.out ? fmtTime(p.out) : '<span class="badge in">open</span>'}</td>
          <td class="num">${fmtMin(p.min)}</td>
          <td>${p.job ? esc(p.job) : ""}${p.edited ? ' <span class="badge edit">edited</span>' : ""}</td>
        </tr>`,
      )
      .join("");
    return `<div class="pills">${filters}</div>
      <table class="logs">
        <thead><tr><th>Who</th><th>Day</th><th>Punch</th><th class="num">Worked</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">No punches yet.</td></tr>`}</tbody>
      </table>
      <div class="hint">Full history & exports live in the add-on panel (Manager → Pay periods).</div>`;
  }

  _renderTotals(d) {
    const rows = d.employees
      .map(
        (e, i) => `
      <tr>
        <td><span class="dot" style="background:${this._color(i)}"></span>${esc(e.name)}</td>
        <td class="num">${fmtH(this._live(e, e.todayMin, d.updated))}</td>
        <td class="num">${fmtH(this._live(e, e.weekMin, d.updated))}</td>
        <td class="num">${fmtH(this._live(e, e.monthMin, d.updated))}</td>
        <td class="num">${fmtH(this._live(e, e.quarterMin, d.updated))}</td>
        <td class="num">${fmtH(this._live(e, e.yearMin, d.updated))}</td>
      </tr>`,
      )
      .join("");
    return `<table class="logs totals">
      <thead><tr><th>Who</th><th class="num">Today</th><th class="num">Week</th><th class="num">Month</th><th class="num">Quarter</th><th class="num">Year</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ---------------------------------------------------------------- graphs
  _renderGraphs(d) {
    const kinds = [
      ["daily", "Daily (6 wks)"],
      ["weekly", "Trend (26 wks)"],
      ["punchmap", "Punch map"],
      ["race", "Year race"],
    ];
    const pills = kinds
      .map(
        ([k, l]) =>
          `<button class="pill ${this._graph === k ? "on" : ""}" data-graph="${k}">${l}</button>`,
      )
      .join("");
    const legend = d.employees
      .map(
        (e, i) =>
          `<span class="lg"><span class="dot" style="background:${this._color(i)}"></span>${esc(e.name)}</span>`,
      )
      .join("");
    let svg = "";
    if (this._graph === "daily") svg = this._svgDaily(d);
    else if (this._graph === "weekly") svg = this._svgWeekly(d);
    else if (this._graph === "punchmap") svg = this._svgPunchMap(d);
    else svg = this._svgRace(d);
    return `<div class="pills">${pills}</div><div class="legend">${legend}</div><div class="chart">${svg}</div>`;
  }

  /** Stacked daily bars, last 42 days. */
  _svgDaily(d) {
    const days = d.employees[0] ? d.employees[0].daily.map((x) => x.d) : [];
    if (!days.length) return `<div class="empty">No data yet.</div>`;
    const W = 900, H = 260, L = 44, B = 34, T = 12;
    const totals = days.map((_, di) =>
      d.employees.reduce((a, e) => a + (e.daily[di] ? e.daily[di].min : 0), 0),
    );
    const max = Math.max(60, ...totals);
    const bw = (W - L - 8) / days.length;
    let bars = "";
    days.forEach((day, di) => {
      let y = H - B;
      d.employees.forEach((e, ei) => {
        const min = e.daily[di] ? e.daily[di].min : 0;
        if (!min) return;
        const h = ((H - B - T) * min) / max;
        y -= h;
        bars += `<rect x="${(L + di * bw + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${this._color(ei)}" rx="1"><title>${esc(e.name)} — ${dayLabel(day)}: ${fmtMin(min)}</title></rect>`;
      });
    });
    // x labels: every Monday; y grid: sensible hour steps.
    let labels = "";
    days.forEach((day, di) => {
      if (new Date(day + "T12:00:00").getDay() === 1)
        labels += `<text x="${L + di * bw + bw / 2}" y="${H - B + 16}" class="ax" text-anchor="middle">${dayLabel(day)}</text>`;
    });
    const step = max > 12 * 60 ? 4 * 60 : max > 6 * 60 ? 2 * 60 : 60;
    let grid = "";
    for (let m = step; m <= max; m += step) {
      const y = H - B - ((H - B - T) * m) / max;
      grid += `<line x1="${L}" y1="${y}" x2="${W - 8}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 4}" class="ax" text-anchor="end">${m / 60}h</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${bars}<line x1="${L}" y1="${H - B}" x2="${W - 8}" y2="${H - B}" class="axis"/>${labels}</svg>`;
  }

  /** Multi-line weekly hours, 26 weeks. */
  _svgWeekly(d) {
    const weeks = d.employees[0] ? d.employees[0].weekly.map((x) => x.w) : [];
    if (!weeks.length) return `<div class="empty">No data yet.</div>`;
    const W = 900, H = 260, L = 44, B = 34, T = 12;
    const max = Math.max(10 * 60, ...d.employees.flatMap((e) => e.weekly.map((w) => w.min)));
    const x = (i) => L + ((W - L - 12) * i) / Math.max(1, weeks.length - 1);
    const y = (min) => H - B - ((H - B - T) * min) / max;
    let lines = "";
    d.employees.forEach((e, ei) => {
      const pts = e.weekly.map((w, i) => `${x(i).toFixed(1)},${y(w.min).toFixed(1)}`).join(" ");
      lines += `<polyline points="${pts}" fill="none" stroke="${this._color(ei)}" stroke-width="2.5" stroke-linejoin="round"/>`;
      lines += e.weekly
        .map(
          (w, i) =>
            `<circle cx="${x(i).toFixed(1)}" cy="${y(w.min).toFixed(1)}" r="3" fill="${this._color(ei)}"><title>${esc(e.name)} — wk of ${dayLabel(w.w)}: ${fmtMin(w.min)}</title></circle>`,
        )
        .join("");
    });
    let labels = "";
    weeks.forEach((w, i) => {
      if (i % 4 === 0)
        labels += `<text x="${x(i)}" y="${H - B + 16}" class="ax" text-anchor="middle">${dayLabel(w)}</text>`;
    });
    let grid = "";
    const step = max > 40 * 60 ? 20 * 60 : 10 * 60;
    for (let m = step; m <= max; m += step) {
      grid += `<line x1="${L}" y1="${y(m)}" x2="${W - 12}" y2="${y(m)}" class="grid"/><text x="${L - 6}" y="${y(m) + 4}" class="ax" text-anchor="end">${m / 60}h</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${lines}<line x1="${L}" y1="${H - B}" x2="${W - 12}" y2="${H - B}" class="axis"/>${labels}</svg>`;
  }

  /** Punch map: each shift drawn at its real time of day, last 3 weeks. */
  _svgPunchMap(d) {
    const DAYS = 21;
    const W = 900, H = 300, L = 48, B = 30, T = 10;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayIndex = (t) => {
      const dd = new Date(t); dd.setHours(0, 0, 0, 0);
      return DAYS - 1 - Math.round((today - dd) / 86_400_000);
    };
    const bw = (W - L - 10) / DAYS;
    const y = (hour) => T + ((H - B - T) * hour) / 24;
    let bars = "";
    d.employees.forEach((e, ei) => {
      e.punches.forEach((p) => {
        const start = new Date(p.in);
        const di = dayIndex(start);
        if (di < 0 || di >= DAYS) return;
        const end = p.out ? new Date(p.out) : new Date();
        const h0 = start.getHours() + start.getMinutes() / 60;
        const h1 = Math.min(24, end.getHours() + end.getMinutes() / 60 + (end.getDate() !== start.getDate() ? 24 : 0));
        const n = d.employees.length;
        const x0 = L + di * bw + 2 + (bw - 4) * (ei / n);
        bars += `<rect x="${x0.toFixed(1)}" y="${y(h0).toFixed(1)}" width="${((bw - 4) / n - 1).toFixed(1)}" height="${Math.max(2, y(h1) - y(h0)).toFixed(1)}" fill="${this._color(ei)}" rx="2" opacity="${p.out ? 0.9 : 0.55}"><title>${esc(e.name)}: ${fmtTime(p.in)} → ${p.out ? fmtTime(p.out) : "open"} (${fmtMin(p.min)})</title></rect>`;
      });
    });
    let grid = "";
    for (let hr = 0; hr <= 24; hr += 6) {
      grid += `<line x1="${L}" y1="${y(hr)}" x2="${W - 10}" y2="${y(hr)}" class="grid"/><text x="${L - 6}" y="${y(hr) + 4}" class="ax" text-anchor="end">${String(hr).padStart(2, "0")}:00</text>`;
    }
    let labels = "";
    for (let i = 0; i < DAYS; i++) {
      const dt = new Date(today.getTime() - (DAYS - 1 - i) * 86_400_000);
      if (dt.getDay() === 1 || i === DAYS - 1)
        labels += `<text x="${L + i * bw + bw / 2}" y="${H - B + 16}" class="ax" text-anchor="middle">${dt.toLocaleDateString([], { day: "numeric", month: "short" })}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${bars}${labels}</svg>`;
  }

  /** Year totals as a horizontal race. */
  _svgRace(d) {
    const W = 900, rowH = 44, L = 8;
    const H = d.employees.length * rowH + 10;
    const max = Math.max(60, ...d.employees.map((e) => e.yearMin));
    let rows = "";
    d.employees
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.yearMin - a.e.yearMin)
      .forEach(({ e, i }, rank) => {
        const w = ((W - L - 120) * e.yearMin) / max;
        const yy = 6 + rank * rowH;
        rows += `
          <text x="${L}" y="${yy + 17}" class="racename">${rank + 1}. ${esc(e.name)}</text>
          <rect x="${L}" y="${yy + 22}" width="${Math.max(3, w).toFixed(1)}" height="14" rx="7" fill="${this._color(i)}"><title>${esc(e.name)}: ${fmtMin(e.yearMin)} this year</title></rect>
          <text x="${L + Math.max(3, w) + 8}" y="${yy + 33}" class="raceval">${fmtH(e.yearMin)}</text>`;
      });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${rows}</svg>`;
  }

  _css() {
    return `
      :host { display:block; }
      ha-card { padding: 12px 14px 14px; position: relative; overflow: hidden; }
      .head { display:flex; align-items: baseline; justify-content: space-between; padding: 2px 4px 8px; }
      .title { font-size: 1.15em; font-weight: 600; }
      .sub { color: var(--secondary-text-color); font-size: 0.85em; }
      .tabs { display:flex; gap:4px; border-bottom: 1px solid var(--divider-color); margin-bottom: 10px; }
      .tab { background:none; border:none; padding:6px 12px; cursor:pointer; color: var(--secondary-text-color);
             border-bottom: 2px solid transparent; font: inherit; font-size: 0.9em; }
      .tab.on { color: var(--primary-color); border-bottom-color: var(--primary-color); font-weight: 600; }
      .people { display:flex; flex-direction: column; gap:8px; }
      .person { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius: 12px;
                background: var(--secondary-background-color); }
      .person.in { box-shadow: inset 3px 0 0 #34d399; }
      .person.break { box-shadow: inset 3px 0 0 #facc15; }
      .avatar { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;
                background: var(--pc); color:#0f172a; font-weight:700; flex:none; }
      .info { flex:1; min-width:0; }
      .name { font-weight:600; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .since { color: var(--secondary-text-color); font-size:0.8em; }
      .today { text-align:right; margin-right:4px; }
      .today .big { font-weight:700; font-variant-numeric: tabular-nums; }
      .today .lbl { color: var(--secondary-text-color); font-size:0.72em; }
      .badge { font-size:0.68em; padding:1px 7px; border-radius:9px; text-transform:uppercase; letter-spacing:.4px; }
      .badge.in { background:#065f46; color:#6ee7b7; }
      .badge.break { background:#713f12; color:#fde68a; }
      .badge.out { background: var(--divider-color); color: var(--secondary-text-color); }
      .badge.edit { background:#7c2d12; color:#fdba74; }
      button.punch { border:none; border-radius:10px; padding:10px 16px; font:inherit; font-weight:600; cursor:pointer; flex:none; }
      button.punch.in { background:#059669; color:white; }
      button.punch.out { background:#dc2626; color:white; }
      button.punch.busy { opacity:.5; pointer-events:none; }
      .pills { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
      .pill { border:1px solid var(--divider-color); background:none; color:var(--secondary-text-color);
              border-radius:14px; padding:3px 10px; font:inherit; font-size:0.8em; cursor:pointer; }
      .pill.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
      table.logs { width:100%; border-collapse: collapse; font-size:0.85em; }
      table.logs th { text-align:left; color:var(--secondary-text-color); font-weight:500; padding:4px 6px;
                      border-bottom:1px solid var(--divider-color); }
      table.logs td { padding:5px 6px; border-bottom:1px solid var(--divider-color); }
      table.logs .num { text-align:right; font-variant-numeric: tabular-nums; }
      .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
      .empty { color:var(--secondary-text-color); text-align:center; padding:12px; }
      .hint { color:var(--secondary-text-color); font-size:0.75em; margin-top:6px; }
      .legend { display:flex; gap:12px; flex-wrap:wrap; font-size:0.8em; color:var(--secondary-text-color); margin-bottom:4px; }
      .chart svg { width:100%; height:auto; }
      .grid { stroke: var(--divider-color); stroke-width:1; }
      .axis { stroke: var(--secondary-text-color); stroke-width:1; }
      .ax { fill: var(--secondary-text-color); font-size:11px; }
      .racename { fill: var(--primary-text-color); font-size:13px; font-weight:600; }
      .raceval { fill: var(--secondary-text-color); font-size:12px; font-variant-numeric: tabular-nums; }
      .toast { position:absolute; left:50%; bottom:10px; transform:translateX(-50%) translateY(60px);
               background:#7f1d1d; color:#fecaca; padding:8px 14px; border-radius:10px; font-size:0.8em;
               transition: transform .25s; max-width:90%; }
      .toast.show { transform:translateX(-50%) translateY(0); }
    `;
  }
}

customElements.define("timeclock-card", TimeclockCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "timeclock-card",
  name: "Time Clock Card",
  description: "Live staff time-clock: status, totals, logs, and graphs from the Time Clock add-on.",
});
console.info(`%c TIMECLOCK-CARD %c v${CARD_VERSION}`, "background:#0ea5e9;color:#fff;padding:2px 6px;border-radius:3px", "");
