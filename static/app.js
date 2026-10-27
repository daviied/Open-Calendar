// Self-hosted Calendar - client app (no build step, no dependencies).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const COLORS = ["#d50000", "#e67c73", "#f4511e", "#f6bf26", "#33b679", "#0b8043",
                "#039be5", "#1a73e8", "#3f51b5", "#7986cb", "#8e24aa", "#616161"];
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS = ["first", "second", "third", "fourth", "last"];

const ICONS = {
  edit: '<path d="M3 17.2V21h3.8l11-11-3.7-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z"/>',
  trash: '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>',
  close: '<path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16m.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7z"/>',
  place: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7m0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5"/>',
  notes: '<path d="M3 18h12v-2H3zM3 6v2h18V6zm0 7h18v-2H3z"/>',
  bell: '<path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2m6-6v-5c0-3.1-1.6-5.6-4.5-6.3V4a1.5 1.5 0 0 0-3 0v.7C7.6 5.4 6 7.9 6 11v5l-2 2v1h16v-1z"/>',
  cal: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V10h14z"/>',
  link: '<path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12M8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10"/>',
  more: '<path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/>',
  repeat: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/>',
  prev: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/>',
  next: '<path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

// ------------------------------------------------------------------ state

const prefs = Object.assign({ weekStart: 0, hour24: false, view: null, mode: "calendar", showTasks: true, showCards: true,
                              boardId: null, taskFilter: "todo" }, readJSON("cal.prefs"));
const state = {
  me: null,
  mode: ["calendar", "tasks", "boards"].includes(prefs.mode) ? prefs.mode : "calendar",
  assignments: null,   // { tasks, feed } from /api/assignments
  boards: null,        // board list
  board: null,         // the open board with its lists and cards
  view: prefs.view || (isMobile() ? "3day" : "week"),
  date: startOfDay(new Date()),
  miniDate: startOfDay(new Date()),
  calendars: [],
  accounts: [],
  events: [],
  scheduleDays: 60,
  search: null,
  offline: false,
};
let installPrompt = null;

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem("cal.prefs", JSON.stringify(prefs)); } catch {}
}
function isMobile() { return window.matchMedia("(max-width: 800px)").matches; }

// ------------------------------------------------------------------ utilities

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
function stripHtml(html) {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  const d = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"), "text/html");
  return d.body.textContent || "";
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; }
function startOfWeek(d) { const x = startOfDay(d); return addDays(x, -((x.getDay() - prefs.weekStart + 7) % 7)); }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parseYMD(s) { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
function hm(d) { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function dayDiff(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }

function evStart(ev) { return ev.all_day ? parseYMD(ev.start) : new Date(ev.start); }
function evEnd(ev) { return ev.all_day ? parseYMD(ev.end) : new Date(ev.end); }
function isLong(ev) { return ev.all_day || evEnd(ev) - evStart(ev) >= 86400000; }
// Assignments, board cards and events from calendars shown as assignments (e.g. Canvas) get a check circle.
function isTaskLike(ev) { return ev.kind === "task" || ev.kind === "card" || !!ev.assignment; }
function taskClass(ev) { return (isTaskLike(ev) ? " task" : "") + (ev.done ? " done" : ""); }
function dueOf(ev) { return ev.due ? (ev.all_day ? parseYMD(ev.due) : new Date(ev.due)) : evStart(ev); }

function fmtTime(d, compact = true) {
  if (prefs.hour24) return hm(d);
  let h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  const ap = d.getHours() < 12 ? "am" : "pm";
  return compact && m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, "0")}${ap}`;
}
function fmtDate(d, opts = { weekday: "long", month: "long", day: "numeric" }) {
  return d.toLocaleDateString(undefined, opts);
}
function fmtEventWhen(ev) {
  const s = evStart(ev), e = evEnd(ev);
  if (ev.all_day) {
    const last = addDays(e, -1);
    return sameDay(s, last) ? fmtDate(s) : `${fmtDate(s, { month: "long", day: "numeric" })} – ${fmtDate(last, { month: "long", day: "numeric", year: "numeric" })}`;
  }
  if (sameDay(s, e) || (e - s <= 86400000 && e.getHours() === 0 && e.getMinutes() === 0 && dayDiff(s, e) === 1)) {
    return `${fmtDate(s)} · ${fmtTime(s, false)} – ${fmtTime(e, false)}`;
  }
  return `${fmtDate(s, { month: "short", day: "numeric" })}, ${fmtTime(s, false)} – ${fmtDate(e, { month: "short", day: "numeric" })}, ${fmtTime(e, false)}`;
}
function fmtMinutes(m) {
  if (m === 0) return "At time of event";
  if (m % 10080 === 0) return `${m / 10080} week${m / 10080 > 1 ? "s" : ""} before`;
  if (m % 1440 === 0) return `${m / 1440} day${m / 1440 > 1 ? "s" : ""} before`;
  if (m % 60 === 0) return `${m / 60} hour${m / 60 > 1 ? "s" : ""} before`;
  return `${m} minutes before`;
}
function textColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.66 ? "#1f1f1f" : "#fff";
}
function colorVars(c) { return `--c:${c};--fg:${textColor(c)}`; }
function calById(id) { return state.calendars.find((c) => c.id === id); }

function describeRRule(rule, start) {
  if (!rule) return "";
  const p = Object.fromEntries(rule.split(";").map((x) => x.split("=")));
  const n = Number(p.INTERVAL || 1);
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[p.FREQ] || "time";
  let s = n === 1 ? { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Annually" }[p.FREQ] : `Every ${n} ${unit}s`;
  if (p.FREQ === "WEEKLY" && p.BYDAY) {
    const days = p.BYDAY.split(",");
    if (days.length === 5 && !days.includes("SA") && !days.includes("SU")) s = n === 1 ? "Every weekday" : `${s} on weekdays`;
    else s += " on " + days.map((d) => DAY_NAMES[DOW.indexOf(d.slice(-2))]).join(", ");
  } else if (p.FREQ === "MONTHLY" && p.BYDAY) {
    const m = /^(-?\d)(\w\w)$/.exec(p.BYDAY);
    if (m) s += ` on the ${m[1] === "-1" ? "last" : ORDINALS[Number(m[1]) - 1]} ${DAY_NAMES[DOW.indexOf(m[2])]}`;
  } else if (p.FREQ === "MONTHLY") {
    s += ` on day ${p.BYMONTHDAY || start.getDate()}`;
  } else if (p.FREQ === "YEARLY") {
    s += ` on ${fmtDate(start, { month: "long", day: "numeric" })}`;
  }
  if (p.COUNT) s += `, ${p.COUNT} times`;
  if (p.UNTIL) s += `, until ${fmtDate(parseYMD(`${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}`), { month: "short", day: "numeric", year: "numeric" })}`;
  return s;
}

// ------------------------------------------------------------------ API

async function api(path, opts = {}) {
  const init = { credentials: "same-origin", ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.body && typeof opts.body !== "string") {
    init.body = JSON.stringify(opts.body);
    init.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/password")) {
    showLogin(false);
    throw new Error("Not signed in");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(data?.detail || `Request failed (${res.status})`);
  if (path.startsWith("/api/events")) setOffline(res.headers.get("x-from-cache") === "1");
  return data;
}

function setOffline(v) {
  state.offline = v;
  $("#syncIndicator").hidden = !v;
}

let toastTimer;
function toast(msg, action) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ""}`;
  el.hidden = false;
  if (action) $("button", el).onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

// ------------------------------------------------------------------ auth

async function boot() {
  registerSW();
  let me;
  try { me = await api("/api/me"); } catch (e) { me = { authenticated: false, offline: true }; }
  if (!me.authenticated && !me.offline) return showLogin(me.setup_required);
  state.me = me;
  await start();
}

function showLogin(setup) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#loginTitle").textContent = setup ? "Welcome" : "Sign in";
  $("#loginHint").textContent = setup ? "Create a password to protect your calendar." : "Enter your calendar password.";
  $("#loginPassword2").hidden = !setup;
  $("#loginPassword").autocomplete = setup ? "new-password" : "current-password";
  $("#loginSubmit").textContent = setup ? "Create password" : "Sign in";
  $("#loginPassword").focus();
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const pw = $("#loginPassword").value;
    const err = $("#loginError");
    err.hidden = true;
    if (setup && pw !== $("#loginPassword2").value) { err.textContent = "Passwords don't match"; err.hidden = false; return; }
    try {
      await api(setup ? "/api/setup" : "/api/login", { method: "POST", body: { password: pw } });
      const me = await api("/api/me");
      if (!me.authenticated) {
        err.textContent = "Signed in, but your browser didn't keep the login cookie. Check that cookies are allowed for this site.";
        err.hidden = false;
        return;
      }
      $("#login").hidden = true;
      state.me = me;
      await start();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
}

let started = false;
async function start() {
  $("#app").hidden = false;
  if (!started) { bindUI(); started = true; }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (state.me?.timezone !== tz && state.me?.authenticated) api("/api/settings", { method: "POST", body: { timezone: tz } }).catch(() => {});
  await loadCalendars();
  handleUrl();
  await refresh();
  if (state.mode !== "tasks") loadTaskBadge();
  if ("Notification" in window && Notification.permission === "granted") ensurePushSubscription(false).catch(() => {});
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    refresh(true);
    if (state.mode !== "tasks") loadTaskBadge();
  }, 5 * 60 * 1000);
  setInterval(updateNowLine, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(true); });
}

function handleUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get("connected")) toast(`Connected ${q.get("connected") === "google" ? "Google" : "Outlook"} account`);
  if (q.get("connect_error")) toast(`Couldn't connect account (${q.get("connect_error")})`);
  if (q.get("start")) {
    const s = q.get("start");
    state.date = startOfDay(s.length === 10 ? parseYMD(s) : new Date(s));
    state.pendingEvent = q.get("event");
    state.mode = "calendar";
  }
  if (q.get("new")) setTimeout(() => openEditor(null), 300);
  if (q.toString()) history.replaceState(null, "", "/");
}

// ------------------------------------------------------------------ data

async function loadCalendars() {
  try {
    const data = await api("/api/calendars");
    state.calendars = data.calendars;
    state.accounts = data.accounts;
  } catch (e) { if (!state.calendars.length) toast(e.message); }
  renderCalendarList();
}

function visibleRange() {
  const d = state.date;
  switch (state.view) {
    case "day": return [d, addDays(d, 1)];
    case "3day": return [d, addDays(d, 3)];
    case "week": { const s = startOfWeek(d); return [s, addDays(s, 7)]; }
    case "month": {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const s = startOfWeek(first);
      const weeks = Math.ceil((dayDiff(s, new Date(d.getFullYear(), d.getMonth() + 1, 1))) / 7);
      return [s, addDays(s, weeks * 7)];
    }
    case "schedule": return [d, addDays(d, state.scheduleDays)];
  }
}

let loadToken = 0;
async function refresh(quiet = false) {
  const token = ++loadToken;
  if (state.mode === "tasks") return refreshTasks(token, quiet);
  if (state.mode === "boards") return refreshBoards(token, quiet);
  const [s, e] = visibleRange();
  if (!quiet) render();
  try {
    const data = await api(`/api/events?start=${encodeURIComponent(s.toISOString())}&end=${encodeURIComponent(e.toISOString())}`);
    if (token !== loadToken) return;
    state.events = data.events.filter((x) => x.kind === "event" || (x.kind === "task" ? prefs.showTasks : prefs.showCards));
  } catch (err) {
    if (token !== loadToken) return;
    if (err.message !== "Not signed in") toast("Couldn't load events: " + err.message);
  }
  render();
  if (state.pendingEvent) {
    const ev = state.events.find((x) => x.id === state.pendingEvent || String(x.event_id) === state.pendingEvent.split(":")[0] && x.start === (state.pendingEvent.split(":").slice(1).join(":") || x.start));
    state.pendingEvent = null;
    if (ev) openPopover(ev, null);
  }
}

function go(delta) {
  const d = state.date;
  const map = { day: () => addDays(d, delta), "3day": () => addDays(d, 3 * delta), week: () => addDays(d, 7 * delta),
                month: () => addMonths(d, delta), schedule: () => addDays(d, 30 * delta) };
  state.date = startOfDay(map[state.view]());
  state.miniDate = state.date;
  refresh();
}
function setMode(m) {
  state.mode = m;
  prefs.mode = m; savePrefs();
  state.search = null;
  $("#app").classList.remove("sidebar-open");
  setMiniDrop(false);
  refresh();
}
function setView(v) {
  state.mode = "calendar"; prefs.mode = "calendar";
  state.view = v;
  prefs.view = v; savePrefs();
  $("#viewSelect").value = v;
  state.search = null;
  refresh();
}
function gotoDate(d, view) {
  if (state.mode !== "calendar") { state.mode = "calendar"; prefs.mode = "calendar"; savePrefs(); }
  state.date = startOfDay(d);
  state.miniDate = state.date;
  if (view) { state.view = view; $("#viewSelect").value = view; }
  state.search = null;
  refresh();
}

// ------------------------------------------------------------------ rendering

function render() {
  closePopover();
  $("#app").dataset.mode = state.mode;
  $$("[data-mode]").forEach((b) => { if (b.tagName === "BUTTON") b.classList.toggle("on", b.dataset.mode === state.mode); });
  $("#viewSelect").value = state.view;
  renderTitle();
  renderMini();
  const main = $("#main");
  if (state.mode === "tasks") return renderTasks(main);
  if (state.mode === "boards") return renderBoards(main);
  if (state.search) return renderSearch(main);
  if (state.view === "month") renderMonth(main);
  else if (state.view === "schedule") renderSchedule(main);
  else renderTimeGrid(main);
}

function renderTitle() {
  const d = state.date;
  const mon = isMobile() ? "short" : "long";
  let t;
  if (state.mode === "tasks") t = "Assignments";
  else if (state.mode === "boards") t = state.board && prefs.boardId ? state.board.board.name : "Boards";
  else if (state.search) t = "Search";
  else if (isMobile()) {
    const ref = state.view === "month" || state.view === "schedule" ? d : visibleRange()[0];
    t = fmtDate(ref, { month: "long", ...(ref.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  }
  else if (state.view === "day") t = fmtDate(d, { month: mon, day: "numeric", year: "numeric" });
  else if (state.view === "month" || state.view === "schedule") t = fmtDate(d, { month: "long", year: "numeric" });
  else {
    const [s, e0] = visibleRange();
    const e = addDays(e0, -1);
    if (s.getMonth() === e.getMonth()) t = fmtDate(s, { month: "long", year: "numeric" });
    else if (s.getFullYear() === e.getFullYear()) t = `${fmtDate(s, { month: "short" })} – ${fmtDate(e, { month: "short", year: "numeric" })}`;
    else t = `${fmtDate(s, { month: "short", year: "numeric" })} – ${fmtDate(e, { month: "short", year: "numeric" })}`;
  }
  $("#title").textContent = t;
  document.title = `Calendar - ${t}`;
}

function renderMini() {
  const m = state.miniDate;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const s = startOfWeek(first);
  const today = startOfDay(new Date());
  const [rs, re] = state.view === "schedule" || state.view === "month" ? [null, null] : visibleRange();
  let html = `<div class="mini-head"><span>${fmtDate(m, { month: "long", year: "numeric" })}</span><div>
    <button class="icon-btn small" data-mini="-1" aria-label="Previous month">${icon("prev")}</button>
    <button class="icon-btn small" data-mini="1" aria-label="Next month">${icon("next")}</button></div></div><div class="mini-grid">`;
  for (let i = 0; i < 7; i++) html += `<div class="dow">${DAY_NAMES[(i + prefs.weekStart) % 7][0]}</div>`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(s, i);
    const cls = [d.getMonth() !== m.getMonth() && "other", sameDay(d, today) && "today", sameDay(d, state.date) && "selected",
                 rs && d >= rs && d < re && "in-range"].filter(Boolean).join(" ");
    html += `<button class="${cls}" data-date="${ymd(d)}">${d.getDate()}</button>`;
  }
  html += "</div>";
  $("#miniCal").innerHTML = html;
  $("#miniDrop").innerHTML = html;
  $("#todayNum").textContent = today.getDate();
  $$("#viewList [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view && !state.search));
}

function setMiniDrop(open) {
  const drop = $("#miniDrop");
  if (open) { state.miniDate = state.date; renderMini(); pushOverlay(); }
  drop.hidden = !open;
  $("#titleBtn").setAttribute("aria-expanded", String(open));
  if (state.view === "month") render(); // month rows depend on the available height
}

function renderCalendarList() {
  const mine = state.calendars.filter((c) => c.source === "local");
  const other = state.calendars.filter((c) => c.source !== "local");
  const item = (c) => `<li>
      <label title="${esc(c.name)}${c.account_email ? " · " + esc(c.account_email) : ""}">
        <input type="checkbox" class="check" style="--c:${esc(c.color)}" data-toggle="${c.id}" ${c.visible ? "checked" : ""}>
        <span class="name">${esc(c.name)}</span>
        ${c.sync_error ? `<span class="warn" title="${esc(c.sync_error)}">⚠</span>` : ""}
      </label>
      <button class="icon-btn small more" data-calmenu="${c.id}" aria-label="Options for ${esc(c.name)}">${icon("more")}</button>
    </li>`;
  const kindToggle = (kind, label, on) => `<li><label><input type="checkbox" class="check" style="--c:#8e24aa" data-toggle-kind="${kind}" ${on ? "checked" : ""}>
      <span class="name">${label}</span></label></li>`;
  $("#myCals").innerHTML = mine.map(item).join("") + kindToggle("task", "Assignments", prefs.showTasks) + kindToggle("card", "Board cards", prefs.showCards);
  $("#otherCals").innerHTML = other.map(item).join("") ||
    `<li class="muted" style="font-size:12px;padding:4px 8px">Add Google, Outlook or Canvas with the + button.</li>`;
}

// ---------- time grid (day / 3 day / week)

const HOUR = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 48;

function laneLayout(items) {
  // items: {s, e} columns inclusive. Returns lane index per item (mutates .lane).
  items.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s) || (b.ev.all_day - a.ev.all_day) || a.ev.start.localeCompare(b.ev.start));
  const lanes = [];
  for (const it of items) {
    let l = 0;
    while (lanes[l] && lanes[l].some(([s, e]) => it.s <= e && it.e >= s)) l++;
    (lanes[l] ||= []).push([it.s, it.e]);
    it.lane = l;
  }
  return lanes.length;
}

function spanItems(days, events) {
  const first = days[0], n = days.length;
  const out = [];
  for (const ev of events) {
    const s = evStart(ev);
    let e = evEnd(ev);
    if (!ev.all_day && e > s) e = new Date(e - 1);
    const si = dayDiff(first, s), ei = ev.all_day ? dayDiff(first, e) - 1 : dayDiff(first, e);
    const e2 = Math.max(si, ei);
    if (e2 < 0 || si >= n) continue;
    out.push({ ev, s: Math.max(0, si), e: Math.min(n - 1, e2), cutL: si < 0, cutR: e2 > n - 1 });
  }
  return out;
}

function renderTimeGrid(main) {
  const [start, end] = visibleRange();
  const n = dayDiff(start, end);
  const days = Array.from({ length: n }, (_, i) => addDays(start, i));
  const today = startOfDay(new Date());
  const now = new Date();
  const longEvents = state.events.filter(isLong);
  const timed = state.events.filter((e) => !isLong(e));

  const tzName = (() => {
    const p = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(now).find((x) => x.type === "timeZoneName");
    return p ? p.value : "";
  })();

  let head = `<div class="grid-head"><div class="gutter">${esc(tzName)}</div><div class="day-heads" style="--cols:${n}">`;
  for (const d of days) {
    head += `<div class="day-head ${sameDay(d, today) ? "today" : ""}" data-goto="${ymd(d)}">
      <div class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</div><div class="num">${d.getDate()}</div></div>`;
  }
  head += "</div></div>";

  // all-day lanes
  const LANE = isMobile() ? 24 : 22;
  const items = spanItems(days, longEvents);
  const laneCount = laneLayout(items);
  const maxLanes = state.alldayExpanded ? laneCount : Math.min(laneCount, 3);
  let bars = "";
  const hidden = new Array(n).fill(0);
  for (const it of items) {
    if (it.lane >= maxLanes || (it.lane === maxLanes - 1 && laneCount > maxLanes && !state.alldayExpanded)) {
      for (let c = it.s; c <= it.e; c++) hidden[c]++;
      continue;
    }
    bars += barHtml(it, n, it.lane, LANE, 2, now);
  }
  let moreLinks = "";
  const showLanes = laneCount > maxLanes ? maxLanes : laneCount;
  hidden.forEach((h, c) => {
    if (h) moreLinks += `<div class="more-link" data-allday-more style="left:calc(${(c / n) * 100}% + 2px);top:${(showLanes - (laneCount > maxLanes ? 1 : 0)) * LANE + 2}px">${h} more</div>`;
  });
  const lanesShown = Math.max(showLanes, 0);
  const alldayHeight = Math.max(lanesShown * LANE + 6, 24);
  const allday = `<div class="allday-row"><div class="gutter"></div><div class="lanes" style="--cols:${n};height:${alldayHeight}px" data-allday>
      ${days.map((d) => `<div class="cell" data-allday-date="${ymd(d)}"></div>`).join("")}
      <div style="position:absolute;inset:0;pointer-events:none"><div style="position:relative;height:100%;pointer-events:none">${bars}${moreLinks}</div></div>
    </div></div>`;

  // hours + columns
  const hour = HOUR();
  let hours = `<div class="gutter hours">`;
  for (let h = 1; h < 24; h++) hours += `<div class="hour-label" style="top:${h * hour}px">${fmtTime(new Date(2000, 0, 1, h))}</div>`;
  hours += "</div>";
  let cols = `<div class="cols" style="--cols:${n}">`;
  days.forEach((d, i) => {
    cols += `<div class="col" data-col="${i}" data-date="${ymd(d)}">`;
    cols += layoutDay(d, timed, hour, now).join("");
    if (sameDay(d, today)) cols += `<div class="now-line" style="top:${(now.getHours() * 60 + now.getMinutes()) / 60 * hour}px"></div>`;
    cols += "</div>";
  });
  cols += "</div>";

  const prevScroll = $(".grid-scroll", main)?.scrollTop;
  main.innerHTML = `${head}${allday}<div class="grid-scroll"><div class="grid-inner">${hours}${cols}</div></div>`;
  const scroller = $(".grid-scroll", main);
  main.style.setProperty("--sbw", `${scroller.offsetWidth - scroller.clientWidth}px`);
  if (prevScroll != null && state.keepScroll) scroller.scrollTop = prevScroll;
  else {
    const firstEv = timed.filter((e) => evStart(e) >= start).map((e) => evStart(e).getHours())[0];
    const target = days.some((d) => sameDay(d, today)) ? Math.max(0, now.getHours() - 2) : Math.min(firstEv ?? 8, 8);
    scroller.scrollTop = target * hour;
  }
  state.keepScroll = true;
  state.gridDays = days;
}

function barHtml(it, n, lane, laneH, top, now) {
  const ev = it.ev;
  const past = evEnd(ev) < now ? " past" : "";
  const timedDot = !ev.all_day && !isLong(ev);
  const left = (it.s / n) * 100, width = ((it.e - it.s + 1) / n) * 100;
  const tick = isTaskLike(ev) ? '<i class="tick-i"></i>' : "";
  const label = timedDot ? `<span class="tm">${fmtTime(dueOf(ev))}</span> ${tick}${esc(ev.title)}` : `${it.cutL ? "◂ " : ""}${tick}${esc(ev.title)}`;
  return `<div class="bar${timedDot ? " timed" : ""}${past}${taskClass(ev)}" data-ev="${esc(ev.id)}" style="${colorVars(ev.color)};left:${left}%;width:calc(${width}% - 4px);top:${top + lane * laneH}px">${label}</div>`;
}

function layoutDay(day, events, hour, now) {
  const dayStart = day.getTime(), dayEnd = addDays(day, 1).getTime();
  const segs = [];
  for (const ev of events) {
    const s = evStart(ev).getTime(), e = evEnd(ev).getTime();
    if (e <= dayStart || s >= dayEnd || (e === s && (s < dayStart || s >= dayEnd))) continue;
    segs.push({ ev, s: Math.max(s, dayStart), e: Math.max(Math.min(e, dayEnd), Math.max(s, dayStart) + 15 * 60000) });
  }
  segs.sort((a, b) => a.s - b.s || b.e - a.e);
  // group into overlapping clusters, then assign columns
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const colsEnd = [];
    for (const sg of cluster) {
      let c = colsEnd.findIndex((end) => end <= sg.s);
      if (c === -1) { c = colsEnd.length; colsEnd.push(0); }
      colsEnd[c] = sg.e;
      sg.col = c;
    }
    for (const sg of cluster) sg.ncols = colsEnd.length;
    cluster = [];
  };
  for (const sg of segs) {
    if (sg.s >= clusterEnd && cluster.length) flush();
    cluster.push(sg);
    clusterEnd = Math.max(clusterEnd, sg.e);
  }
  if (cluster.length) flush();

  for (const sg of segs) {
    const top = (sg.s - dayStart) / 3600000 * hour;
    const height = Math.max((sg.e - sg.s) / 3600000 * hour - 2, 18);
    const width = 100 / sg.ncols;
    const left = sg.col * width;
    const ev = sg.ev;
    const short = height < 38;
    const s = evStart(ev), e = evEnd(ev);
    const time = isTaskLike(ev) ? `Due ${fmtTime(dueOf(ev))}` : `${fmtTime(s)} – ${fmtTime(e)}`;
    const past = e < now ? " past" : "";
    const span = sg.ncols > 1 && sg.col < sg.ncols - 1 ? width * 1.6 : width;
    out.push(`<div class="ev${short ? " short" : ""}${past}${taskClass(ev)}" data-ev="${esc(ev.id)}" style="${colorVars(ev.color)};top:${top}px;height:${height}px;left:${left}%;width:calc(${Math.min(span, 100 - left)}% - 2px);z-index:${2 + sg.col}">
      <div class="t">${isTaskLike(ev) ? '<i class="tick-i"></i>' : ""}${esc(ev.title)}${short ? "," : ""}</div><div class="s">${time}${!short && ev.location ? `<br>${esc(ev.location)}` : ""}</div>
      ${ev.read_only || ev.kind !== "event" ? "" : '<div class="resize"></div>'}</div>`);
  }
  return out;
}

function updateNowLine() {
  const line = $(".now-line");
  if (!line) return;
  const now = new Date();
  if (!state.gridDays?.some((d) => sameDay(d, now))) return refresh(true);
  line.style.top = `${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR()}px`;
}

// ---------- month

function renderMonth(main) {
  const [start, end] = visibleRange();
  const weeks = dayDiff(start, end) / 7;
  const today = startOfDay(new Date());
  const now = new Date();
  const month = state.date.getMonth();
  main.innerHTML = `<div class="month"><div class="month-dows">${Array.from({ length: 7 }, (_, i) =>
    `<div>${DAY_NAMES[(i + prefs.weekStart) % 7].slice(0, 3).toUpperCase()}</div>`).join("")}</div>
    <div class="month-rows" style="grid-template-rows:repeat(${weeks},1fr)"></div></div>`;
  const rows = $(".month-rows", main);
  const rowH = rows.clientHeight / weeks;
  const laneH = isMobile() ? 19 : 22;
  const maxLanes = Math.max(1, Math.floor((rowH - (isMobile() ? 28 : 32)) / laneH));
  let html = "";
  for (let w = 0; w < weeks; w++) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i));
    const items = spanItems(days, state.events);
    const count = laneLayout(items);
    const perDay = new Array(7).fill(0);
    items.forEach((it) => { for (let c = it.s; c <= it.e; c++) perDay[c]++; });
    let bars = "";
    const hidden = new Array(7).fill(0);
    for (const it of items) {
      let fits = it.lane < maxLanes;
      if (fits && it.lane === maxLanes - 1) {
        for (let c = it.s; c <= it.e; c++) if (perDay[c] > maxLanes) fits = false;
      }
      if (!fits) { for (let c = it.s; c <= it.e; c++) hidden[c]++; continue; }
      bars += barHtml(it, 7, it.lane, laneH, 0, now);
    }
    hidden.forEach((h, c) => {
      if (h) bars += `<div class="more-link" data-more="${ymd(days[c])}" style="left:calc(${(c / 7) * 100}% + 2px);top:${(maxLanes - 1) * laneH}px">${h} more</div>`;
    });
    html += `<div class="week-row">${days.map((d) => `<div class="mcell ${d.getMonth() !== month ? "other" : ""} ${sameDay(d, today) ? "today" : ""}" data-mdate="${ymd(d)}">
        <span class="dnum" data-goto="${ymd(d)}">${d.getDate() === 1 ? fmtDate(d, { month: "short", day: "numeric" }) : d.getDate()}</span></div>`).join("")}
      <div class="bars">${bars}</div></div>`;
    void count;
  }
  rows.innerHTML = html;
}

// ---------- schedule

function scheduleHtml(events, emptyText) {
  const byDay = new Map();
  const [rs] = state.search ? [null] : visibleRange();
  for (const ev of events) {
    let d = startOfDay(evStart(ev));
    const last = ev.all_day ? addDays(evEnd(ev), -1) : new Date(evEnd(ev) - 1);
    // multi-day events show on each day (within range)
    let guard = 0;
    while (d <= last && guard++ < 60) {
      if (!rs || d >= rs) {
        const k = ymd(d);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(ev);
      }
      if (state.search) break;
      d = addDays(d, 1);
    }
    if (guard === 0) {
      const k = ymd(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(ev);
    }
  }
  const today = startOfDay(new Date());
  const keys = [...byDay.keys()].sort();
  if (!keys.length) return `<div class="sched-empty">${esc(emptyText)}</div>`;
  return keys.map((k) => {
    const d = parseYMD(k);
    const list = byDay.get(k).sort((a, b) => (b.all_day - a.all_day) || evStart(a) - evStart(b));
    return `<div class="sched-day ${sameDay(d, today) ? "today" : ""}">
      <div class="sched-date" data-goto="${k}"><span class="num">${d.getDate()}</span>
        <span class="meta">${d.toLocaleDateString(undefined, { month: "short", weekday: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) })}</span></div>
      <div class="sched-events">${list.map((ev) => `<div class="sched-ev${taskClass(ev)}" data-ev="${esc(ev.id)}" style="${colorVars(ev.color)}">
          <span class="dot"></span><span class="time">${isTaskLike(ev) ? (ev.all_day ? "Due today" : `Due ${fmtTime(dueOf(ev))}`) : ev.all_day || isLong(ev) ? "All day" : `${fmtTime(evStart(ev))} – ${fmtTime(evEnd(ev))}`}</span>
          <span class="ttl">${esc(ev.title)}${ev.location ? `<span class="muted"> · ${esc(ev.location)}</span>` : ""}</span></div>`).join("")}</div>
    </div>`;
  }).join("");
}

function renderSchedule(main) {
  main.innerHTML = `<div class="schedule">${scheduleHtml(state.events, "Nothing planned. Enjoy your free time!")}
    <button class="btn outline load-more" id="loadMore">Load more</button></div>`;
  $("#loadMore").onclick = () => { state.scheduleDays += 60; state.keepScroll = true; refresh(true); };
}

function renderSearch(main) {
  main.innerHTML = `<div class="schedule"><div class="search-head">Results for “${esc(state.search.q)}”</div>
    ${scheduleHtml(state.search.events, "No matching events")}</div>`;
}

async function runSearch(q) {
  if (!q.trim()) { state.search = null; return render(); }
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    state.search = { q, events: data.events };
    render();
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ event popover

function findEvent(id) {
  return state.events.find((e) => e.id === id) || state.search?.events.find((e) => e.id === id);
}

function openPopover(ev, anchor) {
  const pop = $("#popover");
  const cal = calById(ev.calendar_id);
  const rem = ev.effective_reminders || [];
  const desc = stripHtml(ev.description || "");
  const taskLike = isTaskLike(ev);
  const where = ev.kind === "task" ? (ev.course || "Assignment") : ev.kind === "card" ? `${ev.board_name} · ${ev.list_name}` : null;
  pop.innerHTML = `<div class="pop-actions">
      ${ev.read_only ? "" : `<button class="icon-btn" data-act="edit" title="Edit">${icon("edit")}</button>
      <button class="icon-btn" data-act="delete" title="Delete">${icon("trash")}</button>`}
      <button class="icon-btn" data-act="close" title="Close">${icon("close")}</button></div>
    <div class="pop-row"><span class="sw" style="--c:${esc(ev.color)}"></span><div>
      <div class="pop-title"${ev.done ? ' style="text-decoration:line-through"' : ""}>${esc(ev.title)}</div>
      <div class="muted">${esc(taskLike ? fmtDue(ev) : fmtEventWhen(ev))}</div>
      ${taskLike ? `<div class="row" style="margin-top:10px">
        <button class="btn ${ev.done ? "outline" : "primary"}" data-act="toggle">${ev.done ? "Mark not done" : "Mark complete"}</button>
        ${ev.kind === "card" ? `<button class="btn text" data-act="board">Open board</button>` : ""}</div>` : ""}
      ${ev.recurring ? `<div class="muted">${esc(describeRRule(ev.rrule, parseYMD(ev.series_start.slice(0, 10))))}</div>` : ""}</div></div>
    ${ev.location ? `<div class="pop-row">${icon("place")}<div>${/^https?:/.test(ev.location) ? linkify(ev.location) :
      `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}" target="_blank" rel="noopener">${esc(ev.location)}</a>`}</div></div>` : ""}
    ${desc.trim() ? `<div class="pop-row">${icon("notes")}<div class="pop-desc">${linkify(desc.trim())}</div></div>` : ""}
    ${ev.url ? `<div class="pop-row">${icon("link")}<div><a href="${esc(ev.url)}" target="_blank" rel="noopener">Open in ${esc(sourceName(cal))}</a></div></div>` : ""}
    ${rem.length ? `<div class="pop-row">${icon("bell")}<div>${rem.map((m) => esc(fmtMinutes(m))).join("<br>")}</div></div>` : ""}
    <div class="pop-row">${icon("cal")}<div>${esc(where ?? cal?.name ?? "")}${!where && cal?.account_email ? `<div class="muted">${esc(cal.account_email)}</div>` : ""}</div></div>`;
  pop.hidden = false;
  pushOverlay();
  pop.onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") closePopover();
    if (act === "toggle") { closePopover(); toggleDone(ev); }
    if (act === "board") { closePopover(); prefs.boardId = ev.board_id; savePrefs(); setMode("boards"); }
    if (act === "edit") {
      closePopover();
      if (ev.kind === "task") openTaskEditor(taskFromItem(ev));
      else if (ev.kind === "card") openCardById(ev.board_id, ev.card_id);
      else openEditor(ev);
    }
    if (act === "delete") {
      closePopover();
      if (ev.kind === "task") deleteTask(ev.task_id);
      else if (ev.kind === "card") deleteCard(ev.card_id);
      else deleteEvent(ev);
    }
  };
  // position
  const r = anchor?.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left, top;
  if (!r) { left = (innerWidth - pw) / 2; top = (innerHeight - ph) / 2; }
  else {
    left = r.right + 8;
    if (left + pw > innerWidth - 8) left = r.left - pw - 8;
    if (left < 8) left = Math.max(8, Math.min(innerWidth - pw - 8, r.left));
    top = Math.min(Math.max(8, r.top), innerHeight - ph - 8);
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
function closePopover() { const p = $("#popover"); if (p) p.hidden = true; }
function sourceName(cal) {
  return { google: "Google Calendar", microsoft: "Outlook", ics: "source" }[cal?.source] || "source";
}

// ------------------------------------------------------------------ modal helpers

// Phones: the Back button closes whatever sheet/dialog/drawer is open instead of leaving the app.
// One history entry stands in for "something is open"; it is reused rather than stacked.
function pushOverlay() {
  if (isMobile() && !history.state?.overlay) history.pushState({ overlay: true }, "");
}
function closeOverlays() {
  closeModal();
  closePopover();
  $("#app").classList.remove("sidebar-open");
  if (!$("#miniDrop").hidden) setMiniDrop(false);
}

function openModal(html, { wide = false } = {}) {
  pushOverlay();
  const bd = $("#modalBackdrop"), m = $("#modal");
  m.className = "modal" + (wide ? " wide" : "");
  m.innerHTML = html;
  bd.hidden = false;
  bd.onclick = (e) => { if (e.target === bd) closeModal(); };
  return m;
}
function closeModal() { $("#modalBackdrop").hidden = true; $("#modal").innerHTML = ""; }
function modalOpen() { return !$("#modalBackdrop").hidden; }

function choose(title, options) {
  return new Promise((resolve) => {
    const m = openModal(`<div class="modal-head"><h2>${esc(title)}</h2></div>
      <div class="modal-body">${options.map((o, i) => `<label class="toggle" style="display:flex;margin:10px 0">
        <input type="radio" name="choice" value="${o.value}" ${i === 0 ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</div>
      <div class="modal-foot"><button class="btn text" data-x>Cancel</button><button class="btn primary" data-ok>OK</button></div>`);
    $("[data-x]", m).onclick = () => { closeModal(); resolve(null); };
    $("[data-ok]", m).onclick = () => { const v = $("input:checked", m).value; closeModal(); resolve(v); };
    $("#modalBackdrop").onclick = (e) => { if (e.target.id === "modalBackdrop") { closeModal(); resolve(null); } };
  });
}
function recurringScope(verb) {
  return choose(`${verb} recurring event`, [
    { value: "this", label: "This event" },
    { value: "following", label: "This and following events" },
    { value: "all", label: "All events" },
  ]);
}

// ------------------------------------------------------------------ event editor

function writableCalendars() { return state.calendars.filter((c) => !c.read_only && c.source !== "ics"); }

function repeatOptions(d) {
  const dow = DOW[d.getDay()];
  const nth = Math.ceil(d.getDate() / 7);
  const isLast = addDays(d, 7).getMonth() !== d.getMonth();
  const opts = [
    ["", "Does not repeat"],
    ["FREQ=DAILY", "Daily"],
    [`FREQ=WEEKLY;BYDAY=${dow}`, `Weekly on ${DAY_NAMES[d.getDay()]}`],
    [`FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}`, `Monthly on day ${d.getDate()}`],
    [`FREQ=MONTHLY;BYDAY=${nth > 4 ? -1 : nth}${dow}`, `Monthly on the ${nth > 4 ? "last" : ORDINALS[nth - 1]} ${DAY_NAMES[d.getDay()]}`],
    [`FREQ=YEARLY`, `Annually on ${fmtDate(d, { month: "long", day: "numeric" })}`],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Every weekday (Monday to Friday)"],
  ];
  if (isLast && nth <= 4) opts.splice(5, 0, [`FREQ=MONTHLY;BYDAY=-1${dow}`, `Monthly on the last ${DAY_NAMES[d.getDay()]}`]);
  return opts;
}

function openEditor(ev, defaults = {}) {
  const isNew = !ev;
  const cals = writableCalendars();
  if (!cals.length) return toast("No writable calendars");
  const calId = ev?.calendar_id ?? defaults.calendar_id ?? prefs.lastCalendar ?? cals[0].id;
  const cal0 = calById(calId) && cals.some((c) => c.id === calId) ? calById(calId) : cals[0];
  const allDay = ev ? ev.all_day : !!defaults.all_day;
  let s = ev ? evStart(ev) : defaults.start;
  let e = ev ? evEnd(ev) : defaults.end;
  if (!s) {
    const now = new Date();
    s = new Date(state.date); s.setHours(now.getHours() + 1, 0, 0, 0);
    if (!sameDay(state.date, now)) s.setHours(9, 0, 0, 0);
  }
  if (!e) e = allDay ? addDays(startOfDay(s), 1) : new Date(s.getTime() + 3600000);
  const endShown = allDay ? addDays(e, -1) : e;
  let reminders = ev ? (ev.reminders ?? ev.effective_reminders ?? []) : [...(cal0.default_reminders || [])];
  let remindersTouched = false;
  const rrule = ev?.rrule || "";

  const m = openModal(`<form id="evForm">
    <div class="modal-head"><button type="button" class="icon-btn head-x" data-x aria-label="Close">${icon("close")}</button>
      <h2>${isNew ? "New event" : "Edit event"}</h2><button type="submit" class="btn primary head-save">Save</button></div>
    <div class="modal-body">
      <input class="title-input" name="title" placeholder="Add title" value="${esc(ev?.title === "(No title)" ? "" : ev?.title || "")}" autocomplete="off">
      <div class="field"><label class="toggle"><input type="checkbox" name="all_day" ${allDay ? "checked" : ""}> All day</label></div>
      <div class="when ${allDay ? "all-day" : ""}">
        <div class="when-row"><span>Starts</span>
          <input type="date" name="sdate" value="${ymd(s)}" required>
          <input type="time" name="stime" value="${hm(s)}" step="900" data-timed></div>
        <div class="when-row"><span>Ends</span>
          <input type="date" name="edate" value="${ymd(endShown)}" required>
          <input type="time" name="etime" value="${hm(e)}" step="900" data-timed></div>
      </div>
      <div class="field"><span>Repeat</span><select name="repeat"></select></div>
      <div id="customRepeat" hidden class="help">
        <div class="row">Repeat every <input type="number" name="interval" min="1" value="1" style="width:64px">
          <select name="freq"><option value="DAILY">day(s)</option><option value="WEEKLY" selected>week(s)</option><option value="MONTHLY">month(s)</option><option value="YEARLY">year(s)</option></select></div>
        <div class="chips" id="byday">${DOW.map((d, i) => `<button type="button" class="chip" data-day="${d}">${DAY_NAMES[i].slice(0, 2)}</button>`).join("")}</div>
        <div class="row" style="margin-top:6px">Ends
          <select name="ends"><option value="never">Never</option><option value="on">On</option><option value="after">After</option></select>
          <input type="date" name="until" hidden><span id="countWrap" hidden><input type="number" name="count" min="1" value="10" style="width:64px"> times</span></div>
      </div>
      <div class="field"><span>Calendar</span><select name="calendar_id">${cals.map((c) =>
        `<option value="${c.id}" ${c.id === cal0.id ? "selected" : ""}>${esc(c.name)}${c.account_email ? ` (${esc(c.account_email)})` : ""}</option>`).join("")}</select></div>
      <div class="field"><span>Location</span><input type="text" name="location" value="${esc(ev?.location || "")}" placeholder="Add location"></div>
      <div class="field"><span>Notifications</span><div id="reminders"></div>
        <div><button type="button" class="btn text" id="addReminder" style="padding-left:0">Add notification</button></div></div>
      <div class="field"><span>Color</span><div class="colors" id="colorPick">
        <button type="button" class="none ${!ev?.color || ev.color === cal0.color ? "on" : ""}" data-color="" title="Calendar color"></button>
        ${COLORS.map((c) => `<button type="button" style="--c:${c}" data-color="${c}" class="${ev?.color === c && ev.color !== cal0.color ? "on" : ""}" title="${c}"></button>`).join("")}</div></div>
      <div class="field"><span>Description</span><textarea name="description" placeholder="Add description">${esc(stripHtml(ev?.description || ""))}</textarea></div>
      <p class="error" id="evError" hidden></p>
    </div>
    <div class="modal-foot">
      ${isNew ? "" : `<button type="button" class="btn danger left" data-del>Delete</button>`}
      <button type="button" class="btn text" data-x>Cancel</button>
      <button type="submit" class="btn primary foot-save">Save</button>
    </div></form>`);

  const f = $("#evForm", m);
  let color = ev?.color && ev.color !== cal0.color ? ev.color : "";
  const byday = new Set();

  const syncTimed = () => {
    $(".when", f).classList.toggle("all-day", f.all_day.checked);
  };
  const fillRepeat = () => {
    const d = parseYMD(f.sdate.value || ymd(s));
    const opts = repeatOptions(d);
    const cur = f.repeat.value || rrule;
    let html = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
    const known = opts.some(([v]) => v === cur);
    html += `<option value="custom">${!known && cur && cur !== "custom" ? esc(describeRRule(cur, d)) : "Custom…"}</option>`;
    f.repeat.innerHTML = html;
    f.repeat.value = known ? cur : cur ? "custom" : "";
    if (!known && cur && cur !== "custom") loadCustom(cur);
    $("#customRepeat", m).hidden = f.repeat.value !== "custom";
  };
  const loadCustom = (rule) => {
    const p = Object.fromEntries(rule.split(";").map((x) => x.split("=")));
    f.freq.value = p.FREQ || "WEEKLY";
    f.interval.value = p.INTERVAL || 1;
    byday.clear();
    (p.BYDAY || "").split(",").filter(Boolean).forEach((d) => byday.add(d.slice(-2)));
    if (p.UNTIL) { f.ends.value = "on"; f.until.value = `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}`; }
    else if (p.COUNT) { f.ends.value = "after"; f.count.value = p.COUNT; }
    syncCustom();
  };
  const syncCustom = () => {
    $("#byday", m).hidden = f.freq.value !== "WEEKLY";
    $$("#byday .chip", m).forEach((c) => c.classList.toggle("on", byday.has(c.dataset.day)));
    f.until.hidden = f.ends.value !== "on";
    $("#countWrap", m).hidden = f.ends.value !== "after";
  };
  const customRule = () => {
    let r = `FREQ=${f.freq.value}`;
    if (Number(f.interval.value) > 1) r += `;INTERVAL=${Number(f.interval.value)}`;
    if (f.freq.value === "WEEKLY") {
      const days = DOW.filter((d) => byday.has(d));
      r += `;BYDAY=${(days.length ? days : [DOW[parseYMD(f.sdate.value).getDay()]]).join(",")}`;
    }
    if (f.ends.value === "on" && f.until.value) r += `;UNTIL=${f.until.value.replaceAll("-", "")}`;
    if (f.ends.value === "after") r += `;COUNT=${Math.max(1, Number(f.count.value) || 1)}`;
    return r;
  };
  const renderReminders = () => {
    $("#reminders", m).innerHTML = reminders.map((mins, i) => {
      const [val, unit] = mins % 10080 === 0 && mins ? [mins / 10080, 10080] : mins % 1440 === 0 && mins ? [mins / 1440, 1440] : mins % 60 === 0 && mins ? [mins / 60, 60] : [mins, 1];
      return `<div class="reminder-row">${icon("bell")}<input type="number" min="0" value="${val}" data-rv="${i}">
        <select data-ru="${i}">${[[1, "minutes"], [60, "hours"], [1440, "days"], [10080, "weeks"]].map(([u, l]) => `<option value="${u}" ${u === unit ? "selected" : ""}>${l}</option>`).join("")}</select>
        <span class="muted">before</span><button type="button" class="icon-btn small" data-rdel="${i}">${icon("close")}</button></div>`;
    }).join("");
  };
  const readReminders = () => {
    reminders = $$("[data-rv]", m).map((inp) => Number(inp.value || 0) * Number($(`[data-ru="${inp.dataset.rv}"]`, m).value));
  };

  syncTimed(); fillRepeat(); renderReminders();
  f.all_day.onchange = syncTimed;
  f.sdate.onchange = () => {
    // keep duration when moving start date
    const newS = parseYMD(f.sdate.value), oldS = parseYMD(ymd(s));
    const diff = dayDiff(oldS, newS);
    f.edate.value = ymd(addDays(parseYMD(f.edate.value), diff));
    s = addDays(s, diff);
    fillRepeat();
  };
  f.stime.onchange = () => {
    const [sh, sm] = f.stime.value.split(":").map(Number);
    const ns = new Date(parseYMD(f.sdate.value)); ns.setHours(sh, sm);
    const dur = e - s;
    s = ns; e = new Date(ns.getTime() + Math.max(dur, 15 * 60000));
    f.etime.value = hm(e); f.edate.value = ymd(e);
  };
  f.repeat.onchange = () => { $("#customRepeat", m).hidden = f.repeat.value !== "custom"; if (f.repeat.value === "custom") { if (!$$("#byday .chip.on", m).length) byday.add(DOW[parseYMD(f.sdate.value).getDay()]); syncCustom(); } };
  f.freq.onchange = syncCustom;
  f.ends.onchange = syncCustom;
  $("#byday", m).onclick = (ev2) => {
    const d = ev2.target.closest("[data-day]")?.dataset.day;
    if (!d) return;
    byday.has(d) ? byday.delete(d) : byday.add(d);
    syncCustom();
  };
  f.calendar_id.onchange = () => {
    const c = calById(Number(f.calendar_id.value));
    if (!remindersTouched && isNew) { reminders = [...(c.default_reminders || [])]; renderReminders(); }
  };
  $("#addReminder", m).onclick = () => { readReminders(); remindersTouched = true; reminders.push(reminders.length ? 60 : 10); renderReminders(); };
  $("#reminders", m).addEventListener("input", () => { remindersTouched = true; });
  $("#reminders", m).onclick = (ev2) => {
    const i = ev2.target.closest("[data-rdel]")?.dataset.rdel;
    if (i == null) return;
    readReminders(); remindersTouched = true; reminders.splice(Number(i), 1); renderReminders();
  };
  $("#colorPick", m).onclick = (ev2) => {
    const b = ev2.target.closest("[data-color]");
    if (!b) return;
    color = b.dataset.color;
    $$("#colorPick button", m).forEach((x) => x.classList.toggle("on", x === b));
  };
  $$("[data-x]", m).forEach((b) => (b.onclick = closeModal));
  $("[data-del]", m)?.addEventListener("click", () => { closeModal(); deleteEvent(ev); });
  setTimeout(() => f.title.focus(), 50);

  f.onsubmit = async (e2) => {
    e2.preventDefault();
    readReminders();
    const ad = f.all_day.checked;
    const body = {
      title: f.title.value, location: f.location.value, description: f.description.value,
      calendar_id: Number(f.calendar_id.value), all_day: ad, color: color || null,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rrule: f.repeat.value === "custom" ? customRule() : f.repeat.value || null,
    };
    if (ad) {
      body.start = f.sdate.value;
      body.end = ymd(addDays(parseYMD(f.edate.value), 1));
      if (body.end <= body.start) body.end = ymd(addDays(parseYMD(body.start), 1));
    } else {
      const st = new Date(`${f.sdate.value}T${f.stime.value || "09:00"}`);
      let en = new Date(`${f.edate.value}T${f.etime.value || "10:00"}`);
      if (en <= st) en = new Date(st.getTime() + 3600000);
      body.start = st.toISOString(); body.end = en.toISOString();
    }
    if (!isNew && ev.reminders == null && !remindersTouched) body.reminders = null;
    else body.reminders = reminders;
    prefs.lastCalendar = body.calendar_id; savePrefs();
    const err = $("#evError", m);
    try {
      if (isNew) await api("/api/events", { method: "POST", body });
      else {
        let scope = "all";
        if (ev.recurring) {
          scope = await recurringScope("Edit");
          if (!scope) return;
        }
        if (scope !== "all" || !ev.recurring) {
          if (body.rrule === ev.rrule && scope === "this") body.rrule = null;
        }
        await api(`/api/events/${ev.event_id}`, { method: "PATCH", body: { ...body, scope, occurrence_start: ev.recurring ? ev.start : undefined } });
      }
      closeModal();
      toast(isNew ? "Event saved" : "Event updated");
      refresh(true);
    } catch (ex) {
      if (!modalOpen()) toast(ex.message);
      else { err.textContent = ex.message; err.hidden = false; }
    }
  };
}

async function deleteEvent(ev) {
  let scope = "all";
  if (ev.recurring) { scope = await recurringScope("Delete"); if (!scope) return; }
  try {
    const q = ev.recurring ? `?scope=${scope}&occurrence=${encodeURIComponent(ev.start)}` : "";
    await api(`/api/events/${ev.event_id}${q}`, { method: "DELETE" });
    toast("Event deleted");
    refresh(true);
  } catch (e) { toast(e.message); }
}

// quick move (drag & drop) - updates start/end keeping everything else
async function moveEvent(ev, start, end) {
  let scope = "all";
  if (ev.recurring) { scope = await recurringScope("Change"); if (!scope) return refresh(true); }
  const body = { start: start.toISOString(), end: end.toISOString(), scope, occurrence_start: ev.recurring ? ev.start : undefined };
  if (ev.recurring && scope === "this") body.rrule = null;
  try {
    await api(`/api/events/${ev.event_id}`, { method: "PATCH", body });
  } catch (e) { toast(e.message); }
  refresh(true);
}

// ------------------------------------------------------------------ pointer interactions on the time grid

function minutesAt(col, clientY, snap) {
  const r = col.getBoundingClientRect();
  const mins = ((clientY - r.top) / HOUR()) * 60;
  return Math.max(0, Math.min(24 * 60, Math.round(mins / snap) * snap));
}
function colAt(x, y) { return document.elementsFromPoint(x, y).find((el) => el.classList?.contains("col")); }

function bindGrid(main) {
  let drag = null;
  main.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const col = e.target.closest(".col");
    if (!col) return;
    const evEl = e.target.closest(".ev");
    if (evEl) {
      const ev = findEvent(evEl.dataset.ev);
      if (!ev || ev.read_only || ev.kind !== "event" || e.pointerType === "touch") return;
      drag = { type: e.target.classList.contains("resize") ? "resize" : "move", ev, el: evEl, x0: e.clientX, y0: e.clientY,
               col0: col, startMin: minutesAt(col, e.clientY, 15), moved: false };
    } else if (e.pointerType !== "touch") {
      drag = { type: "create", col0: col, y0: e.clientY, x0: e.clientX, startMin: minutesAt(col, e.clientY, 15), moved: false };
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    const hour = HOUR();
    if (drag.type === "create") {
      const cur = minutesAt(drag.col0, e.clientY, 15);
      const a = Math.min(drag.startMin, cur), b = Math.max(drag.startMin, cur, a + 15);
      if (!drag.ghost) { drag.ghost = document.createElement("div"); drag.ghost.className = "ev ghost"; drag.col0.appendChild(drag.ghost); }
      Object.assign(drag.ghost.style, { top: `${a / 60 * hour}px`, height: `${(b - a) / 60 * hour}px`, left: "0", width: "calc(100% - 4px)" });
      const d = parseYMD(drag.col0.dataset.date);
      drag.ghost.innerHTML = `<div class="s">${fmtTime(new Date(d.getTime() + a * 60000))} – ${fmtTime(new Date(d.getTime() + b * 60000))}</div>`;
      drag.range = [a, b];
    } else {
      drag.el.classList.add("dragging");
      const s = evStart(drag.ev), en = evEnd(drag.ev);
      const col = colAt(e.clientX, e.clientY) || drag.col0;
      if (drag.type === "move") {
        const dayShift = Number(col.dataset.col) - Number(drag.col0.dataset.col);
        const minShift = Math.round(((e.clientY - drag.y0) / hour) * 60 / 15) * 15;
        drag.newStart = new Date(addDays(s, dayShift).getTime() + minShift * 60000);
        drag.newEnd = new Date(drag.newStart.getTime() + (en - s));
        if (col !== drag.el.parentElement) { col.appendChild(drag.el); drag.el.style.left = "0"; drag.el.style.width = "calc(100% - 4px)"; }
        drag.el.style.top = `${(drag.newStart.getHours() * 60 + drag.newStart.getMinutes()) / 60 * hour}px`;
      } else {
        const endMin = minutesAt(drag.col0, e.clientY, 15);
        const d = parseYMD(drag.col0.dataset.date);
        drag.newStart = s;
        drag.newEnd = new Date(Math.max(d.getTime() + endMin * 60000, s.getTime() + 15 * 60000));
        drag.el.style.height = `${(drag.newEnd - Math.max(s, d)) / 3600000 * hour - 2}px`;
      }
      $(".s", drag.el).textContent = `${fmtTime(drag.newStart)} – ${fmtTime(drag.newEnd)}`;
    }
  });
  window.addEventListener("pointerup", () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return; // plain clicks handled by click handler
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (d.type === "create") {
      const day = parseYMD(d.col0.dataset.date);
      d.ghost?.remove();
      openEditor(null, { start: new Date(day.getTime() + d.range[0] * 60000), end: new Date(day.getTime() + d.range[1] * 60000) });
    } else if (d.newStart && (+d.newStart !== +evStart(d.ev) || +d.newEnd !== +evEnd(d.ev))) {
      moveEvent(d.ev, d.newStart, d.newEnd);
    } else refresh(true);
  });
  window.addEventListener("pointercancel", () => { drag?.ghost?.remove(); drag = null; });
}
let suppressClick = false;

// ------------------------------------------------------------------ calendars & settings dialogs

function calendarDialog(cal) {
  const m = openModal(`<div class="modal-head"><h2>${esc(cal.name)}</h2><button class="icon-btn" data-x>${icon("close")}</button></div>
    <div class="modal-body">
      <div class="field"><span>Name</span><input type="text" id="cName" value="${esc(cal.name)}"></div>
      <div class="field"><span>Color</span><div class="colors" id="cColor">${COLORS.map((c) => `<button type="button" style="--c:${c}" data-color="${c}" class="${c === cal.color ? "on" : ""}"></button>`).join("")}</div></div>
      <div class="field"><span>Default notifications (minutes before; comma separated, blank for none)</span>
        <input type="text" id="cRem" value="${esc((cal.default_reminders || []).join(", "))}"></div>
      ${cal.source === "ics" ? `<div class="field"><span>Feed URL</span><input type="url" id="cUrl" value="${esc(cal.url || "")}"></div>` : ""}
      <label class="toggle" style="margin:8px 0"><input type="checkbox" id="cAssign" ${cal.assignments ? "checked" : ""}>
        Show in Assignments</label>
      <p class="muted" style="font-size:12px;margin:0 0 8px">Lists this calendar's events on the Assignments tab so you can check them off - handy for Canvas.</p>
      ${cal.source !== "local" ? `<p class="muted">Source: ${esc({ ics: "Subscribed feed (read-only)", google: "Google Calendar", microsoft: "Outlook / Microsoft 365" }[cal.source])}
        ${cal.account_email ? " · " + esc(cal.account_email) : ""}<br>Last synced: ${cal.last_synced ? new Date(cal.last_synced * 1000).toLocaleString() : "never"}</p>` : ""}
      ${cal.sync_error ? `<p class="error">Sync error: ${esc(cal.sync_error)}</p>` : ""}
    </div>
    <div class="modal-foot">
      ${cal.source === "local" || cal.source === "ics" ? `<button class="btn danger left" data-del>${cal.source === "ics" ? "Unsubscribe" : "Delete"}</button>` : ""}
      ${cal.source !== "local" ? `<button class="btn text" data-sync>Sync now</button>` : ""}
      <button class="btn primary" data-save>Save</button>
    </div>`);
  let color = cal.color;
  $("#cColor", m).onclick = (e) => {
    const b = e.target.closest("[data-color]"); if (!b) return;
    color = b.dataset.color; $$("#cColor button", m).forEach((x) => x.classList.toggle("on", x === b));
  };
  $("[data-x]", m).onclick = closeModal;
  $("[data-save]", m).onclick = async () => {
    const body = { name: $("#cName", m).value, color, assignments: $("#cAssign", m).checked,
      default_reminders: $("#cRem", m).value.split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => n >= 0) };
    if ($("#cUrl", m)) body.url = $("#cUrl", m).value;
    try { await api(`/api/calendars/${cal.id}`, { method: "PATCH", body }); closeModal(); await loadCalendars(); refresh(true); }
    catch (e) { toast(e.message); }
  };
  $("[data-sync]", m)?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Syncing…";
    try { await api(`/api/calendars/${cal.id}/sync`, { method: "POST" }); await loadCalendars(); closeModal(); toast("Synced"); refresh(true); }
    catch (ex) { toast(ex.message); e.target.disabled = false; e.target.textContent = "Sync now"; }
  });
  $("[data-del]", m)?.addEventListener("click", async () => {
    if (!confirm(`${cal.source === "ics" ? "Unsubscribe from" : "Delete"} "${cal.name}"${cal.source === "local" ? " and all its events" : ""}?`)) return;
    try { await api(`/api/calendars/${cal.id}`, { method: "DELETE" }); closeModal(); await loadCalendars(); refresh(true); }
    catch (e) { toast(e.message); }
  });
}

const FEED_HELP = {
  canvas: `<b>Canvas</b><ol><li>In Canvas, open <b>Calendar</b> from the left menu.</li>
    <li>Click <b>Calendar Feed</b> (bottom right on desktop) and copy the link.</li><li>Paste it below.</li></ol>`,
  outlook: `<b>Outlook (read-only feed)</b><ol><li>Go to outlook.com (or Outlook on the web) → <b>Settings</b> → <b>Calendar</b> → <b>Shared calendars</b>.</li>
    <li>Under <b>Publish a calendar</b>, choose a calendar and <b>Can view all details</b>, then <b>Publish</b>.</li>
    <li>Copy the <b>ICS</b> link and paste it below.</li></ol>For two-way sync use <b>Connect Outlook</b> in Settings instead.`,
  google: `<b>Google (read-only feed)</b><ol><li>Open Google Calendar on a computer → ⚙ <b>Settings</b> → pick your calendar on the left.</li>
    <li>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</li><li>Paste it below.</li></ol>For two-way sync use <b>Connect Google</b> in Settings instead.`,
  other: `Paste any public <b>.ics</b> / <b>webcal://</b> calendar link (holidays, sports schedules, other apps…).`,
};

function addCalendarDialog(tab = "new") {
  const m = openModal(`<div class="modal-head"><h2>Add calendar</h2><button class="icon-btn" data-x>${icon("close")}</button></div>
    <div class="modal-body">
      <div class="tabs"><button data-tab="new">Create new</button><button data-tab="feed">Subscribe by URL</button><button data-tab="connect">Connect account</button></div>
      <div id="tabBody"></div>
    </div>`, { wide: true });
  $("[data-x]", m).onclick = closeModal;
  const show = (t) => {
    $$(".tabs button", m).forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    const body = $("#tabBody", m);
    if (t === "new") {
      body.innerHTML = `<div class="field"><span>Name</span><input type="text" id="nName" placeholder="e.g. Work, Gym, Family"></div>
        <div class="field"><span>Color</span><div class="colors" id="nColor">${COLORS.map((c, i) => `<button type="button" style="--c:${c}" data-color="${c}" class="${i === 6 ? "on" : ""}"></button>`).join("")}</div></div>
        <div class="modal-foot" style="padding:12px 0 8px"><button class="btn primary" id="nSave">Create calendar</button></div>`;
      let color = COLORS[6];
      $("#nColor", m).onclick = (e) => { const b = e.target.closest("[data-color]"); if (!b) return; color = b.dataset.color; $$("#nColor button", m).forEach((x) => x.classList.toggle("on", x === b)); };
      $("#nSave", m).onclick = async () => {
        try { await api("/api/calendars", { method: "POST", body: { type: "local", name: $("#nName", m).value, color } }); closeModal(); await loadCalendars(); refresh(true); }
        catch (e) { toast(e.message); }
      };
    } else if (t === "feed") {
      body.innerHTML = `<div class="chips" id="feedKind"><button class="chip on" data-k="canvas">Canvas</button><button class="chip" data-k="outlook">Outlook</button>
          <button class="chip" data-k="google">Google</button><button class="chip" data-k="other">Other</button></div>
        <div class="help" id="feedHelp">${FEED_HELP.canvas}</div>
        <div class="field"><span>Calendar URL</span><input type="url" id="fUrl" placeholder="https://… or webcal://…"></div>
        <div class="row"><div class="field grow"><span>Name</span><input type="text" id="fName" value="Canvas"></div>
          <div class="field"><span>Color</span><div class="colors" id="fColor">${COLORS.map((c, i) => `<button type="button" style="--c:${c}" data-color="${c}" class="${i === 2 ? "on" : ""}"></button>`).join("")}</div></div></div>
        <label class="toggle" style="margin:4px 0"><input type="checkbox" id="fAssign" checked> Show in Assignments (check items off as you finish them)</label>
        <p class="error" id="fErr" hidden></p>
        <div class="modal-foot" style="padding:12px 0 8px"><button class="btn primary" id="fSave">Subscribe</button></div>`;
      let color = COLORS[2];
      $("#feedKind", m).onclick = (e) => {
        const k = e.target.closest("[data-k]")?.dataset.k; if (!k) return;
        $$("#feedKind .chip", m).forEach((c) => c.classList.toggle("on", c.dataset.k === k));
        $("#feedHelp", m).innerHTML = FEED_HELP[k];
        $("#fName", m).value = { canvas: "Canvas", outlook: "Outlook", google: "Google", other: "" }[k];
        $("#fAssign", m).checked = k === "canvas";
      };
      $("#fColor", m).onclick = (e) => { const b = e.target.closest("[data-color]"); if (!b) return; color = b.dataset.color; $$("#fColor button", m).forEach((x) => x.classList.toggle("on", x === b)); };
      $("#fSave", m).onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = "Subscribing…";
        try {
          await api("/api/calendars", { method: "POST", body: { type: "ics", url: $("#fUrl", m).value, name: $("#fName", m).value || "Subscribed", color,
            assignments: $("#fAssign", m).checked } });
          closeModal(); await loadCalendars(); refresh(true);
          const bad = state.calendars.filter((c) => c.source === "ics" && c.sync_error).pop();
          if (bad) toast(`Subscribed, but sync failed: ${bad.sync_error}`); else toast("Subscribed");
        } catch (ex) { $("#fErr", m).textContent = ex.message; $("#fErr", m).hidden = false; e.target.disabled = false; e.target.textContent = "Subscribe"; }
      };
    } else {
      body.innerHTML = connectHtml();
      bindConnect(body);
    }
  };
  $(".tabs", m).onclick = (e) => { const t = e.target.closest("[data-tab]")?.dataset.tab; if (t) show(t); };
  show(tab);
}

function connectHtml() {
  const p = state.me?.providers || {};
  const accts = state.accounts.map((a) => `<div class="acct"><span class="grow">${a.provider === "google" ? "Google" : "Outlook"} · ${esc(a.email || "")}</span>
    <button class="btn text danger" data-disconnect="${a.id}">Disconnect</button></div>`).join("");
  const setup = (name, envs, uri, console) => `<div class="help"><b>${name} isn't set up on this server yet.</b> Create an OAuth app in ${console}, use
    <span class="code">${esc(uri)}</span> as the redirect URI, then set ${envs} in your <span class="code">.env</span> and restart. See README for step-by-step instructions.</div>`;
  return `<p>Two-way sync: events you create or edit here also appear in Google / Outlook, and theirs appear here.</p>
    ${accts ? `<h3 style="font-size:14px;font-weight:500">Connected accounts</h3>${accts}` : ""}
    <div class="row" style="margin:12px 0">
      <button class="btn outline" data-connect="google" ${p.google ? "" : "disabled"}>Connect Google</button>
      <button class="btn outline" data-connect="microsoft" ${p.microsoft ? "" : "disabled"}>Connect Outlook</button>
    </div>
    ${p.google ? "" : setup("Google", '<span class="code">GOOGLE_CLIENT_ID</span> and <span class="code">GOOGLE_CLIENT_SECRET</span>', state.me?.redirect_uris?.google || "", "Google Cloud Console")}
    ${p.microsoft ? "" : setup("Outlook", '<span class="code">MS_CLIENT_ID</span> and <span class="code">MS_CLIENT_SECRET</span>', state.me?.redirect_uris?.microsoft || "", "Azure Portal (App registrations)")}
    <p class="muted">Canvas has no two-way API for personal calendars - use “Subscribe by URL” for it.</p>`;
}
function bindConnect(root) {
  root.onclick = async (e) => {
    const c = e.target.closest("[data-connect]")?.dataset.connect;
    if (c) location.href = `/api/oauth/${c}/start`;
    const d = e.target.closest("[data-disconnect]")?.dataset.disconnect;
    if (d && confirm("Disconnect this account? Its calendars will be removed from this app (nothing is deleted from the account).")) {
      await api(`/api/accounts/${d}`, { method: "DELETE" });
      await loadCalendars(); refresh(true);
      root.innerHTML = connectHtml();
    }
  };
}

function settingsDialog(tab = "general") {
  const m = openModal(`<div class="modal-head"><h2>Settings</h2><button class="icon-btn" data-x>${icon("close")}</button></div>
    <div class="modal-body">
      <div class="tabs"><button data-tab="general">General</button><button data-tab="notify">Notifications</button>
        <button data-tab="sync">Sync</button><button data-tab="app">Install</button><button data-tab="account">Account</button><button data-tab="conn">Connection</button></div>
      <div id="setBody"></div></div>`, { wide: true });
  $("[data-x]", m).onclick = closeModal;
  const show = async (t) => {
    $$(".tabs button", m).forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    const body = $("#setBody", m);
    if (t === "general") {
      body.innerHTML = `<div class="settings-section"><h3>View</h3>
        <div class="field"><span>Start of week</span><select id="sWeek"><option value="0">Sunday</option><option value="1">Monday</option><option value="6">Saturday</option></select></div>
        <div class="field"><span>Time format</span><select id="s24"><option value="0">1:00pm</option><option value="1">13:00</option></select></div>
        <div class="field"><span>Default view</span><select id="sView"><option value="day">Day</option><option value="3day">3 days</option><option value="week">Week</option><option value="month">Month</option><option value="schedule">Schedule</option></select></div></div>
        <div class="settings-section"><h3>Keyboard shortcuts</h3><p class="muted">T today · J/K or ←/→ next/previous · D day · X 3 days · W week · M month · A schedule · C create · / search · Esc close</p></div>`;
      $("#sWeek", m).value = String(prefs.weekStart); $("#s24", m).value = prefs.hour24 ? "1" : "0"; $("#sView", m).value = state.view;
      $("#sWeek", m).onchange = (e) => { prefs.weekStart = Number(e.target.value); savePrefs(); refresh(true); };
      $("#s24", m).onchange = (e) => { prefs.hour24 = e.target.value === "1"; savePrefs(); render(); };
      $("#sView", m).onchange = (e) => setView(e.target.value);
    } else if (t === "notify") {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const secure = window.isSecureContext;
      const perm = "Notification" in window ? Notification.permission : "unsupported";
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
      let sub = null;
      if (supported && secure) { try { sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch {} }
      body.innerHTML = `<div class="settings-section"><h3>Event reminders on this device</h3>
        ${!secure ? `<p class="error">Notifications need HTTPS (or localhost). Put the app behind HTTPS - see README.</p>` : ""}
        ${iOS && !standalone ? `<div class="help">On iPhone/iPad, first add this app to your Home Screen (Share → Add to Home Screen), open it from there, then enable notifications.</div>` : ""}
        ${!supported ? `<p class="error">This browser doesn't support push notifications.</p>` : ""}
        <p>Status: <b>${sub ? "On" : perm === "denied" ? "Blocked in browser settings" : "Off"}</b></p>
        <div class="row">${sub ? `<button class="btn outline" id="nOff">Turn off</button><button class="btn text" id="nTest">Send test notification</button>`
          : `<button class="btn primary" id="nOn" ${supported && secure && perm !== "denied" ? "" : "disabled"}>Turn on notifications</button>`}</div>
        <p class="muted">Reminders are sent by your server, so they arrive even when the app is closed. Set default reminder times per calendar from the ⋮ menu next to it.</p></div>`;
      $("#nOn", m)?.addEventListener("click", async () => {
        try { await ensurePushSubscription(true); toast("Notifications on"); show("notify"); } catch (e) { toast(e.message); }
      });
      $("#nOff", m)?.addEventListener("click", async () => {
        try { await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); show("notify"); } catch (e) { toast(e.message); }
      });
      $("#nTest", m)?.addEventListener("click", async () => {
        try { const r = await api("/api/push/test", { method: "POST" }); toast(r.sent ? `Sent to ${r.sent} device${r.sent > 1 ? "s" : ""}` : "No devices subscribed"); } catch (e) { toast(e.message); }
      });
    } else if (t === "sync") {
      body.innerHTML = `<div class="settings-section"><h3>Google & Outlook accounts</h3><div id="conn">${connectHtml()}</div></div>
        <div class="settings-section"><h3>Subscribed feeds (Canvas, etc.)</h3>
          <p>Add feeds from <b>+</b> next to “My calendars” → Subscribe by URL. They refresh automatically.</p>
          <button class="btn outline" id="syncNow">Sync everything now</button></div>
        <div class="settings-section"><h3>Show this calendar in other apps</h3>
          <p>Subscribe to this link from Google Calendar (“Other calendars → From URL”), Outlook or Apple Calendar to see your local events there (read-only):</p>
          <p><span class="code" id="icsUrl">${esc(state.me?.ics_url || "")}</span></p>
          <button class="btn text" id="copyIcs" style="padding-left:0">Copy link</button>
          <p class="muted">Keep this link private - anyone with it can see your events.</p></div>`;
      bindConnect($("#conn", m));
      $("#syncNow", m).onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = "Syncing…";
        try { await api("/api/sync", { method: "POST" }); await loadCalendars(); refresh(true); toast("Sync complete"); } catch (ex) { toast(ex.message); }
        e.target.disabled = false; e.target.textContent = "Sync everything now";
      };
      $("#copyIcs", m).onclick = () => navigator.clipboard?.writeText(state.me.ics_url).then(() => toast("Copied"), () => toast("Copy failed"));
    } else if (t === "conn") {
      body.innerHTML = `<div class="settings-section"><p class="muted">Checking…</p></div>`;
      const report = await connectionReport();
      const row = (k, v, bad) => `<div class="conn-row${bad ? " bad" : ""}"><span>${esc(k)}</span><b>${esc(String(v ?? "-"))}</b></div>`;
      const pageHttps = report.page.protocol === "https:";
      const insecure = pageHttps ? report.resources.filter((r) => !/^(https|data|blob):/.test(r.url)) : [];
      body.innerHTML = `<div class="settings-section"><h3>This page</h3>
          ${row("Address", report.page.protocol, report.page.protocol !== "https:")}
          ${row("Secure context", report.page.secureContext ? "yes" : "no", !report.page.secureContext)}
          ${row("Opened as", report.page.displayMode)}
          ${row("Service worker", report.page.serviceWorker)}
          ${row("App version", report.page.swVersion)}
        </div>
        <div class="settings-section"><h3>What the server sees</h3>
          ${report.server.error ? row("Error", report.server.error, true) : `
          ${row("Request arrived as", report.server.scheme_seen_by_app, report.page.protocol === "https:" && report.server.scheme_seen_by_app !== "https")}
          ${row("Proxy says (X-Forwarded-Proto)", report.server.x_forwarded_proto)}
          ${row("Host", report.server.host)}
          ${row("CAL_BASE_URL", report.server.base_url_setting, report.page.protocol === "https:" && !String(report.server.base_url_setting).startsWith("https:"))}`}
        </div>
        <div class="settings-section"><h3>Loaded by this page (${report.resources.length})</h3>
          <p>${!pageHttps ? `<b class="error">This page was opened over plain http://, so nothing on it is encrypted.</b>`
            : insecure.length ? `<b class="error">${insecure.length} insecure item${insecure.length > 1 ? "s" : ""}</b> (marked in red)` : "✅ Everything loaded over HTTPS"}</p>
          <div class="conn-list">${report.resources.map((r) => `<div class="${insecure.includes(r) ? "bad" : ""}">
            <span class="code">${esc(r.type)}</span> ${esc(r.url)}</div>`).join("")}</div>
          ${report.violations.length ? `<p class="error">Blocked by browser:</p><div class="conn-list">${report.violations.map((v) => `<div class="bad">${esc(v)}</div>`).join("")}</div>` : ""}
          <div class="row" style="margin-top:10px"><button class="btn outline" id="connCopy">Copy report</button>
            <button class="btn text" id="connAgain">Check again</button></div></div>`;
      $("#connCopy", m).onclick = () => navigator.clipboard?.writeText(JSON.stringify(report, null, 2))
        .then(() => toast("Report copied"), () => toast("Copy failed - take a screenshot instead"));
      $("#connAgain", m).onclick = () => show("conn");
    } else if (t === "app") {
      const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
      body.innerHTML = `<div class="settings-section"><h3>Install as an app</h3>
        ${standalone ? "<p>✅ You're using the installed app.</p>" : ""}
        ${installPrompt ? `<button class="btn primary" id="doInstall">Install Calendar</button>` : ""}
        <div class="help"><b>Android (Chrome):</b> menu ⋮ → <b>Install app</b> / Add to Home screen.<br>
        <b>iPhone / iPad (Safari):</b> Share button → <b>Add to Home Screen</b>.<br>
        <b>Windows / Mac (Chrome or Edge):</b> click the install icon in the address bar, or menu → <b>Install Calendar</b>.</div></div>`;
      $("#doInstall", m)?.addEventListener("click", async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; show("app"); });
    } else {
      body.innerHTML = `<div class="settings-section"><h3>Change password</h3>
        <div class="field"><span>Current password</span><input type="password" id="pCur" autocomplete="current-password"></div>
        <div class="field"><span>New password</span><input type="password" id="pNew" autocomplete="new-password"></div>
        <button class="btn outline" id="pSave">Update password</button></div>
        <div class="settings-section"><h3>Sign out</h3><button class="btn outline" id="logout">Sign out of this device</button></div>`;
      $("#pSave", m).onclick = async () => {
        try { await api("/api/password", { method: "POST", body: { current: $("#pCur", m).value, new: $("#pNew", m).value } }); toast("Password updated"); }
        catch (e) { toast(e.message); }
      };
      $("#logout", m).onclick = async () => { await api("/api/logout", { method: "POST" }); location.reload(); };
    }
  };
  $(".tabs", m).onclick = (e) => { const t = e.target.closest("[data-tab]")?.dataset.tab; if (t) show(t); };
  show(tab);
}

// ------------------------------------------------------------------ small shared dialogs

function promptDialog(title, value = "", placeholder = "") {
  return new Promise((resolve) => {
    const m = openModal(`<form id="promptForm"><div class="modal-head"><h2>${esc(title)}</h2></div>
      <div class="modal-body"><input type="text" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" style="width:100%" autocomplete="off"></div>
      <div class="modal-foot"><button type="button" class="btn text" data-x>Cancel</button><button class="btn primary">Save</button></div></form>`);
    const f = $("#promptForm", m);
    setTimeout(() => { f.v.focus(); f.v.select(); }, 50);
    $("[data-x]", m).onclick = () => { closeModal(); resolve(null); };
    f.onsubmit = (e) => { e.preventDefault(); const v = f.v.value.trim(); closeModal(); resolve(v || null); };
  });
}

function colorPicker(selected, { allowNone = false } = {}) {
  return `<div class="colors" data-colors>${allowNone ? `<button type="button" class="none ${!selected ? "on" : ""}" data-color="" title="None"></button>` : ""}
    ${COLORS.map((c) => `<button type="button" style="--c:${c}" data-color="${c}" class="${c === selected ? "on" : ""}"></button>`).join("")}</div>`;
}
function bindColorPicker(root, onPick) {
  const el = $("[data-colors]", root);
  el.onclick = (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    $$("button", el).forEach((x) => x.classList.toggle("on", x === b));
    onPick(b.dataset.color);
  };
}

let openMenuEl = null;
function showMenu(anchor, items) {
  closeMenu();
  const el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? "danger" : ""}">${esc(it.label)}</button>`).join("");
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = `${Math.min(r.bottom + 4, innerHeight - el.offsetHeight - 8)}px`;
  el.style.left = `${Math.max(8, Math.min(r.right - el.offsetWidth, innerWidth - el.offsetWidth - 8))}px`;
  el.onclick = (e) => { const i = e.target.closest("[data-i]")?.dataset.i; if (i != null) { closeMenu(); items[i].run(); } };
  openMenuEl = el;
  setTimeout(() => document.addEventListener("pointerdown", menuOutside, true), 0);
}
function menuOutside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
  document.removeEventListener("pointerdown", menuOutside, true);
}

// Due date + optional time fields, shared by the assignment and card editors.
function dueFields(due, allDay) {
  const d = due ? (allDay ? parseYMD(due) : new Date(due)) : null;
  return `<div class="when-row" style="grid-template-columns:56px 1fr 120px"><span>Due</span>
    <input type="date" name="dueDate" value="${d ? ymd(d) : ""}">
    <input type="time" name="dueTime" value="${d && !allDay ? hm(d) : ""}" step="300"></div>
    <p class="muted" style="font-size:12px;margin:4px 0 0">Leave the time empty for "due that day"; clear the date for no due date.</p>`;
}
function readDue(f) {
  if (!f.dueDate.value) return { due: null, all_day: false };
  if (!f.dueTime.value) return { due: f.dueDate.value, all_day: true };
  return { due: new Date(`${f.dueDate.value}T${f.dueTime.value}`).toISOString(), all_day: false };
}

async function toggleDone(item) {
  const done = !item.done;
  try {
    if (item.kind === "task") await api(`/api/tasks/${item.task_id}`, { method: "PATCH", body: { done } });
    else if (item.kind === "card") await api(`/api/cards/${item.card_id}`, { method: "PATCH", body: { done } });
    else await api("/api/event-done", { method: "POST", body: { calendar_id: item.calendar_id, key: item.done_key, done } });
    toast(done ? "Marked complete" : "Marked not done", { label: "Undo", run: () => toggleDone({ ...item, done }) });
    await refresh(true);
    loadTaskBadge();
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ assignments

const TASK_REMINDERS = [[0, "At due time"], [60, "1 hour before"], [1440, "1 day before"], [2880, "2 days before"], [10080, "1 week before"]];
const GROUPS = [["overdue", "Overdue"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["later", "Later"], ["none", "No due date"]];

function fmtDue(item) {
  if (!item.due) return "No due date";
  const d = dueOf(item);
  const day = fmtDate(d, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return item.all_day ? `Due ${day}` : `Due ${day}, ${fmtTime(d, false)}`;
}
// End of the day for date-only deadlines; the exact time otherwise.
function deadline(item) { const d = dueOf(item); return item.all_day ? addDays(d, 1) : d; }
function groupOf(item) {
  if (!item.due) return "none";
  const now = new Date();
  if (deadline(item) <= now) return "overdue";
  const days = dayDiff(now, dueOf(item));
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? "week" : "later";
}
function relDue(item) {
  if (!item.due || item.done) return "";
  const now = new Date();
  if (deadline(item) <= now) {
    const late = dayDiff(dueOf(item), now);
    return `<span class="late">${late <= 0 ? "Overdue" : `${late} day${late > 1 ? "s" : ""} late`}</span>`;
  }
  const days = dayDiff(now, dueOf(item));
  if (days <= 0) {
    if (item.all_day) return "today";
    const h = Math.round((dueOf(item) - now) / 3600000);
    return h < 1 ? `<span class="late">in ${Math.max(1, Math.round((dueOf(item) - now) / 60000))} min</span>` : `in ${h}h`;
  }
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

function assignmentItems() {
  const a = state.assignments || { tasks: [], feed: [] };
  const cutoff = addDays(new Date(), -14);
  const tasks = a.tasks.map((t) => ({ ...t, kind: "task", task_id: t.id, key: `t:${t.id}` }));
  // Feeds (Canvas etc.) carry months of history: skip old items unless they're still open and recent.
  const feed = a.feed.filter((f) => !f.due || deadline(f) >= cutoff || (!f.done && deadline(f) >= addDays(new Date(), -30)))
    .map((f) => ({ ...f, assignment: true, key: `f:${f.id}`, calendar_name: calById(f.calendar_id)?.name || "" }));
  return [...tasks, ...feed];
}

async function loadAssignments() {
  state.assignments = await api("/api/assignments");
  updateTaskBadge();
}
async function loadTaskBadge() { try { await loadAssignments(); } catch {} }
function updateTaskBadge() {
  const n = assignmentItems().filter((i) => !i.done && ["overdue", "today"].includes(groupOf(i))).length;
  for (const id of ["#taskBadge", "#taskBadgeMobile"]) { const b = $(id); b.hidden = !n; b.textContent = n; }
}

async function refreshTasks(token, quiet) {
  if (!quiet || !state.assignments) render();
  try { await loadAssignments(); } catch (e) { if (e.message !== "Not signed in") toast(e.message); }
  if (token === loadToken) render();
}

function taskItemHtml(i) {
  return `<div class="task-item${i.done ? " done" : ""}" data-item="${esc(i.key)}" style="--c:${esc(i.color || "#8e24aa")}">
    <button class="tick" data-tick="${esc(i.key)}" aria-label="${i.done ? "Mark not done" : "Mark complete"}">
      <svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></button>
    <div class="ti-main"><div class="ti-title">${esc(i.title)}</div>
      <div class="ti-meta">${i.course ? `<span class="course-chip">${esc(i.course)}</span>` : ""}<span>${esc(fmtDue(i))}</span>
        ${relDue(i) ? `<span>· ${relDue(i)}</span>` : ""}
        ${i.kind === "event" ? `<span class="ti-src">from ${esc(i.calendar_name)}</span>` : ""}</div></div></div>`;
}

function renderTasks(main) {
  if (!state.assignments) { main.innerHTML = `<div class="tasks-view"><div class="empty-state">Loading…</div></div>`; return; }
  const items = assignmentItems();
  const courses = [...new Set(items.map((i) => i.course).filter(Boolean))].sort();
  if (state.courseFilter && !courses.includes(state.courseFilter)) state.courseFilter = null;
  const shown = items.filter((i) => (!state.courseFilter || i.course === state.courseFilter));
  const todo = shown.filter((i) => !i.done), done = shown.filter((i) => i.done);
  let body;
  if (prefs.taskFilter === "done") {
    done.sort((a, b) => (b.done_at || 0) - (a.done_at || 0) || String(b.due).localeCompare(String(a.due)));
    body = done.length ? `<div class="task-group"><h3>Completed</h3>${done.map(taskItemHtml).join("")}</div>`
      : `<div class="empty-state"><b>Nothing completed yet</b>Check off an assignment and it shows up here.</div>`;
  } else {
    todo.sort((a, b) => (a.due ? deadline(a) : Infinity) - (b.due ? deadline(b) : Infinity));
    body = GROUPS.map(([g, label]) => {
      const list = todo.filter((i) => groupOf(i) === g);
      return list.length ? `<div class="task-group ${g}"><h3>${label} · ${list.length}</h3>${list.map(taskItemHtml).join("")}</div>` : "";
    }).join("") || `<div class="empty-state"><b>All caught up 🎉</b>Add an assignment above${state.calendars.some((c) => c.assignments) ? "" :
      ', or turn on "Show in Assignments" for your Canvas calendar (⋮ next to it in the calendar sidebar)'}.</div>`;
  }
  main.innerHTML = `<div class="tasks-view"><div class="tasks-inner">
    <form class="quick-add" id="quickTask" autocomplete="off">
      <input name="title" placeholder="Add an assignment…" required>
      <input type="date" name="dueDate" value="${ymd(addDays(new Date(), 1))}" aria-label="Due date">
      <input type="time" name="dueTime" step="300" aria-label="Due time (optional)">
      <input name="course" placeholder="Course" list="courseList" style="width:120px" aria-label="Course">
      <datalist id="courseList">${courses.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      <button class="btn primary">Add</button>
    </form>
    <div class="task-filters">
      <button class="chip ${prefs.taskFilter !== "done" ? "on" : ""}" data-tf="todo">To do · ${todo.length}</button>
      <button class="chip ${prefs.taskFilter === "done" ? "on" : ""}" data-tf="done">Completed · ${done.length}</button>
      ${courses.length > 1 ? `<span style="width:8px"></span><button class="chip ${!state.courseFilter ? "on" : ""}" data-course="">All courses</button>
        ${courses.map((c) => `<button class="chip ${state.courseFilter === c ? "on" : ""}" data-course="${esc(c)}">${esc(c)}</button>`).join("")}` : ""}
    </div>
    ${body}</div></div>`;

  const f = $("#quickTask", main);
  f.course.value = state.courseFilter || prefs.lastCourse || "";
  f.onsubmit = async (e) => {
    e.preventDefault();
    const due = readDue(f);
    try {
      await api("/api/tasks", { method: "POST", body: { title: f.title.value, course: f.course.value, ...due, reminders: prefs.taskReminders ?? [1440] } });
      prefs.lastCourse = f.course.value; savePrefs();
      toast("Assignment added");
      await refresh(true);
      $("#quickTask [name=title]")?.focus();
    } catch (ex) { toast(ex.message); }
  };
}

function bindTasks(main) {
  main.addEventListener("click", (e) => {
    if (state.mode !== "tasks") return;
    const tf = e.target.closest("[data-tf]");
    if (tf) { prefs.taskFilter = tf.dataset.tf; savePrefs(); return render(); }
    const course = e.target.closest("[data-course]");
    if (course) { state.courseFilter = course.dataset.course || null; return render(); }
    const key = (e.target.closest("[data-tick]") || e.target.closest("[data-item]"))?.dataset;
    if (!key) return;
    const item = assignmentItems().find((i) => i.key === (key.tick || key.item));
    if (!item) return;
    if (key.tick) return toggleDone(item);
    if (item.kind === "task") return openTaskEditor(item);
    // A feed item (e.g. Canvas): show its details with "Mark complete" and the link back to the source.
    openPopover({ ...item, id: item.id, start: item.due, end: item.due, description: item.notes, effective_reminders: [],
                  recurring: false, read_only: true, location: "" }, e.target.closest("[data-item]"));
  });
}

function taskFromItem(ev) {
  return { kind: "task", task_id: ev.task_id, id: ev.task_id, title: ev.title, notes: ev.description, course: ev.course,
           color: ev.color, due: ev.due, all_day: ev.all_day, done: ev.done, reminders: ev.reminders || [] };
}

function openTaskEditor(task, defaults = {}) {
  const isNew = !task;
  const t = task || { title: "", notes: "", course: state.courseFilter || prefs.lastCourse || "", color: null,
                      due: defaults.due ?? ymd(addDays(new Date(), 1)), all_day: defaults.all_day ?? true, reminders: prefs.taskReminders ?? [1440] };
  const courses = [...new Set(assignmentItems().map((i) => i.course).filter(Boolean))].sort();
  let color = t.color && t.color !== "#8e24aa" ? t.color : "";
  const rem = new Set(t.reminders || []);
  const m = openModal(`<form id="taskForm">
    <div class="modal-head"><button type="button" class="icon-btn head-x" data-x aria-label="Close">${icon("close")}</button>
      <h2>${isNew ? "New assignment" : "Edit assignment"}</h2><button type="submit" class="btn primary head-save">Save</button></div>
    <div class="modal-body">
      <input class="title-input" name="title" placeholder="Assignment name" value="${esc(t.title === "(No title)" ? "" : t.title)}" required>
      <div class="when">${dueFields(t.due, t.all_day)}</div>
      <div class="field"><span>Course</span><input name="course" list="courseList2" value="${esc(t.course || "")}" placeholder="e.g. MATH 201">
        <datalist id="courseList2">${courses.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
      <div class="field"><span>Remind me</span><div class="chips" id="remChips">${TASK_REMINDERS.map(([v, l]) =>
        `<button type="button" class="chip ${rem.has(v) ? "on" : ""}" data-rem="${v}">${l}</button>`).join("")}</div></div>
      <div class="field"><span>Color</span>${colorPicker(color, { allowNone: true })}</div>
      <div class="field"><span>Notes</span><textarea name="notes" placeholder="Details, links, rubric…">${esc(t.notes || "")}</textarea></div>
      ${!isNew ? `<label class="toggle"><input type="checkbox" name="done" ${t.done ? "checked" : ""}> Completed</label>` : ""}
    </div>
    <div class="modal-foot">
      ${isNew ? "" : `<button type="button" class="btn danger left" data-del>Delete</button>`}
      <button type="button" class="btn text" data-x>Cancel</button>
      <button type="submit" class="btn primary foot-save">Save</button>
    </div></form>`);
  const f = $("#taskForm", m);
  setTimeout(() => f.title.focus(), 50);
  bindColorPicker(m, (c) => (color = c));
  $("#remChips", m).onclick = (e) => {
    const b = e.target.closest("[data-rem]"); if (!b) return;
    const v = Number(b.dataset.rem);
    rem.has(v) ? rem.delete(v) : rem.add(v);
    b.classList.toggle("on", rem.has(v));
  };
  $$("[data-x]", m).forEach((b) => (b.onclick = closeModal));
  $("[data-del]", m)?.addEventListener("click", () => { closeModal(); deleteTask(t.task_id ?? t.id); });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { title: f.title.value, course: f.course.value, notes: f.notes.value, color: color || null,
                   reminders: [...rem], ...readDue(f), ...(isNew ? {} : { done: f.done.checked }) };
    try {
      if (isNew) await api("/api/tasks", { method: "POST", body });
      else await api(`/api/tasks/${t.task_id ?? t.id}`, { method: "PATCH", body });
      if (isNew) { prefs.lastCourse = body.course; prefs.taskReminders = body.reminders; savePrefs(); }
      closeModal();
      toast(isNew ? "Assignment added" : "Assignment updated");
      await refresh(true);
      loadTaskBadge();
    } catch (ex) { toast(ex.message); }
  };
}

async function deleteTask(id) {
  if (!confirm("Delete this assignment?")) return;
  try { await api(`/api/tasks/${id}`, { method: "DELETE" }); toast("Assignment deleted"); await refresh(true); loadTaskBadge(); }
  catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ boards

async function refreshBoards(token, quiet) {
  if (!quiet || !state.boards) render();
  try {
    state.boards = (await api("/api/boards")).boards;
    if (prefs.boardId && state.boards.some((b) => b.id === prefs.boardId)) state.board = await api(`/api/boards/${prefs.boardId}`);
    else { state.board = null; prefs.boardId = null; savePrefs(); }
  } catch (e) { if (e.message !== "Not signed in") toast(e.message); }
  if (token === loadToken && !boardDrag?.active) render();
}

function cardHtml(c) {
  const badges = [];
  if (c.due) {
    const d = c.all_day ? parseYMD(c.due) : new Date(c.due);
    const end = c.all_day ? addDays(d, 1) : d;
    const cls = c.done ? "ok" : end <= new Date() ? "late" : end - new Date() < 86400000 ? "soon" : "";
    badges.push(`<span class="due ${cls}">🕑 ${esc(fmtDate(d, { month: "short", day: "numeric" }))}${c.all_day ? "" : ", " + esc(fmtTime(d))}</span>`);
  }
  if (c.description) badges.push(`<span title="Has description">≡</span>`);
  return `<div class="bcard${c.done ? " done" : ""}" data-card="${c.id}" data-pos="${c.position}" style="--c:${esc(c.label || "transparent")}">
    ${c.label ? '<div class="lbl"></div>' : ""}<div class="bt">${esc(c.title)}</div>
    ${badges.length ? `<div class="badges">${badges.join("")}</div>` : ""}</div>`;
}

function renderBoards(main) {
  if (!state.boards) { main.innerHTML = `<div class="boards-home"><div class="empty-state">Loading…</div></div>`; return; }
  if (!state.board || !prefs.boardId) {
    main.innerHTML = `<div class="boards-home"><div class="board-tiles">
      ${state.boards.map((b) => `<button class="board-tile" data-open-board="${b.id}" style="--c:${esc(b.color)}">${esc(b.name)}
        <small>${b.cards} card${b.cards === 1 ? "" : "s"}</small></button>`).join("")}
      <button class="board-tile new" data-new-board>+ Create new board</button></div>
      ${state.boards.length ? "" : `<div class="empty-state"><b>Organize anything with boards</b>Make a board for a class project, a job search or chores, then drag cards between lists.</div>`}
    </div>`;
    return;
  }
  const { board, lists } = state.board;
  main.innerHTML = `<div class="board" style="--c:${esc(board.color)}">
    <div class="board-bar">
      <button class="icon-btn" data-b="home" title="All boards" aria-label="All boards">${icon("prev")}</button>
      <h2 data-b="rename" title="Rename">${esc(board.name)}</h2><span class="spacer"></span>
      <button class="icon-btn" data-b="menu" title="Board menu" aria-label="Board menu">${icon("more")}</button>
    </div>
    <div class="board-lists">
      ${lists.map((l) => `<div class="blist" data-list="${l.id}">
        <div class="blist-head"><h3 data-l="rename">${esc(l.name)}</h3><span class="count">${l.cards.length}</span>
          <button class="icon-btn small" data-l="menu" aria-label="List menu">${icon("more")}</button></div>
        <div class="bcards" data-cards="${l.id}">${l.cards.map(cardHtml).join("")}</div>
        <div class="blist-foot"><button class="add-card-btn" data-l="add">+ Add a card</button></div>
      </div>`).join("")}
      <div class="blist add-list"><button class="add-card-btn" data-add-list>+ Add another list</button></div>
    </div></div>`;
}

function listById(id) { return state.board?.lists.find((l) => l.id === id); }

function showAddCard(listEl) {
  const foot = $(".blist-foot", listEl);
  foot.innerHTML = `<form class="add-card-form"><textarea name="t" placeholder="Enter a title for this card…"></textarea>
    <div class="row"><button class="btn primary">Add card</button><button type="button" class="icon-btn small" data-cancel aria-label="Cancel">${icon("close")}</button></div></form>`;
  const f = $("form", foot);
  f.t.focus();
  const listId = Number(listEl.dataset.list);
  const submit = async () => {
    const title = f.t.value.trim();
    if (!title) return;
    f.t.value = "";
    try { await api(`/api/lists/${listId}/cards`, { method: "POST", body: { title } }); await refresh(true); }
    catch (ex) { toast(ex.message); }
    const again = $(`[data-list="${listId}"]`);
    if (again) { showAddCard(again); const cards = $(".bcards", again); cards.scrollTop = cards.scrollHeight; }
  };
  f.onsubmit = (e) => { e.preventDefault(); submit(); };
  f.t.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === "Escape") render();
  };
  $("[data-cancel]", f).onclick = () => render();
}

function showAddList(el) {
  el.innerHTML = `<form><input name="n" placeholder="List name" autocomplete="off">
    <div class="row" style="margin-top:6px"><button class="btn primary">Add list</button>
    <button type="button" class="icon-btn small" data-cancel aria-label="Cancel">${icon("close")}</button></div></form>`;
  const f = $("form", el);
  f.n.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.n.value.trim()) return;
    try { await api(`/api/boards/${prefs.boardId}/lists`, { method: "POST", body: { name: f.n.value } }); await refresh(true); }
    catch (ex) { toast(ex.message); }
    // Keep the box open for the next list, scrolled into view.
    const box = $("[data-add-list]")?.parentElement;
    if (box) { showAddList(box); box.scrollIntoView({ inline: "end", block: "nearest", behavior: "smooth" }); }
  };
  f.n.onkeydown = (e) => { if (e.key === "Escape") render(); };
  $("[data-cancel]", f).onclick = () => render();
}

function boardDialog(board) {
  const isNew = !board;
  let color = board?.color || COLORS[5];
  const m = openModal(`<form id="boardForm"><div class="modal-head"><h2>${isNew ? "Create board" : "Board settings"}</h2></div>
    <div class="modal-body"><div class="field"><span>Board name</span><input name="name" value="${esc(board?.name || "")}" placeholder="e.g. Group project" required autocomplete="off"></div>
      <div class="field"><span>Color</span>${colorPicker(color)}</div>
      ${isNew ? `<p class="muted" style="font-size:13px">Starts with To do, Doing and Done lists. You can rename or add more.</p>` : ""}</div>
    <div class="modal-foot">${isNew ? "" : `<button type="button" class="btn danger left" data-del>Delete board</button>`}
      <button type="button" class="btn text" data-x>Cancel</button><button class="btn primary">${isNew ? "Create" : "Save"}</button></div></form>`);
  const f = $("#boardForm", m);
  setTimeout(() => f.name.focus(), 50);
  bindColorPicker(m, (c) => (color = c));
  $("[data-x]", m).onclick = closeModal;
  $("[data-del]", m)?.addEventListener("click", async () => {
    if (!confirm(`Delete the board "${board.name}" and all its cards?`)) return;
    await api(`/api/boards/${board.id}`, { method: "DELETE" });
    closeModal(); prefs.boardId = null; savePrefs(); refresh();
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (isNew) { const r = await api("/api/boards", { method: "POST", body: { name: f.name.value, color } }); prefs.boardId = r.id; savePrefs(); }
      else await api(`/api/boards/${board.id}`, { method: "PATCH", body: { name: f.name.value, color } });
      closeModal();
      refresh();
    } catch (ex) { toast(ex.message); }
  };
}

function openCardDialog(card) {
  const lists = state.board?.lists || [];
  let label = card.label || "";
  const m = openModal(`<form id="cardForm">
    <div class="modal-head"><button type="button" class="icon-btn head-x" data-x aria-label="Close">${icon("close")}</button>
      <h2>Card</h2><button type="submit" class="btn primary head-save">Save</button></div>
    <div class="modal-body">
      <input class="title-input" name="title" value="${esc(card.title === "(No title)" ? "" : card.title)}" placeholder="Card title" required>
      <div class="field"><span>List</span><select name="list">${lists.map((l) => `<option value="${l.id}" ${l.id === card.list_id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
      <div class="field"><span>Label</span>${colorPicker(label, { allowNone: true })}</div>
      <div class="when">${dueFields(card.due, card.all_day)}</div>
      <label class="toggle" style="margin:10px 0"><input type="checkbox" name="done" ${card.done ? "checked" : ""}> Completed</label>
      <div class="field"><span>Description</span><textarea name="description" placeholder="Add a more detailed description…">${esc(card.description || "")}</textarea></div>
      <p class="muted" style="font-size:12px">Cards with a due date also show on your calendar.</p>
    </div>
    <div class="modal-foot"><button type="button" class="btn danger left" data-del>Delete</button>
      <button type="button" class="btn text" data-x>Cancel</button><button type="submit" class="btn primary foot-save">Save</button></div></form>`);
  const f = $("#cardForm", m);
  bindColorPicker(m, (c) => (label = c));
  $$("[data-x]", m).forEach((b) => (b.onclick = closeModal));
  $("[data-del]", m).onclick = () => { closeModal(); deleteCard(card.id); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { title: f.title.value, description: f.description.value, label: label || null, done: f.done.checked, ...readDue(f) };
    if (Number(f.list.value) !== card.list_id) body.list_id = Number(f.list.value);
    try { await api(`/api/cards/${card.id}`, { method: "PATCH", body }); closeModal(); await refresh(true); }
    catch (ex) { toast(ex.message); }
  };
}

async function openCardById(boardId, cardId) {
  try {
    if (state.board?.board.id !== boardId) state.board = await api(`/api/boards/${boardId}`);
    const card = state.board.lists.flatMap((l) => l.cards).find((c) => c.id === cardId);
    if (card) openCardDialog(card);
  } catch (e) { toast(e.message); }
}

async function deleteCard(id) {
  if (!confirm("Delete this card?")) return;
  try { await api(`/api/cards/${id}`, { method: "DELETE" }); toast("Card deleted"); await refresh(true); }
  catch (e) { toast(e.message); }
}

async function moveList(list, dir) {
  const lists = state.board.lists;
  const i = lists.indexOf(list), j = i + dir;
  if (j < 0 || j >= lists.length) return;
  // Swap positions with the neighbour.
  await api(`/api/lists/${list.id}`, { method: "PATCH", body: { position: lists[j].position } });
  await api(`/api/lists/${lists[j].id}`, { method: "PATCH", body: { position: list.position } });
  refresh(true);
}

// Card drag & drop: mouse drags right away; touch needs a long-press so normal swiping still scrolls.
let boardDrag = null;
function bindBoards(main) {
  main.addEventListener("click", async (e) => {
    if (state.mode !== "boards") return;
    if (boardDrag?.justDropped) return;
    const t = e.target;
    const open = t.closest("[data-open-board]");
    if (open) { prefs.boardId = Number(open.dataset.openBoard); savePrefs(); return refresh(); }
    if (t.closest("[data-new-board]")) return boardDialog(null);
    const b = t.closest("[data-b]")?.dataset.b;
    if (b === "home") { prefs.boardId = null; savePrefs(); state.board = null; return refresh(); }
    if (b === "rename" || b === "menu") return boardDialog(state.board.board);
    const listEl = t.closest("[data-list]");
    const l = t.closest("[data-l]")?.dataset.l;
    if (listEl && l) {
      const list = listById(Number(listEl.dataset.list));
      const rename = async () => {
        const name = await promptDialog("Rename list", list.name);
        if (name) { await api(`/api/lists/${list.id}`, { method: "PATCH", body: { name } }); refresh(true); }
      };
      if (l === "add") return showAddCard(listEl);
      if (l === "rename") return rename();
      if (l === "menu") {
        return showMenu(t.closest("[data-l]"), [
          { label: "Add card", run: () => showAddCard(listEl) },
          { label: "Rename list", run: rename },
          { label: "Move list left", run: () => moveList(list, -1) },
          { label: "Move list right", run: () => moveList(list, 1) },
          { label: "Delete list", danger: true, run: async () => {
            if (!confirm(`Delete the list "${list.name}"${list.cards.length ? ` and its ${list.cards.length} card(s)` : ""}?`)) return;
            await api(`/api/lists/${list.id}`, { method: "DELETE" }); refresh(true);
          } },
        ]);
      }
    }
    if (t.closest("[data-add-list]")) return showAddList(t.closest(".add-list"));
    const cardEl = t.closest("[data-card]");
    if (cardEl) {
      const card = state.board.lists.flatMap((x) => x.cards).find((c) => c.id === Number(cardEl.dataset.card));
      if (card) openCardDialog(card);
    }
  });

  main.addEventListener("pointerdown", (e) => {
    if (state.mode !== "boards" || e.button !== 0) return;
    const el = e.target.closest(".bcard");
    if (!el) return;
    boardDrag = { el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType !== "mouse" };
    if (boardDrag.touch) {
      const d = boardDrag;
      d.timer = setTimeout(() => { if (boardDrag === d) { beginCardDrag(d); navigator.vibrate?.(15); } }, 380);
    }
  });
  window.addEventListener("pointermove", (e) => {
    const d = boardDrag;
    if (!d || d.justDropped) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (d.touch && moved > 10) { clearTimeout(d.timer); boardDrag = null; }   // it's a scroll, not a drag
      else if (!d.touch && moved > 5) beginCardDrag(d);
      return;
    }
    moveCardDrag(d);
  });
  const finish = () => {
    const d = boardDrag;
    if (!d) return;
    clearTimeout(d.timer);
    if (d.active) endCardDrag(d);
    else boardDrag = null;
  };
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  // Once a touch drag has started, stop the page from scrolling under the finger.
  document.addEventListener("touchmove", (e) => { if (boardDrag?.active) e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", (e) => { if (boardDrag) e.preventDefault(); });
}

function beginCardDrag(d) {
  const r = d.el.getBoundingClientRect();
  d.active = true;
  d.dx = d.x0 - r.left; d.dy = d.y0 - r.top;
  d.fromList = d.el.closest("[data-list]").dataset.list;
  d.fromIndex = [...d.el.parentElement.children].indexOf(d.el);
  d.clone = d.el.cloneNode(true);
  d.clone.classList.add("drag-clone");
  d.clone.style.width = `${r.width}px`;
  document.body.appendChild(d.clone);
  d.el.classList.add("placeholder");
  $(".board")?.classList.add("dragging");
  moveCardDrag(d);
  const tick = () => { if (!d.active) return; autoScroll(d); d.raf = requestAnimationFrame(tick); };
  d.raf = requestAnimationFrame(tick);
}

function moveCardDrag(d) {
  d.clone.style.left = `${d.x - d.dx}px`;
  d.clone.style.top = `${d.y - d.dy}px`;
  const listEl = document.elementsFromPoint(d.x, d.y).map((n) => n.closest?.("[data-list]")).find(Boolean);
  if (!listEl) return;
  const cards = $(".bcards", listEl);
  const others = [...cards.children].filter((c) => c !== d.el);
  const before = others.find((c) => { const r = c.getBoundingClientRect(); return d.y < r.top + r.height / 2; });
  if (before) { if (d.el.nextElementSibling !== before) cards.insertBefore(d.el, before); }
  else if (cards.lastElementChild !== d.el) cards.appendChild(d.el);
}

function autoScroll(d) {
  const lists = $(".board-lists");
  if (!lists) return;
  const r = lists.getBoundingClientRect();
  const edge = 48;
  if (d.x < r.left + edge) lists.scrollLeft -= 14;
  else if (d.x > r.right - edge) lists.scrollLeft += 14;
  const cards = d.el.closest(".bcards");
  if (cards) {
    const cr = cards.getBoundingClientRect();
    if (d.y < cr.top + 32) cards.scrollTop -= 10;
    else if (d.y > cr.bottom - 32) cards.scrollTop += 10;
  }
  moveCardDrag(d);
}

async function endCardDrag(d) {
  cancelAnimationFrame(d.raf);
  d.active = false;
  d.justDropped = true;
  setTimeout(() => { if (boardDrag === d) boardDrag = null; }, 0);
  d.clone.remove();
  d.el.classList.remove("placeholder");
  $(".board")?.classList.remove("dragging");
  const listEl = d.el.closest("[data-list]");
  const listId = Number(listEl.dataset.list);
  const index = [...d.el.parentElement.children].indexOf(d.el);
  if (String(listId) === d.fromList && index === d.fromIndex) return;
  const prev = d.el.previousElementSibling, next = d.el.nextElementSibling;
  const p = prev ? Number(prev.dataset.pos) : null, n = next ? Number(next.dataset.pos) : null;
  const position = p != null && n != null ? (p + n) / 2 : p != null ? p + 1024 : n != null ? n - 1024 : 1024;
  d.el.dataset.pos = position;
  try {
    await api(`/api/cards/${d.el.dataset.card}`, { method: "PATCH", body: { list_id: listId, position } });
    await refresh(true);
  } catch (e) { toast(e.message); refresh(true); }
}

// ------------------------------------------------------------------ connection check

// Keep every resource the page loads (the browser's default buffer is small) and any URL the
// browser blocks, so Settings → Connection can show them.
try { performance.setResourceTimingBufferSize(2000); } catch {}
const blockedRequests = [];
document.addEventListener("securitypolicyviolation", (e) => blockedRequests.push(`${e.blockedURI} (${e.violatedDirective})`));

async function swVersion() {
  const ctl = navigator.serviceWorker?.controller;
  if (!ctl) return "not controlling this page";
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data?.version || "unknown");
    ctl.postMessage({ type: "version" }, [ch.port2]);
    setTimeout(() => resolve("no answer (old version)"), 1500);
  });
}

async function connectionReport() {
  const seen = new Map();
  const add = (url, type) => { if (url && !seen.has(url)) seen.set(url, { url, type }); };
  const nav = performance.getEntriesByType("navigation")[0];
  add(nav?.name || location.href, "page");
  for (const e of performance.getEntriesByType("resource")) add(e.name.split("?")[0], e.initiatorType);
  for (const el of document.querySelectorAll("link[href], script[src], img[src], iframe[src], source[src], video[src], audio[src]")) {
    add(el.href || el.src, el.tagName.toLowerCase());
  }
  for (const f of document.forms) if (f.getAttribute("action")) add(f.action, "form");
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  let server;
  try { server = await api("/api/connection"); } catch (e) { server = { error: e.message }; }
  return {
    page: {
      url: location.origin, protocol: location.protocol, secureContext: window.isSecureContext,
      displayMode: matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "installed app" : "browser tab",
      serviceWorker: reg?.active?.scriptURL || "none", swVersion: await swVersion(), userAgent: navigator.userAgent,
    },
    server,
    resources: [...seen.values()],
    violations: blockedRequests,
  };
}

// ------------------------------------------------------------------ push

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function ensurePushSubscription(ask) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push not supported in this browser");
  if (ask) {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notification permission was not granted");
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = b64ToBytes(state.me.vapid_public_key);
  if (sub && sub.options?.applicationServerKey) {
    const cur = new Uint8Array(sub.options.applicationServerKey);
    if (cur.length !== key.length || cur.some((b, i) => b !== key[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api("/api/push/subscribe", { method: "POST", body: sub.toJSON() });
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "open-event" && e.data.url) {
      const q = new URL(e.data.url, location.origin).searchParams;
      if (q.get("start")) { state.pendingEvent = q.get("event"); gotoDate(q.get("start").length === 10 ? parseYMD(q.get("start")) : new Date(q.get("start"))); }
    }
  });
}

// ------------------------------------------------------------------ UI bindings

function toggleSidebar() {
  const app = $("#app");
  if (isMobile()) {
    if (app.classList.toggle("sidebar-open")) { setMiniDrop(false); pushOverlay(); }
  } else app.classList.toggle("sidebar-hidden");
}

function bindUI() {
  $("#menuBtn").onclick = toggleSidebar;
  $("#scrim").onclick = () => $("#app").classList.remove("sidebar-open");
  $("#todayBtn").onclick = () => gotoDate(new Date());
  $("#prevBtn").onclick = () => go(-1);
  $("#nextBtn").onclick = () => go(1);
  $("#viewSelect").onchange = (e) => setView(e.target.value);
  $("#settingsBtn").onclick = () => settingsDialog();
  const create = () => (state.mode === "tasks" ? openTaskEditor(null) : state.mode === "calendar" ? openEditor(null) : null);
  $("#createBtn").onclick = create;
  $("#fab").onclick = create;
  for (const nav of ["#modeNav", "#bottomNav"]) {
    $(nav).onclick = (e) => {
      const m = e.target.closest("[data-mode]")?.dataset.mode;
      if (!m) return;
      // Tapping Boards again while a board is open goes back to the list of boards.
      if (m === "boards" && state.mode === "boards" && prefs.boardId) { prefs.boardId = null; savePrefs(); state.board = null; }
      setMode(m);
    };
  }
  $("#addCalBtn").onclick = () => addCalendarDialog();

  const sw = $("#searchWrap"), si = $("#searchInput");
  $("#searchBtn").onclick = () => {
    if (!sw.classList.contains("open")) { sw.classList.add("open"); si.focus(); }
    else runSearch(si.value);
  };
  si.onkeydown = (e) => {
    if (e.key === "Enter") runSearch(si.value);
    if (e.key === "Escape") { si.value = ""; sw.classList.remove("open"); state.search = null; render(); }
  };
  si.onblur = () => { if (!si.value) sw.classList.remove("open"); };
  si.oninput = () => { if (!si.value && state.search) { state.search = null; render(); } };

  const miniClick = (e) => {
    const nav = e.target.closest("[data-mini]");
    if (nav) { state.miniDate = addMonths(state.miniDate, Number(nav.dataset.mini)); return renderMini(); }
    const d = e.target.closest("[data-date]")?.dataset.date;
    if (d) { $("#app").classList.remove("sidebar-open"); setMiniDrop(false); gotoDate(parseYMD(d)); }
  };
  $("#miniCal").onclick = miniClick;
  $("#miniDrop").onclick = miniClick;

  // phone header + drawer
  $("#titleBtn").onclick = () => { if (isMobile() && state.mode === "calendar") setMiniDrop($("#miniDrop").hidden); };
  $("#todayIconBtn").onclick = () => { setMiniDrop(false); gotoDate(new Date()); };
  $("#viewList").onclick = (e) => {
    const v = e.target.closest("[data-view]")?.dataset.view;
    if (!v) return;
    $("#app").classList.remove("sidebar-open");
    setView(v);
  };
  $("#drawerSettings").onclick = () => { $("#app").classList.remove("sidebar-open"); settingsDialog(); };

  const calLists = (e) => {
    const k = e.target.closest("[data-toggle-kind]");
    if (k) {
      if (k.dataset.toggleKind === "task") prefs.showTasks = k.checked; else prefs.showCards = k.checked;
      savePrefs();
      return refresh(true);
    }
    const t = e.target.closest("[data-toggle]");
    if (t) {
      const cal = calById(Number(t.dataset.toggle));
      cal.visible = t.checked;
      api(`/api/calendars/${cal.id}`, { method: "PATCH", body: { visible: t.checked } }).then(() => refresh(true)).catch((x) => toast(x.message));
      return;
    }
    const menu = e.target.closest("[data-calmenu]");
    if (menu) calendarDialog(calById(Number(menu.dataset.calmenu)));
  };
  $("#myCals").addEventListener("click", calLists);
  $("#otherCals").addEventListener("click", calLists);

  const main = $("#main");
  bindGrid(main);
  bindTasks(main);
  bindBoards(main);
  main.addEventListener("click", (e) => {
    if (suppressClick) return;
    const evEl = e.target.closest("[data-ev]");
    if (evEl) { const ev = findEvent(evEl.dataset.ev); if (ev) openPopover(ev, evEl); return; }
    const g = e.target.closest("[data-goto]");
    if (g) return gotoDate(parseYMD(g.dataset.goto), "day");
    const more = e.target.closest("[data-more]");
    if (more) return gotoDate(parseYMD(more.dataset.more), "day");
    if (e.target.closest("[data-allday-more]")) { state.alldayExpanded = true; return render(); }
    const ad = e.target.closest("[data-allday-date]");
    if (ad) return openEditor(null, { all_day: true, start: parseYMD(ad.dataset.alldayDate), end: addDays(parseYMD(ad.dataset.alldayDate), 1) });
    const col = e.target.closest(".col");
    if (col) {
      const mins = minutesAt(col, e.clientY - HOUR() / 4, 30);
      const day = parseYMD(col.dataset.date);
      const st = new Date(day.getTime() + mins * 60000);
      return openEditor(null, { start: st, end: new Date(st.getTime() + 3600000) });
    }
    const mc = e.target.closest("[data-mdate]");
    if (mc) {
      const d = parseYMD(mc.dataset.mdate);
      // On phones the cells are too small to aim at: tapping a day opens it instead.
      if (isMobile()) return gotoDate(d, "day");
      return openEditor(null, { all_day: true, start: d, end: addDays(d, 1) });
    }
  });

  // swipe to change period on touch devices
  let tx = null;
  main.addEventListener("touchstart", (e) => { tx = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY, Date.now()] : null; }, { passive: true });
  main.addEventListener("touchend", (e) => {
    if (!tx || state.search || state.mode !== "calendar") return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tx[0], dy = t.clientY - tx[1];
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - tx[2] < 600) go(dx < 0 ? 1 : -1);
    tx = null;
  });

  document.addEventListener("click", (e) => {
    const pop = $("#popover");
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest("[data-ev]")) closePopover();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key === "Escape" && modalOpen()) closeModal();
      return;
    }
    if (e.key === "Escape") { if (modalOpen()) closeModal(); else closePopover(); return; }
    if (modalOpen()) return;
    const k = e.key.toLowerCase();
    const map = { t: () => gotoDate(new Date()), j: () => go(1), n: () => go(1), arrowright: () => go(1), k: () => go(-1), p: () => go(-1), arrowleft: () => go(-1),
      d: () => setView("day"), x: () => setView("3day"), w: () => setView("week"), m: () => setView("month"), a: () => setView("schedule"),
      c: create, "/": () => { $("#searchWrap").classList.add("open"); $("#searchInput").focus(); } };
    // Outside the calendar only "create" and the view keys (which jump back to the calendar) apply.
    if (state.mode !== "calendar" && !"cdxwma".includes(k)) return;
    if (map[k]) { e.preventDefault(); map[k](); }
  });

  let resizeTimer;
  let wasMobile = isMobile();
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (isMobile() !== wasMobile) { wasMobile = isMobile(); $("#app").classList.remove("sidebar-open", "sidebar-hidden"); }
      if (state.view === "month") render();
    }, 150);
  });

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
  window.addEventListener("online", () => refresh(true));
  window.addEventListener("popstate", closeOverlays);
}

boot();
