// app.js – Dieta dla Rodziny – v0.3.1 (M3: plan tygodnia, generator, Dziś, reguły tygodnia, dołączanie do posiłku)
import { APP_VERSION, APP_STAGE } from "./version.js";
import { OWNER_EMAIL } from "./config.js";
import { defaultConfig, defaultProfiles, CATEGORY_NAMES, TAG_NAMES, FAMILY_NAMES, SLOT_NAMES, DAY_NAMES, productChunkOf, recipeChunkOf } from "./defaults.js";
import { validateProducts, validateRecipes, diffItems, mergeIntoChunks } from "./importer.js";
import { recipeTotals, recipeFamilies, formatAmount } from "./nutrition.js";
import { slotKcal, portionScale, defaultSlotFor, validateSlots } from "./scaling.js";
import { SLOTS } from "./defaults.js";
import * as W from "./week.js";

const demo = new URLSearchParams(location.search).has("demo");
const { createBackend } = await import(demo ? "./backend-demo.js" : "./backend-firebase.js");
const be = createBackend();

const S = { user: null, config: null, profiles: {}, products: {}, recipes: {}, invite: null, filters: { q: "", cat: "", tag: "", profile: "" }, portion: { profile: "", slot: "", base: false, recipe: "", amount: "me" },
  week: { sat: null, data: undefined, unsub: null }, weekSel: null, weekProfile: "", todayProfile: "" };
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAdmin = () => S.invite?.role === "admin";
const fmt = (n, d = 0) => Number(n).toLocaleString("pl-PL", { maximumFractionDigits: d, minimumFractionDigits: d });
const profileList = () => Object.entries(S.profiles).sort((a, b) => (a[1].order || 9) - (b[1].order || 9));
// Jedna kolejność wszędzie: posiłki wg SLOTS, osoby wg pola order
const slotsOf = (p) => SLOTS.filter(sl => p?.slots?.[sl] != null);
const byOrder = (pids) => [...pids].sort((a, b) => (S.profiles[a]?.order || 9) - (S.profiles[b]?.order || 9));

function toast(msg, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  box.appendChild(t); while (box.children.length > 2) box.firstChild.remove(); setTimeout(() => t.remove(), 3500);
}

// ---------- start / logowanie ----------
function screen(html) { $("#app").innerHTML = html; }
function footer() { return `<footer class="foot">Dieta dla Rodziny · v${APP_VERSION}${be.kind === "demo" ? " · tryb demo" : ""} · <span id="net">${navigator.onLine ? "online" : "offline"}</span></footer>`; }
addEventListener("online", () => { const n = $("#net"); if (n) n.textContent = "online"; });
addEventListener("offline", () => { const n = $("#net"); if (n) n.textContent = "offline"; });

function renderLogin() {
  screen(`<div class="center"><div class="card login">
    <div class="logo">🥗</div><h1>Dieta dla Rodziny</h1><p class="muted">Plan posiłków i wspólna lista zakupów</p>
    <button class="btn primary big" id="login">Zaloguj przez Google</button>
    ${be.kind === "demo" ? `<p class="muted small">Tryb demo – dane tylko w tej karcie przeglądarki.</p>` : ""}
  </div></div>${footer()}`);
  $("#login").onclick = async () => { try { await be.signIn(); } catch (e) { toast("Logowanie nieudane: " + (e.code || e.message), "err"); } };
}

function renderMessage(title, msg, withLogout = true) {
  screen(`<div class="center"><div class="card login"><h1>${esc(title)}</h1><p>${msg}</p>
    ${withLogout ? `<button class="btn" id="logout">Wyloguj</button>` : ""}</div></div>${footer()}`);
  if (withLogout) $("#logout").onclick = () => be.signOut();
}

function renderInit() {
  screen(`<div class="center"><div class="card login"><h1>Pierwsze uruchomienie</h1>
    <p>Baza jest pusta. Utworzę konfigurację rodziny: 5 profili (Jacek, Agata, Lena, Ilona, Alina), reguły tygodnia sob–pt i Ciebie jako administratora.</p>
    <button class="btn primary big" id="init">Utwórz konfigurację</button></div></div>${footer()}`);
  $("#init").onclick = async () => {
    $("#init").disabled = true;
    try {
      await be.setConfig(defaultConfig(S.user.email));
      const profs = defaultProfiles(); profs.jacek.uid = S.user.uid;
      for (const [id, p] of Object.entries(profs)) await be.setProfile(id, p);
      toast("Konfiguracja utworzona", "ok"); await boot();
    } catch (e) { toast("Błąd inicjalizacji: " + (e.code || e.message), "err"); $("#init").disabled = false; }
  };
}

async function boot() {
  try {
    S.config = await be.getConfig();
    if (!S.config) {
      if (S.user.email === OWNER_EMAIL.toLowerCase()) return renderInit();
      return renderMessage("Aplikacja nie jest jeszcze gotowa", "Administrator musi ją najpierw uruchomić.");
    }
    S.invite = S.config.invites?.[S.user.email] || null;
    if (!S.invite) return renderMessage("Brak dostępu", `Konto <b>${esc(S.user.email)}</b> nie jest zaproszone. Poproś Jacka lub Agatę o dodanie.`);
    S.profiles = await be.getProfiles();
    const pid = S.invite.profileId;
    if (pid && S.profiles[pid] && !S.profiles[pid].uid) {
      await be.updateProfile(pid, { uid: S.user.uid }); S.profiles[pid].uid = S.user.uid;
    }
    await loadData();
    S.filters.profile ||= pid || "";
    renderShell(); route();
  } catch (e) {
    console.error(e);
    if (e.code === "permission-denied") return renderMessage("Brak dostępu", `Konto <b>${esc(S.user.email)}</b> nie ma dostępu do aplikacji. Poproś Jacka lub Agatę o zaproszenie.`);
    renderMessage("Błąd połączenia", esc(e.code || e.message));
  }
}

async function loadData() {
  const pc = await be.getChunks("products"); S.products = {};
  for (const c of Object.values(pc)) Object.assign(S.products, c.items || {});
  const rc = await be.getChunks("recipes"); S.recipes = {};
  for (const c of Object.values(rc)) Object.assign(S.recipes, c.items || {});
  S.kcalOf = W.buildKcalIndex(S.recipes, (r) => recipeTotals(r, S.products));
  S.famOf = W.buildFamilyIndex(S.recipes, S.products);
}

// ---------- powłoka i nawigacja ----------
const NAV = [["dzis", "Dziś", "☀️"], ["tydzien", "Tydzień", "📅"], ["zakupy", "Zakupy", "🛒"], ["przepisy", "Przepisy", "📖"], ["wiecej", "Więcej", "☰"]];
function renderShell() {
  screen(`<nav class="nav">${NAV.map(([k, n, i]) => `<a href="#/${k}" data-k="${k}"><span>${i}</span>${n}</a>`).join("")}</nav>
    <main id="main"></main>${footer()}`);
}
addEventListener("hashchange", () => S.config && route());
function route() {
  const [, view, arg, a2, a3, a4] = (location.hash || "#/dzis").split("/");
  document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("on", a.dataset.k === ({ przepis: "przepisy", profil: "wiecej" }[view] || view)));
  const m = $("#main"); if (!m) return;
  closeSheet();
  ({ dzis: () => vToday(m), tydzien: () => vWeek(m, arg), zakupy: () => vSoon(m, "Lista zakupów", "M4"),
     przepisy: () => vRecipes(m), przepis: () => vRecipe(m, arg, a2 ? { date: a2, slot: a3, pid: a4 || "" } : null), profil: () => vProfile(m, arg), wiecej: () => vMore(m) }[view] || (() => vRecipes(m)))();
  window.scrollTo(0, 0);
}

function vSoon(m, title, stage) {
  m.innerHTML = `<h2>${title}</h2><div class="card muted">Ten ekran pojawi się w etapie ${stage}. Teraz (v${APP_VERSION}) działa plan tygodnia, ekran Dziś, przepisy, profile oraz import i eksport.</div>`;
}

// ---------- przepisy ----------
function excludedFor(profileId) { return new Set(S.profiles[profileId]?.exclusions?.families || []); }

function vRecipes(m) {
  const f = S.filters;
  const count = Object.keys(S.recipes).length;
  if (!count) {
    m.innerHTML = `<h2>Przepisy</h2><div class="card">Baza przepisów jest pusta. ${isAdmin() ? `Zaimportuj produkty i przepisy: <a href="#/wiecej">Więcej → Rodzina</a>.` : "Administrator musi zaimportować przepisy."}</div>`;
    return;
  }
  m.innerHTML = `<h2>Przepisy <span class="muted small">(${count})</span></h2>
    <div class="filters">
      <input id="q" type="search" placeholder="Szukaj przepisu lub składnika…" value="${esc(f.q)}">
      <select id="cat"><option value="">Wszystkie kategorie</option>${Object.entries(CATEGORY_NAMES).map(([k, v]) => `<option value="${k}" ${f.cat === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="tag"><option value="">Wszystkie tagi</option>${Object.entries(TAG_NAMES).map(([k, v]) => `<option value="${k}" ${f.tag === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="prof"><option value="">Bez filtra wykluczeń</option>${profileList().map(([k, p]) => `<option value="${k}" ${f.profile === k ? "selected" : ""}>Bez wykluczeń: ${esc(p.name)}</option>`).join("")}</select>
    </div><div id="list" class="list"></div>`;
  const draw = () => {
    const q = f.q.trim().toLowerCase(); const ex = f.profile ? excludedFor(f.profile) : new Set();
    const rows = Object.entries(S.recipes).filter(([id, r]) => {
      if (f.cat && r.category !== f.cat) return false;
      if (f.tag && !(r.tags || []).includes(f.tag)) return false;
      if (ex.size && recipeFamilies(r, S.products).some(x => ex.has(x))) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.ingredients.some(x => (S.products[x.p]?.name || "").toLowerCase().includes(q)))) return false;
      return true;
    });
    $("#list").innerHTML = rows.length ? rows.map(([id, r]) => {
      const t = recipeTotals(r, S.products);
      return `<a class="item" href="#/przepis/${id}"><div class="t">${esc(r.name)}</div>
        <div class="meta">${CATEGORY_NAMES[r.category]} · ${fmt(t.kcal)} kcal · Fe ${fmt(t.fe, 1)} mg${r.timeMin ? ` · ${r.timeMin} min` : ""}
        ${(r.tags || []).map(x => `<span class="tag ${x}">${TAG_NAMES[x] || x}</span>`).join("")}</div></a>`;
    }).join("") : `<div class="card muted">Brak przepisów dla tych filtrów.</div>`;
  };
  $("#q").oninput = (e) => { f.q = e.target.value; draw(); };
  $("#cat").onchange = (e) => { f.cat = e.target.value; draw(); };
  $("#tag").onchange = (e) => { f.tag = e.target.value; draw(); };
  $("#prof").onchange = (e) => { f.profile = e.target.value; draw(); };
  draw();
}

function vRecipe(m, id, cx = null) {
  const r = S.recipes[id];
  if (!r) { m.innerHTML = `<div class="card">Nie znaleziono przepisu.</div>`; return; }
  const P = S.portion;
  const ckey = id + (cx ? `/${cx.date}/${cx.slot}/${cx.pid}` : "");
  if (P.recipe !== ckey) { P.recipe = ckey; P.slot = ""; P.amount = "me"; P.base = false;
    if (cx) { P.profile = cx.pid || S.invite.profileId; P.slot = cx.slot;
      const mm = S.week.data?.days?.[cx.date]?.[cx.slot]; // we wspólnym posiłku „dla mnie” = zalogowana osoba, jeśli je
      if (mm?.mode === "shared" && W.participants(mm).includes(S.invite.profileId)) P.profile = S.invite.profileId; } }
  const wk = cx && S.week.data && S.week.sat === W.saturdayOf(cx.date) ? S.week.data : null;
  const meal = wk?.days?.[cx.date]?.[cx.slot];
  const cookCtx = meal && cx.pid !== undefined && W.recipeOf(meal, cx.pid) === id;
  const ctxW = cookCtx ? ctxFor(wk.start) : null;
  const cDay = cookCtx ? W.cookingScales(wk, ctxW, cx.date, cx.slot, "day", cx.pid) : null;
  const cBlk = cookCtx ? W.cookingScales(wk, ctxW, cx.date, cx.slot, "block", cx.pid) : null;
  const amtOpts = cookCtx ? [["me", "Dla mnie"], ...(cDay.rows.length > 1 ? [["all", "Dla wszystkich przy stole"]] : []), ...(cBlk.dates.length > 1 ? [["block", "Na cały blok"]] : [])] : [];
  if (!amtOpts.some(([v]) => v === P.amount)) P.amount = "me";
  if (!P.profile || !S.profiles[P.profile]) P.profile = S.invite.profileId || profileList()[0]?.[0];
  const prof = S.profiles[P.profile];
  if (!P.slot || !prof?.slots?.[P.slot]) P.slot = defaultSlotFor(r.category, prof);
  const base = recipeTotals(r, S.products); const fam = recipeFamilies(r, S.products);
  const target = slotKcal(prof, P.slot);
  const lim = S.config.scaleLimits || { min: 0.5, max: 2.0 };
  let ps = P.base ? { scale: 1, raw: 1, ok: true } : portionScale(base.kcal, target, lim);
  let cook = null;
  if (cookCtx && P.amount !== "me" && !P.base) { cook = P.amount === "block" ? cBlk : cDay; ps = { scale: cook.total, raw: cook.total, ok: true }; }
  const k = ps.scale; const t = Object.fromEntries(Object.entries(base).map(([a, v]) => [a, v * k]));
  const blocked = profileList().filter(([, p]) => (p.exclusions?.families || []).some(x => fam.includes(x)));
  const mine = (prof?.exclusions?.families || []).filter(x => fam.includes(x));
  m.innerHTML = `<a href="${cx ? "javascript:history.back()" : "#/przepisy"}" class="back">← ${cx ? "Wróć do planu" : "Przepisy"}</a>
    <h2>${esc(r.name)}</h2>
    <div class="meta">${CATEGORY_NAMES[r.category]}${r.timeMin ? ` · ${r.timeMin} min` : ""} · ${esc(r.source)} ${(r.tags || []).map(x => `<span class="tag ${x}">${TAG_NAMES[x] || x}</span>`).join("")}</div>
    <div class="card portion">
      ${amtOpts.length > 1 ? `<div class="seg">${amtOpts.map(([v, n]) =>
        `<button class="${P.amount === v ? "on" : ""}" data-amt="${v}">${n}</button>`).join("")}</div>` : ""}
      ${cook ? `<div class="small">Gotujesz ${fmt(cook.rows.length)} ${cook.rows.length === 1 ? "porcję" : cook.rows.length < 5 ? "porcje" : "porcji"}${cook.dates.length > 1 ? ` na ${cook.dates.map(d => DAY_NAMES[W.dayNum(d)]).join(" + ")}` : ""}: ${cook.rows.map(r => `${esc(S.profiles[r.pid]?.name)} ×${fmt(r.scale, 2)}`).join(" · ")} = ×${fmt(cook.total, 2)} przepisu</div>` : `
      <div class="row tight">
        <select id="pProf">${profileList().map(([pid, p]) => `<option value="${pid}" ${pid === P.profile ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <select id="pSlot">${slotsOf(prof).map(sl => `<option value="${sl}" ${sl === P.slot ? "selected" : ""}>${SLOT_NAMES[sl]} · ${slotKcal(prof, sl)} kcal</option>`).join("")}</select>
        <label class="chk"><input type="checkbox" id="pBase" ${P.base ? "checked" : ""}> porcja bazowa</label>
      </div>
      <div class="small ${ps.ok ? "muted" : "warntext"}">${P.base ? `Porcja bazowa przepisu: ${fmt(base.kcal)} kcal.` :
        `Porcja dla: <b>${esc(prof?.name)}</b> · ${SLOT_NAMES[P.slot]} ${target} kcal · skala ×${fmt(k, 2)}${ps.ok ? "" : ` – poza zakresem ${fmt(lim.min, 1)}–${fmt(lim.max, 1)}: przepis słabo pasuje do tego posiłku`}`}</div>`}
    </div>
    ${mine.length ? `<div class="warn"><b>${esc(prof.name)}</b> wyklucza: ${mine.map(x => FAMILY_NAMES[x] || x).join(", ")} – ten przepis nie będzie proponowany tej osobie.</div>`
      : blocked.length ? `<div class="note">Zawiera: ${fam.map(x => FAMILY_NAMES[x] || x).join(", ")} – nie dla: ${blocked.map(([, p]) => esc(p.name)).join(", ")}</div>` : ""}
    <div class="stats"><div><b>${fmt(t.kcal)}</b>kcal</div><div><b>${fmt(t.p)}</b>białko g</div><div><b>${fmt(t.f)}</b>tłuszcz g</div><div><b>${fmt(t.c)}</b>węgl. g</div><div><b>${fmt(t.fe, 1)}</b>żelazo mg</div></div>
    <div class="card"><h3>Składniki</h3>
      <ul class="ing">${r.ingredients.map(x => { const p = S.products[x.p]; return `<li><span>${esc(p?.name || x.p)}</span><span>${esc(formatAmount(x, p, k))}</span></li>`; }).join("")}</ul></div>
    <div class="card"><h3>Przygotowanie</h3><p>${esc(r.steps)}</p></div>
    <p class="muted small">Porcja bazowa ${fmt(base.kcal)} kcal (wyliczone z gramatur; źródło podawało ${r.sourceKcal ?? "–"} kcal). Id: ${id}, wersja ${r.rev}.</p>`;
  const again = () => vRecipe(m, id, cx);
  m.querySelectorAll("[data-amt]").forEach(b => b.onclick = () => { P.amount = b.dataset.amt; again(); });
  if ($("#pProf")) {
    $("#pProf").onchange = (e) => { P.profile = e.target.value; P.slot = ""; again(); };
    $("#pSlot").onchange = (e) => { P.slot = e.target.value; again(); };
    $("#pBase").onchange = (e) => { P.base = e.target.checked; again(); };
  }
}


// ---------- plan tygodnia ----------
const todayYmd = () => W.ymd(new Date());
const DAY_FULL = { 1: "Poniedziałek", 2: "Wtorek", 3: "Środa", 4: "Czwartek", 5: "Piątek", 6: "Sobota", 7: "Niedziela" };
const dLabel = (d) => { const x = W.parseYmd(d); return `${x.getDate()}.${String(x.getMonth() + 1).padStart(2, "0")}`; };
const rName = (rid) => rid ? (S.recipes[rid]?.name || "(usunięty przepis)") : "— wybierz ręcznie —";
const pName = (pid) => S.profiles[pid]?.name || pid;
function ctxFor(sat, history = []) {
  return { sat, profiles: S.profiles, config: S.config, recipes: S.recipes, kcalOf: S.kcalOf, famOf: S.famOf, history, rng: Math.random };
}
function ensureWeek(sat, onData) {
  if (S.week.sat === sat) return;
  if (S.week.unsub) S.week.unsub();
  S.week = { sat, data: undefined, unsub: null };
  S.week.unsub = be.watchWeek(sat, (d) => { if (S.week.sat !== sat) return; S.week.data = d; onData(); },
    (e) => toast("Błąd synchronizacji planu: " + (e.code || e.message), "err"));
}
function rerenderPlan() {
  const v = (location.hash || "#/dzis").split("/")[1];
  if (v === "tydzien" || v === "dzis" || !v) { if ($("#sheet")) return; route(); }
}
async function saveSlot(w, slot, extraDates = []) {
  const items = W.weekDates(w.start).filter(d => w.days[d]?.[slot]).map(d => ({ date: d, slot, meal: w.days[d][slot] }));
  S.week.data = w;
  try { await be.updateMeals(w.start, items, { updatedAt: new Date().toISOString(), updatedBy: S.user.email }); }
  catch (e) { toast("Błąd zapisu: " + (e.code || e.message), "err"); }
}

async function generate(sat) {
  const exists = !!S.week.data;
  if (exists && !confirm("Wygenerować tydzień od nowa? Ręcznie wybrane dania (🔒) i ustawienia „poza domem” zostaną zachowane.")) return;
  const prev = await be.getWeek(W.addDays(sat, -7)).catch(() => null);
  const ctx = ctxFor(sat, W.historyFromWeek(prev));
  const w = W.generateWeek(ctx, S.week.data || null);
  w.generatedAt = new Date().toISOString(); w.generatedBy = S.user.email;
  try { await be.setWeek(sat, w); S.week.data = w; toast("Tydzień wygenerowany", "ok"); route(); }
  catch (e) { toast("Błąd generowania: " + (e.code || e.message), "err"); }
}

function mealLine(w, date, slot, pid) {
  const m = w.days[date][slot]; const p = m.per[pid];
  if (p.outside) return `<span class="muted">poza domem${p.note && p.note !== "poza domem" ? ` (${esc(p.note)})` : ""}${p.kcal ? ` · ~${p.kcal} kcal` : ""}</span>`;
  const rid = m.mode === "shared" ? m.recipeId : p.recipeId;
  const kc = rid && p.scale ? Math.round(S.kcalOf[rid] * p.scale) : null;
  const lo = m.mode === "shared" ? (m.cook === false ? m.leftoverFrom : null) : (p.cook === false ? p.leftoverFrom : null);
  const guests = m.mode === "individual" ? byOrder(Object.keys(m.per).filter(g => m.per[g].with === pid && !m.per[g].outside)) : [];
  const tags = `${p.with ? ` <span class="badge join">razem z: ${esc(pName(p.with))}</span>` : ""}${guests.length ? ` <span class="badge join">+ ${guests.map(g => esc(pName(g))).join(", ")}</span>` : ""}${p.extra ? ` <span class="badge">dodatkowo</span>` : ""}`;
  return `${rid ? `<a href="#/przepis/${rid}/${date}/${slot}/${pid}">${esc(rName(rid))}</a>` : `<span class="warntext">${rName(null)}</span>`}
    ${kc ? `<span class="muted small">· ${kc} kcal</span>` : ""}${lo ? ` <span class="badge">z ${DAY_NAMES[W.dayNum(lo)]}</span>` : ""}${(m.mode === "shared" ? m.locked : p.locked) ? " 🔒" : ""}${tags}
    ${rid && (S.recipes[rid]?.tags || []).includes("zelazo") ? `<span class="tag zelazo">Fe</span>` : ""}`;
}

function slotHtml(w, date, slot, only) {
  const m = w.days[date][slot]; const parts = byOrder(W.participants(m));
  const outs = byOrder(Object.keys(m.per)).filter(pid => m.per[pid].outside).map(pid => [pid, m.per[pid]]);
  const extras = parts.filter(pid => m.per[pid].extra);
  const act = (pid = "") => `<button class="btn small dots" data-act="${date}|${slot}|${pid}" aria-label="Akcje">⋯</button>`;
  if (only) {
    if (!m.per[only]) return "";
    return `<div class="slot"><div class="sh">${SLOT_NAMES[slot]}${m.mode === "shared" ? ` <span class="badge sh2">wspólny</span>` : ""}</div>
      <div class="sl">${mealLine(w, date, slot, only)} ${act(m.mode === "shared" ? "" : only)}</div></div>`;
  }
  if (m.mode === "shared") {
    const lena = parts.filter(pid => S.profiles[pid]?.flags?.ironRich && m.recipeId && !(S.recipes[m.recipeId]?.tags || []).includes("zelazo"));
    const kc = m.recipeId ? parts.map(pid => `${esc(pName(pid))} ${Math.round(S.kcalOf[m.recipeId] * (m.per[pid].scale || 0))}`).join(" · ") : "";
    return `<div class="slot shared"><div class="sh">${SLOT_NAMES[slot]} <span class="badge sh2">wspólny · ${parts.length} os.</span> ${act()}</div>
      <div class="sl">${mealLine(w, date, slot, parts[0] || Object.keys(m.per)[0])}</div>
      <div class="small muted">${kc} kcal${extras.length ? ` · dodatkowo: ${extras.map(x => esc(pName(x))).join(", ")}` : ""}</div>
      ${outs.length ? `<div class="small muted">Poza domem: ${outs.map(([pid, p]) => esc(pName(pid)) + (p.note ? ` (${esc(p.note)})` : "")).join(", ")}</div>` : ""}
      ${lena.map(pid => `<div class="hint">Fe+ ${esc(pName(pid))}: ${esc(W.ironHints(S.profiles[pid])[0])}</div>`).join("")}</div>`;
  }
  return `<div class="slot"><div class="sh">${SLOT_NAMES[slot]} <span class="muted small">indywidualnie</span></div>
    ${byOrder(Object.keys(m.per)).map(pid => `<div class="sl person"><b>${esc(pName(pid))}</b> ${mealLine(w, date, slot, pid)} ${act(pid)}</div>`).join("")}</div>`;
}

function vWeek(m, arg) {
  const sat = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? W.saturdayOf(arg) : (S.weekSel || W.saturdayOf(todayYmd()));
  S.weekSel = sat; ensureWeek(sat, rerenderPlan);
  const w = S.week.data; const only = S.weekProfile;
  const head = `<div class="weekhead"><a class="btn small" href="#/tydzien/${W.addDays(sat, -7)}">‹</a>
      <div class="wl"><b>${dLabel(sat)} – ${dLabel(W.addDays(sat, 6))}</b>${sat === W.saturdayOf(todayYmd()) ? ` <span class="muted small">bieżący</span>` : ""}</div>
      <a class="btn small" href="#/tydzien/${W.addDays(sat, 7)}">›</a></div>
    <div class="row tight"><select id="wProf"><option value="">Cała rodzina</option>${profileList().map(([pid, p]) => `<option value="${pid}" ${only === pid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      ${isAdmin() ? `<button class="btn ${w ? "" : "primary"}" id="gen">${w ? "Generuj od nowa" : "Generuj tydzień"}</button>` : ""}</div>`;
  if (w === undefined) { m.innerHTML = `<h2>Plan tygodnia</h2>${head}<div class="card muted">Wczytywanie…</div>`; }
  else if (!w) { m.innerHTML = `<h2>Plan tygodnia</h2>${head}<div class="card">Plan na ten tydzień jeszcze nie istnieje. ${isAdmin() ? "Kliknij „Generuj tydzień”." : "Poproś Jacka lub Agatę o wygenerowanie."}</div>`; }
  else {
    const today = todayYmd();
    m.innerHTML = `<h2>Plan tygodnia</h2>${head}<div class="days">${W.weekDates(sat).map(d => {
      const slots = SLOTS.filter(sl => w.days[d]?.[sl] && (!only || w.days[d][sl].per[only]));
      const sum = only ? dayKcal(w, d, only) : null;
      return `<details class="day card" ${d === today || (!W.weekDates(sat).includes(today) && d === sat) || matchMedia("(min-width:900px)").matches ? "open" : ""}>
        <summary><b>${DAY_FULL[W.dayNum(d)]}</b> ${dLabel(d)}${d === today ? ` <span class="badge sh2">dziś</span>` : ""}${sum ? ` <span class="muted small">· ${sum.kcal} / ${sum.target} kcal</span>` : ""}</summary>
        ${slots.map(sl => slotHtml(w, d, sl, only)).join("") || `<p class="muted small">Brak posiłków.</p>`}</details>`; }).join("")}</div>
      <p class="muted small">Wygenerowano: ${w.generatedAt ? new Date(w.generatedAt).toLocaleString("pl-PL") : "—"}${w.updatedBy ? ` · ostatnia zmiana: ${esc(w.updatedBy)}` : ""}</p>`;
  }
  $("#wProf").onchange = (e) => { S.weekProfile = e.target.value; route(); };
  if ($("#gen")) $("#gen").onclick = () => generate(sat);
  m.querySelectorAll("[data-act]").forEach(b => b.onclick = () => { const [d, sl, pid] = b.dataset.act.split("|"); openActions(d, sl, pid); });
}

function dayKcal(w, d, pid) {
  let kcal = 0; const p = S.profiles[pid];
  for (const sl of SLOTS) { const m = w.days[d]?.[sl]; const e = m?.per?.[pid]; if (!e) continue;
    if (e.outside) { kcal += e.kcal || 0; continue; }
    const rid = m.mode === "shared" ? m.recipeId : e.recipeId; if (rid && e.scale) kcal += S.kcalOf[rid] * e.scale; }
  return { kcal: Math.round(kcal), target: p.kcalTarget };
}

// ---------- arkusz akcji ----------
function closeSheet() { $("#sheet")?.remove(); }
function sheet(html) {
  closeSheet(); const d = document.createElement("div"); d.id = "sheet";
  d.innerHTML = `<div class="sheet-bg"></div><div class="sheet-box">${html}</div>`; document.body.appendChild(d);
  d.querySelector(".sheet-bg").onclick = closeSheet; return d;
}
function openActions(date, slot, pid) {
  const w = S.week.data; const m = w?.days?.[date]?.[slot]; if (!m) return;
  const shared = m.mode === "shared"; const parts = W.participants(m);
  const blk = W.blockDates(S.config, slot, w.start, date);
  const me = !shared && pid ? m.per[pid] : null; const guest = !!me?.with;
  const canJoin = shared ? !!m.recipeId : !!(me && !me.outside && !me.with && me.recipeId);
  const d = sheet(`<h3>${DAY_FULL[W.dayNum(date)]} ${dLabel(date)} · ${SLOT_NAMES[slot]}${shared ? " (wspólny)" : pid ? ` · ${esc(pName(pid))}` : ""}</h3>
    <div class="acts">
      ${guest ? `<p class="small">${esc(pName(pid))} je to samo co ${esc(pName(me.with))} – danie zmienia się razem z nim.</p>
        <button class="btn" data-a="leave">↩ Odłącz – osobne danie</button>` : `
      <button class="btn" data-a="reroll">🎲 Losuj ponownie${blk.length > 1 ? " (cały blok)" : ""}</button>
      <button class="btn" data-a="replace">🔁 Podmień danie…</button>`}
      ${canJoin ? `<button class="btn" data-a="join">➕ Dołącz domownika${shared ? "" : ` do ${esc(pName(pid))}`}…</button>` : ""}
      ${shared ? `<button class="btn" data-a="indiv">👤 Zmień na indywidualny (tylko ten dzień)</button>` : parts.length >= 2 ? `<button class="btn" data-a="shared">👥 Zmień na wspólny (tylko ten dzień)</button>` : ""}
    </div>
    <h4>Kto je ten posiłek</h4>
    <div class="who">${byOrder(Object.keys(m.per)).map(p2 => { const e = m.per[p2]; return `<div class="whorow"><span><b>${esc(pName(p2))}</b>${e.fixed ? ` <span class="muted small">stały wyjątek${e.note ? `: ${esc(e.note)}` : ""}</span>` : ""}${e.extra ? ` <span class="muted small">dodatkowo</span>` : ""}${e.with ? ` <span class="muted small">razem z: ${esc(pName(e.with))}</span>` : ""}</span>
      ${e.extra ? `<button class="btn small" data-leave="${p2}">nie je – usuń</button>` : `<button class="btn small ${e.outside ? "" : "primary"}" data-in="${p2}">${e.outside ? "poza domem → w domu" : "w domu → poza domem"}</button>`}</div>`; }).join("")}</div>
    <div class="row"><button class="btn" id="shClose">Zamknij</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  const ctx = ctxFor(w.start);
  const run = async (fn, msg) => { const w2 = structuredClone(S.week.data); const r = fn(w2); closeSheet(); await saveSlot(w2, slot); route(); if (r?.warning) toast(r.warning, "err"); else if (msg) toast(msg, "ok"); };
  d.querySelector('[data-a="reroll"]')?.addEventListener("click", () => run(w2 => { W.reroll(w2, ctx, date, slot, shared ? null : pid); }, "Wylosowano"));
  d.querySelector('[data-a="replace"]')?.addEventListener("click", () => openReplace(date, slot, shared ? null : pid));
  d.querySelector('[data-a="leave"]')?.addEventListener("click", () => run(w2 => { W.leaveMeal(w2, ctx, date, slot, pid); }, "Odłączono – wylosowano osobne danie"));
  d.querySelector('[data-a="join"]')?.addEventListener("click", () => openJoin(date, slot, shared ? null : pid));
  d.querySelectorAll("[data-leave]").forEach(b => b.onclick = () => run(w2 => { W.leaveMeal(w2, ctx, date, slot, b.dataset.leave); }, "Usunięto z posiłku"));
  d.querySelector('[data-a="indiv"]')?.addEventListener("click", () => run(w2 => { W.setMode(w2, ctx, date, slot, "individual"); }, "Posiłek indywidualny"));
  d.querySelector('[data-a="shared"]')?.addEventListener("click", () => run(w2 => { W.setMode(w2, ctx, date, slot, "shared"); }, "Posiłek wspólny"));
  d.querySelectorAll("[data-in]").forEach(b => b.onclick = () => {
    const p2 = b.dataset.in; const goingOut = !m.per[p2].outside;
    let kc = null;
    if (goingOut) { const v = prompt(`${pName(p2)} je poza domem. Orientacyjne kcal (opcjonalnie):`, ""); if (v === null) return; kc = Math.round(+v) || null; }
    run(w2 => W.setOutside(w2, ctx, date, slot, p2, goingOut, kc), goingOut ? "Zapisano: poza domem" : "Zapisano: w domu");
  });
}
function openJoin(date, slot, host) {
  const w = S.week.data; const ctx = ctxFor(w.start); const m = w.days[date][slot];
  const rid = W.recipeOf(m, host);
  const opts = W.joinOptions(w, ctx, date, slot, host).sort((a, b) => (S.profiles[a.pid]?.order || 9) - (S.profiles[b.pid]?.order || 9));
  const d = sheet(`<h3>Dołącz do: ${esc(rName(rid))}</h3>
    <p class="muted small">${DAY_FULL[W.dayNum(date)]} ${dLabel(date)} · ${SLOT_NAMES[slot]}${host ? ` · gospodarz: ${esc(pName(host))}` : " (wspólny)"}. Dołączona osoba je to samo danie w swojej porcji; ilości „dla wszystkich przy stole” uwzględnią ją w przepisie.</p>
    <div class="who">${opts.map(o => `<div class="whorow"><span><b>${esc(pName(o.pid))}</b> <span class="muted small">${o.extra ? "nie ma tego posiłku w układzie – porcja bazowa, poza bilansem" : o.outside ? "teraz poza domem" : "zamiast swojego dania"}</span>
      ${o.bad.length ? `<br><span class="warntext small">wyklucza: ${o.bad.map(f => FAMILY_NAMES[f] || f).join(", ")}</span>` : ""}</span>
      <button class="btn small primary" data-j="${o.pid}" ${o.bad.length ? "disabled" : ""}>Dołącz</button></div>`).join("") || `<p class="muted">Wszyscy już jedzą ten posiłek.</p>`}</div>
    <div class="row"><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  d.querySelectorAll("[data-j]").forEach(b => b.onclick = async () => {
    const w2 = structuredClone(S.week.data); W.joinMeal(w2, ctx, date, slot, host, b.dataset.j);
    closeSheet(); await saveSlot(w2, slot); route(); toast(`${pName(b.dataset.j)} dołącza`, "ok"); });
}
function openReplace(date, slot, pid) {
  const w = S.week.data; const ctx = ctxFor(w.start);
  const { unit, list } = W.replaceOptions(w, ctx, date, slot, pid);
  const d = sheet(`<h3>Podmień: ${SLOT_NAMES[slot]}${unit.days.length > 1 ? ` (${unit.days.map(x => DAY_NAMES[W.dayNum(x)]).join(" + ")})` : ""}</h3>
    <p class="muted small">Dla: ${unit.pids.map(p => esc(pName(p))).join(", ")} · pokazuję tylko przepisy bez wykluczeń tych osób.</p>
    <input id="rq" type="search" placeholder="Szukaj…" style="width:100%"><div id="rl" class="rlist"></div>
    <div class="row"><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  const draw = (q = "") => {
    const ql = q.trim().toLowerCase();
    d.querySelector("#rl").innerHTML = list.filter(rid => !ql || S.recipes[rid].name.toLowerCase().includes(ql)).slice(0, 80).map(rid =>
      `<button class="ritem" data-r="${rid}"><span>${esc(S.recipes[rid].name)}</span><span class="muted small">${Math.round(S.kcalOf[rid])} kcal ${(S.recipes[rid].tags || []).includes("zelazo") ? "· Fe" : ""}</span></button>`).join("") || `<p class="muted">Brak pasujących przepisów.</p>`;
    d.querySelectorAll("[data-r]").forEach(b => b.onclick = async () => { const w2 = structuredClone(S.week.data); W.replace(w2, ctx, date, slot, b.dataset.r, pid); closeSheet(); await saveSlot(w2, slot); route(); toast("Podmieniono 🔒", "ok"); });
  };
  d.querySelector("#rq").oninput = (e) => draw(e.target.value); draw();
}

// ---------- Dziś ----------
function vToday(m) {
  const today = todayYmd(); const sat = W.saturdayOf(today); ensureWeek(sat, rerenderPlan);
  const pid = S.todayProfile || S.invite.profileId || profileList()[0][0]; S.todayProfile = pid;
  const p = S.profiles[pid]; const w = S.week.data;
  const sel = `<select id="tProf">${profileList().map(([k, x]) => `<option value="${k}" ${k === pid ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
  if (w === undefined) { m.innerHTML = `<h2>Dziś</h2><div class="card muted">Wczytywanie…</div>`; return; }
  if (!w) { m.innerHTML = `<h2>Dziś · ${DAY_FULL[W.dayNum(today)]} ${dLabel(today)}</h2><div class="row tight">${sel}</div><div class="card">Brak planu na ten tydzień. ${isAdmin() ? `<a href="#/tydzien">Wygeneruj tydzień →</a>` : "Poproś administratora o wygenerowanie."}</div>`;
    $("#tProf").onchange = (e) => { S.todayProfile = e.target.value; route(); }; return; }
  const sum = dayKcal(w, today, pid);
  m.innerHTML = `<h2>Dziś · ${DAY_FULL[W.dayNum(today)]} ${dLabel(today)}</h2>
    <div class="row tight">${sel}<span class="muted">${sum.kcal} / ${sum.target} kcal</span></div>
    <div class="todaylist">${SLOTS.filter(sl => w.days[today]?.[sl]?.per?.[pid]).map(sl => { const mm = w.days[today][sl]; const e = mm.per[pid];
      return `<div class="card tslot"><div class="sh">${SLOT_NAMES[sl]}${mm.mode === "shared" ? ` <span class="badge sh2">wspólny</span>` : ""}</div>
        <div class="sl">${mealLine(w, today, sl, pid)}</div>
        <div class="row tight">${e.extra ? "" : `<button class="btn small" data-out="${sl}">${e.outside ? "Jednak w domu" : "Jem poza domem"}</button>`}
        <button class="btn small" data-act="${today}|${sl}|${mm.mode === "shared" ? "" : pid}">⋯ więcej</button></div></div>`; }).join("")}</div>
    <p><a href="#/tydzien">Cały tydzień →</a></p>`;
  $("#tProf").onchange = (e) => { S.todayProfile = e.target.value; route(); };
  m.querySelectorAll("[data-act]").forEach(b => b.onclick = () => { const [d, sl, p2] = b.dataset.act.split("|"); openActions(d, sl, p2); });
  m.querySelectorAll("[data-out]").forEach(b => b.onclick = async () => {
    const sl = b.dataset.out; const goingOut = !w.days[today][sl].per[pid].outside; let kc = null;
    if (goingOut) { const v = prompt("Orientacyjne kcal posiłku poza domem (opcjonalnie):", ""); if (v === null) return; kc = Math.round(+v) || null; }
    const w2 = structuredClone(S.week.data); const r = W.setOutside(w2, ctxFor(sat), today, sl, pid, goingOut, kc);
    await saveSlot(w2, sl); route(); if (r.warning) toast(r.warning, "err");
  });
}

// ---------- reguły tygodnia (administratorzy) ----------
const WEEK_DAYS = [6, 7, 1, 2, 3, 4, 5];
const BLOCK_PRESETS = { none: "bez powtarzania", def: "sob–nd · pn–wt · śr–czw · pt", b3: "sob–pn · wt–czw · pt", custom: "własne…" };
const presetBlocks = { def: [[6, 7], [1, 2], [3, 4], [5]], b3: [[6, 7, 1], [2, 3, 4], [5]] };
function blocksToText(rule) { return rule?.type === "blocks" ? rule.blocks.map(b => b.days.join("-")).join(",") : ""; }
function presetOf(rule) {
  if (!rule || rule.type !== "blocks") return "none";
  const t = blocksToText(rule);
  for (const [k, v] of Object.entries(presetBlocks)) if (v.map(b => b.join("-")).join(",") === t) return k;
  return "custom";
}
function rulesHtml() {
  const R = S.config.weekRules || {};
  return `<div class="card"><h3>Reguły tygodnia</h3>
    <p class="muted small">Zaznacz posiłki wspólne. Zmiany obowiązują przy następnym generowaniu tygodnia.</p>
    <table class="tbl rules"><tr><th></th>${WEEK_DAYS.map(d => `<th>${DAY_NAMES[d]}</th>`).join("")}</tr>
    ${SLOTS.map(sl => `<tr><td>${SLOT_NAMES[sl]}</td>${WEEK_DAYS.map(d => `<td><input type="checkbox" data-sh="${sl}|${d}" ${(R.shared?.[sl] || []).includes(d) ? "checked" : ""}></td>`).join("")}</tr>`).join("")}</table>
    <h4>Powtarzalność (to samo danie przez kilka dni)</h4>
    ${SLOTS.map(sl => { const pr = presetOf(R.repeat?.[sl]); return `<div class="row tight"><span style="min-width:110px">${SLOT_NAMES[sl]}</span>
      <select data-rep="${sl}">${Object.entries(BLOCK_PRESETS).map(([k, v]) => `<option value="${k}" ${pr === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input data-cust="${sl}" placeholder="np. 6-7,1-2,3-4,5" value="${pr === "custom" ? blocksToText(R.repeat[sl]) : ""}" style="width:170px;${pr === "custom" ? "" : "display:none"}"></div>`; }).join("")}
    <p class="muted small">Dni: 1 = pn … 5 = pt, 6 = sob, 7 = nd. Blokada powtórek: ${R.noRepeatDays || 7} dni.</p>
    <button class="btn primary" id="rulesSave">Zapisz reguły</button></div>`;
}
function bindRules() {
  document.querySelectorAll("[data-rep]").forEach(s2 => s2.onchange = () => { const c = document.querySelector(`[data-cust="${s2.dataset.rep}"]`); c.style.display = s2.value === "custom" ? "" : "none"; });
  $("#rulesSave").onclick = async () => {
    const cfg = structuredClone(S.config); const shared = {}; const repeat = {};
    document.querySelectorAll("[data-sh]:checked").forEach(c => { const [sl, d] = c.dataset.sh.split("|"); (shared[sl] ||= []).push(+d); });
    for (const sl of SLOTS) {
      const v = document.querySelector(`[data-rep="${sl}"]`).value;
      if (v === "none") continue;
      let blocks = presetBlocks[v];
      if (v === "custom") {
        const txt = document.querySelector(`[data-cust="${sl}"]`).value.trim();
        blocks = txt.split(",").map(b => b.split("-").map(Number)).filter(b => b.length && b.every(x => x >= 1 && x <= 7));
        const flat = blocks.flat();
        if (!blocks.length || new Set(flat).size !== flat.length) return toast(`${SLOT_NAMES[sl]}: błędne bloki (każdy dzień najwyżej raz)`, "err");
      }
      repeat[sl] = { type: "blocks", blocks: blocks.map(b => ({ days: b })) };
    }
    cfg.weekRules = { ...cfg.weekRules, shared, repeat };
    await saveConfig(cfg);
  };
}

// ---------- więcej: profil, rodzina, import ----------
function vMore(m) {
  const me = S.profiles[S.invite.profileId];
  m.innerHTML = `<h2>Więcej</h2>
    <div class="card"><h3>Zalogowano</h3><p>${esc(S.user.name)} · ${esc(S.user.email)}<br>Profil: <b>${esc(me?.name || "—")}</b> · rola: ${isAdmin() ? "administrator" : "domownik"}</p>
      <button class="btn" id="logout">Wyloguj</button></div>
    <div class="card"><h3>Profile rodziny</h3>
      <div class="profiles">${profileList().map(([id, p]) => `<div class="prof">${canEdit(id) ? `<a class="btn small edit" href="#/profil/${id}">Edytuj</a>` : ""}<div><b>${esc(p.name)}</b>${p.flags?.ironRich ? ` <span class="tag zelazo">Fe+</span>` : ""}${p.uid ? "" : ` <span class="muted small">(bez konta)</span>`} · ${p.kcalTarget} kcal</div>
        <div class="small">${slotsOf(p).map(s => `${SLOT_NAMES[s]} ${p.slots[s]}%`).join(" · ")}</div>
        ${(p.fixedExceptions || []).length ? `<div class="small muted">Poza domem: ${p.fixedExceptions.map(e => `${e.days.map(d => DAY_NAMES[d]).join(", ")} – ${e.slots.map(s => SLOT_NAMES[s]).join(", ")}`).join("; ")}</div>` : ""}
        ${(p.exclusions?.families || []).length ? `<div class="small muted">Wyklucza: ${p.exclusions.families.map(x => FAMILY_NAMES[x] || x).join(", ")}</div>` : ""}</div>`).join("")}</div></div>
    ${isAdmin() ? rulesHtml() + adminHtml() : ""}
    <div class="card muted small">Wersja aplikacji ${APP_VERSION} (${APP_STAGE}) · produkty ${S.config.versions?.products || "—"} · przepisy ${S.config.versions?.recipes || "—"}</div>`;
  $("#logout").onclick = () => be.signOut();
  if (isAdmin()) { bindAdmin(); bindRules(); }
}

function canEdit(pid) { return isAdmin() || (S.profiles[pid]?.uid && S.profiles[pid].uid === S.user.uid); }

function vProfile(m, pid) {
  const src = S.profiles[pid];
  if (!src) { m.innerHTML = `<div class="card">Nie ma takiego profilu.</div>`; return; }
  if (!canEdit(pid)) { m.innerHTML = `<a href="#/wiecej" class="back">← Więcej</a><div class="card">Możesz edytować tylko swój profil.</div>`; return; }
  const d = structuredClone(src);
  d.exclusions ||= { families: [], products: [] }; d.flags ||= {}; d.fixedExceptions ||= [];
  const draw = () => {
    const err = validateSlots(d.slots);
    const sum = Object.values(d.slots).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    m.innerHTML = `<a href="#/wiecej" class="back">← Więcej</a><h2>Profil: ${esc(d.name)}</h2>
      <div class="card"><h3>Cel dzienny</h3>
        <div class="row tight"><input id="kcal" type="number" min="800" max="5000" step="50" value="${d.kcalTarget}" style="width:120px"> <span class="muted">kcal / dzień</span></div></div>
      <div class="card"><h3>Posiłki i udział kcal</h3>
        <table class="tbl slots"><tr><th>Posiłek</th><th>%</th><th>kcal</th></tr>
        ${SLOTS.map(sl => { const on = d.slots[sl] != null; return `<tr><td><label class="chk"><input type="checkbox" data-slot="${sl}" ${on ? "checked" : ""}> ${SLOT_NAMES[sl]}</label></td>
          <td>${on ? `<input type="number" min="1" max="100" step="1" data-pct="${sl}" value="${d.slots[sl]}" style="width:80px">` : ""}</td>
          <td>${on ? Math.round(d.kcalTarget * (d.slots[sl] || 0) / 100) : ""}</td></tr>`; }).join("")}
        <tr><td><b>Suma</b></td><td><b class="${Math.round(sum) === 100 ? "" : "warntext"}">${sum}%</b></td><td>${Math.round(d.kcalTarget * sum / 100)}</td></tr></table>
        ${err ? `<div class="warntext small">${err}</div>` : ""}</div>
      <div class="card"><h3>Stałe wyjątki – poza domem</h3>
        ${d.fixedExceptions.length ? d.fixedExceptions.map((e, i) => `<div class="exc"><span>${e.days.map(x => DAY_NAMES[x]).join(", ")}: ${e.slots.map(x => SLOT_NAMES[x]).join(", ")}${e.note ? ` (${esc(e.note)})` : ""}${e.kcal ? ` · ~${e.kcal} kcal` : ""}</span>
          <button class="btn small" data-delexc="${i}">Usuń</button></div>`).join("") : `<p class="muted small">Brak.</p>`}
        <details class="add"><summary>Dodaj wyjątek</summary>
          <div class="small muted">Dni:</div><div class="row tight">${[6, 7, 1, 2, 3, 4, 5].map(x => `<label class="chk"><input type="checkbox" data-eday="${x}"> ${DAY_NAMES[x]}</label>`).join("")}</div>
          <div class="small muted">Posiłki:</div><div class="row tight">${slotsOf(d).map(sl => `<label class="chk"><input type="checkbox" data-eslot="${sl}"> ${SLOT_NAMES[sl]}</label>`).join("")}</div>
          <div class="row tight"><input id="enote" placeholder="opis, np. szkoła" style="flex:1 1 160px"><input id="ekcal" type="number" placeholder="kcal (opcjonalnie)" style="width:170px"><button class="btn" id="eadd">Dodaj</button></div>
        </details></div>
      <div class="card"><h3>Wykluczenia</h3><div class="row tight">
        ${Object.entries(FAMILY_NAMES).map(([f, n]) => `<label class="chk"><input type="checkbox" data-fam="${f}" ${d.exclusions.families.includes(f) ? "checked" : ""}> ${n}</label>`).join("")}</div>
        <p class="muted small">Przepisy z wykluczonym składnikiem (w każdej postaci) nie będą proponowane tej osobie ani we wspólnych posiłkach z jej udziałem.</p></div>
      <div class="card"><h3>Dieta</h3><label class="chk"><input type="checkbox" id="fe" ${d.flags.ironRich ? "checked" : ""}> Bogata w żelazo (Fe+) – generator częściej proponuje przepisy z tagiem „żelazo”</label></div>
      <div class="row"><button class="btn primary" id="save" ${err ? "disabled" : ""}>Zapisz</button><a class="btn" href="#/wiecej">Anuluj</a></div>`;
    $("#kcal").onchange = (e) => { const v = Math.round(+e.target.value); if (v >= 800 && v <= 5000) d.kcalTarget = v; else toast("Cel kcal: 800–5000", "err"); draw(); };
    m.querySelectorAll("[data-slot]").forEach(c => c.onchange = () => { const sl = c.dataset.slot;
      if (c.checked) d.slots[sl] = 10; else { delete d.slots[sl]; d.fixedExceptions.forEach(e => e.slots = e.slots.filter(x => x !== sl)); d.fixedExceptions = d.fixedExceptions.filter(e => e.slots.length); }
      d.slots = Object.fromEntries(SLOTS.filter(x => d.slots[x] != null).map(x => [x, d.slots[x]])); draw(); });
    m.querySelectorAll("[data-pct]").forEach(c => c.onchange = () => { d.slots[c.dataset.pct] = Math.round(+c.value); draw(); });
    m.querySelectorAll("[data-delexc]").forEach(b => b.onclick = () => { d.fixedExceptions.splice(+b.dataset.delexc, 1); draw(); });
    $("#eadd").onclick = () => {
      const days = [...m.querySelectorAll("[data-eday]:checked")].map(c => +c.dataset.eday).sort((a, b) => a - b);
      const slots = [...m.querySelectorAll("[data-eslot]:checked")].map(c => c.dataset.eslot);
      if (!days.length || !slots.length) return toast("Zaznacz dni i posiłki", "err");
      const kc = Math.round(+$("#ekcal").value) || null;
      d.fixedExceptions.push({ days, slots, kcal: kc, note: $("#enote").value.trim() }); draw();
    };
    m.querySelectorAll("[data-fam]").forEach(c => c.onchange = () => { const f = c.dataset.fam;
      d.exclusions.families = c.checked ? [...new Set([...d.exclusions.families, f])] : d.exclusions.families.filter(x => x !== f); });
    $("#fe").onchange = (e) => { d.flags.ironRich = e.target.checked; };
    $("#save").onclick = async () => {
      const e2 = validateSlots(d.slots); if (e2) return toast(e2, "err");
      $("#save").disabled = true;
      try { await be.setProfile(pid, d); S.profiles[pid] = d; toast("Profil zapisany", "ok"); location.hash = "#/wiecej"; }
      catch (e) { toast("Błąd zapisu: " + (e.code || e.message), "err"); $("#save").disabled = false; }
    };
  };
  draw();
}

function adminHtml() {
  const inv = Object.entries(S.config.invites || {});
  return `<div class="card"><h3>Rodzina – zaproszenia</h3>
      <table class="tbl"><tr><th>E-mail</th><th>Profil</th><th>Rola</th><th></th></tr>
      ${inv.map(([e, v]) => `<tr><td>${esc(e)}</td><td>${esc(S.profiles[v.profileId]?.name || "—")}</td><td>${v.role === "admin" ? "administrator" : "domownik"}</td>
        <td>${e === OWNER_EMAIL.toLowerCase() ? "" : `<button class="btn small" data-del="${esc(e)}">Usuń</button>`}</td></tr>`).join("")}</table>
      <div class="row"><input id="invEmail" type="email" placeholder="adres@gmail.com">
        <select id="invProf">${profileList().map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join("")}</select>
        <select id="invRole"><option value="member">domownik</option><option value="admin">administrator</option></select>
        <button class="btn primary" id="invAdd">Dodaj</button></div></div>
    <div class="card"><h3>Import danych</h3>
      <p class="muted small">Najpierw produkty, potem przepisy. Import dodaje nowe i aktualizuje zmienione – niczego nie usuwa. Przed importem zrób kopię.</p>
      <div class="row"><label class="btn">Wybierz plik produktów…<input type="file" accept=".json" id="fProd" hidden></label>
        <label class="btn">Wybierz plik przepisów…<input type="file" accept=".json" id="fRec" hidden></label></div>
      <div id="impOut"></div></div>
    <div class="card"><h3>Kopia zapasowa</h3><p class="muted small">Stan bazy: ${Object.keys(S.products).length} produktów, ${Object.keys(S.recipes).length} przepisów.</p>
      <button class="btn" id="export">Pobierz kopię (JSON)</button></div>`;
}

function bindAdmin() {
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm(`Usunąć dostęp dla ${b.dataset.del}?`)) return;
    const cfg = structuredClone(S.config); delete cfg.invites[b.dataset.del];
    await saveConfig(cfg);
  });
  $("#invAdd").onclick = async () => {
    const email = $("#invEmail").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Podaj poprawny adres e-mail", "err");
    const cfg = structuredClone(S.config); cfg.invites[email] = { role: $("#invRole").value, profileId: $("#invProf").value };
    await saveConfig(cfg);
  };
  $("#fProd").onchange = (e) => readJson(e.target.files[0], importProducts);
  $("#fRec").onchange = (e) => readJson(e.target.files[0], importRecipes);
  $("#export").onclick = exportBackup;
}

async function saveConfig(cfg) {
  try { await be.setConfig(cfg); S.config = cfg; toast("Zapisano", "ok"); route(); }
  catch (e) { toast("Błąd zapisu: " + (e.code || e.message), "err"); }
}

function readJson(file, then) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => { try { then(JSON.parse(r.result)); } catch { toast("To nie jest poprawny plik JSON", "err"); } };
  r.readAsText(file);
}

function showImport(title, v, d, onConfirm) {
  const out = $("#impOut");
  if (!v.ok) {
    out.innerHTML = `<div class="warn"><b>${title}: plik odrzucony</b><ul>${v.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>${v.errorCount > v.errors.length ? `<p>…i ${v.errorCount - v.errors.length} kolejnych.</p>` : ""}</div>`;
    return;
  }
  out.innerHTML = `<div class="okbox"><b>${title}: ${v.count} pozycji</b><br>nowe: ${d.added.length} · zmienione: ${d.changed.length} · bez zmian: ${d.same.length}
    <div class="row"><button class="btn primary" id="impGo" ${d.added.length + d.changed.length ? "" : "disabled"}>Importuj</button><button class="btn" id="impNo">Anuluj</button></div></div>`;
  $("#impNo").onclick = () => out.innerHTML = "";
  $("#impGo").onclick = async () => {
    $("#impGo").disabled = true;
    try { await onConfirm(); toast(`${title}: zaimportowano`, "ok"); await loadData(); route(); }
    catch (e) { toast("Błąd importu: " + (e.code || e.message), "err"); $("#impGo").disabled = false; }
  };
}

function importProducts(json) {
  const v = validateProducts(json);
  const d = v.ok ? diffItems(S.products, json.items, false) : null;
  showImport("Produkty", v, d, async () => {
    const chunks = mergeIntoChunks(await be.getChunks("products"), json.items, [...d.added, ...d.changed], (p) => productChunkOf(p.aisle));
    for (const [cid, c] of Object.entries(chunks)) await be.setChunk("products", cid, c);
    const cfg = structuredClone(S.config); cfg.versions.products = json.version; await be.setConfig(cfg); S.config = cfg;
  });
}

function importRecipes(json) {
  const v = validateRecipes(json, Object.keys(S.products));
  const d = v.ok ? diffItems(S.recipes, json.items, true) : null;
  showImport("Przepisy", v, d, async () => {
    const chunks = mergeIntoChunks(await be.getChunks("recipes"), json.items, [...d.added, ...d.changed], (r) => recipeChunkOf(r.category));
    for (const [cid, c] of Object.entries(chunks)) await be.setChunk("recipes", cid, c);
    const cfg = structuredClone(S.config); cfg.versions.recipes = json.version; await be.setConfig(cfg); S.config = cfg;
  });
}

function exportBackup() {
  const data = { kind: "kopia", appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    config: S.config, profiles: S.profiles, products: S.products, recipes: S.recipes };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = `kopia-dieta-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- uruchomienie ----------
be.onAuth(async (u) => {
  S.user = u;
  if (!u) { S.config = null; if (S.week.unsub) S.week.unsub(); S.week = { sat: null, data: undefined, unsub: null }; return renderLogin(); }
  screen(`<div class="center"><p class="muted">Wczytywanie…</p></div>`);
  await boot();
});

if ("serviceWorker" in navigator && !demo) navigator.serviceWorker.register("./sw.js").catch(() => {});
