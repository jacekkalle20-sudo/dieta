// app.js – Dieta dla Rodziny – v0.7.0 (zamiany i pomijanie składników w posiłku, role składników, sezonowość, tagi „też na kolację/śniadanie”)
import { APP_VERSION, APP_STAGE } from "./version.js";
import { OWNER_EMAIL } from "./config.js";
import { defaultConfig, defaultProfiles, CATEGORY_NAMES, TAG_NAMES, FAMILY_NAMES, SLOT_NAMES, DAY_NAMES, productChunkOf, recipeChunkOf } from "./defaults.js";
import { validateProducts, validateRecipes, diffItems, mergeIntoChunks } from "./importer.js";
import { recipeTotals, recipeFamilies, formatAmount, yieldOf, ingredientAmounts, sumAmounts, amountsTotals, substitutes } from "./nutrition.js";
import { slotKcal, portionScale, defaultSlotFor, validateSlots } from "./scaling.js";
import { SLOTS } from "./defaults.js";
import * as W from "./week.js";
import * as SH from "./shopping.js";
import { vEditRecipe, STATUS_NAMES } from "./edytor.js";
import * as N from "./uwagi.js";
import { AISLES, applyFamilyMap } from "./defaults.js";

const demo = new URLSearchParams(location.search).has("demo");
const { createBackend } = await import(demo ? "./backend-demo.js" : "./backend-firebase.js");
const be = createBackend();

const S = { user: null, config: null, profiles: {}, products: {}, recipes: {}, invite: null, filters: { q: "", cat: "", tag: "", profile: "" }, portion: { profile: "", slot: "", base: false, recipe: "", who: "me", days: "day" }, edit: null,
  week: { sat: null, data: undefined, unsub: null }, weekSel: null, weekProfile: "", todayProfile: "", weekUi: {}, restoreY: 0,
  shop: { lists: undefined, memory: {}, unsubL: null, listId: null, items: undefined, unsubI: null, showDone: true, showStaples: false, open: {} } };
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
  applyFamilyMap(S.products);
  const rc = await be.getChunks("recipes"); S.recipes = {};
  for (const c of Object.values(rc)) Object.assign(S.recipes, c.items || {});
  refreshIndexes();
}
function refreshIndexes() {
  S.kcalOf = W.buildKcalIndex(S.recipes, (r) => recipeTotals(r, S.products));
  S.famOf = W.buildFamilyIndex(S.recipes, S.products);
  S.seasonOf = W.buildSeasonIndex(S.recipes, S.products);
}
const notesApi = () => ({ S, be, $, esc, toast, sheet, closeSheet, isAdmin });
const editorApi = () => ({ S, be, $, esc, fmt, toast, sheet, closeSheet, profileList, W, refreshIndexes });

// ---------- powłoka i nawigacja ----------
const NAV = [["dzis", "Dziś", "☀️"], ["tydzien", "Tydzień", "📅"], ["zakupy", "Zakupy", "🛒"], ["przepisy", "Przepisy", "📖"], ["wiecej", "Więcej", "☰"]];
function renderShell() {
  screen(`<nav class="nav">${NAV.map(([k, n, i]) => `<a href="#/${k}" data-k="${k}"><span>${i}</span>${n}</a>`).join("")}</nav>
    <main id="main"></main>${footer()}`);
}
addEventListener("hashchange", () => S.config && route());
function route() {
  const [, view, arg, a2, a3, a4] = (location.hash || "#/dzis").split("/");
  document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("on", a.dataset.k === ({ przepis: "przepisy", edytuj: "przepisy", profil: "wiecej", uwagi: "wiecej" }[view] || view)));
  const m = $("#main"); if (!m) return;
  closeSheet();
  ({ dzis: () => vToday(m), tydzien: () => vWeek(m, arg), zakupy: () => arg ? vShopList(m, arg) : vShopping(m),
     przepisy: () => vRecipes(m), edytuj: () => isAdmin() ? vEditRecipe(m, arg, editorApi()) : vRecipes(m), przepis: () => vRecipe(m, arg, a2 ? { date: a2, slot: a3, pid: a4 || "" } : null), profil: () => vProfile(m, arg), wiecej: () => vMore(m), uwagi: () => N.vNotes(m, notesApi()) }[view] || (() => vRecipes(m)))();
  window.scrollTo(0, S.restoreY || 0); S.restoreY = 0;
}
// Plan tygodnia: zapamiętane rozwinięte dni i przewinięcie (powrót z przepisu do tego samego miejsca)
addEventListener("scroll", () => { if ((location.hash || "").startsWith("#/tydzien") && S.weekSel && $(".days")) (S.weekUi[S.weekSel] ||= { open: {} }).y = scrollY; }, { passive: true });

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
  const arch = Object.values(S.recipes).filter(r => r.status === "archiwum").length;
  m.innerHTML = `<h2>Przepisy <span class="muted small">(${count - arch})</span>${isAdmin() ? ` <a class="btn small primary" href="#/edytuj/nowy" id="rNew">+ Nowy przepis</a>` : ""}</h2>
    <div class="filters">
      <input id="q" type="search" placeholder="Szukaj przepisu lub składnika…" value="${esc(f.q)}">
      <select id="cat"><option value="">Wszystkie kategorie</option>${Object.entries(CATEGORY_NAMES).map(([k, v]) => `<option value="${k}" ${f.cat === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="tag"><option value="">Wszystkie tagi</option>${Object.entries(TAG_NAMES).map(([k, v]) => `<option value="${k}" ${f.tag === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="prof"><option value="">Bez filtra wykluczeń</option>${profileList().map(([k, p]) => `<option value="${k}" ${f.profile === k ? "selected" : ""}>Bez wykluczeń: ${esc(p.name)}</option>`).join("")}</select>
    </div>${arch ? `<label class="chk small"><input type="checkbox" id="arch" ${f.arch ? "checked" : ""}> pokaż archiwum (${arch})</label>` : ""}<div id="list" class="list"></div>`;
  const draw = () => {
    const q = f.q.trim().toLowerCase(); const ex = f.profile ? excludedFor(f.profile) : new Set();
    const rows = Object.entries(S.recipes).filter(([id, r]) => {
      if ((r.status === "archiwum") !== !!f.arch) return false;
      if (f.cat && r.category !== f.cat) return false;
      if (f.tag && !(r.tags || []).includes(f.tag)) return false;
      if (ex.size && recipeFamilies(r, S.products).some(x => ex.has(x))) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.ingredients.some(x => (S.products[x.p]?.name || "").toLowerCase().includes(q)))) return false;
      return true;
    });
    $("#list").innerHTML = rows.length ? rows.map(([id, r]) => {
      const t = recipeTotals(r, S.products);
      return `<a class="item" href="#/przepis/${id}"><div class="t">${esc(r.name)}</div>
        <div class="meta">${r.status && r.status !== "aktywny" ? `<span class="badge">${esc(STATUS_NAMES[r.status]?.split(" (")[0] || r.status)}</span> ` : ""}${CATEGORY_NAMES[r.category]} · ${fmt(t.kcal)} kcal · Fe ${fmt(t.fe, 1)} mg${r.timeMin ? ` · ${r.timeMin} min` : ""}
        ${(r.tags || []).map(x => `<span class="tag ${x}">${TAG_NAMES[x] || x}</span>`).join("")}</div></a>`;
    }).join("") : `<div class="card muted">Brak przepisów dla tych filtrów.</div>`;
  };
  $("#q").oninput = (e) => { f.q = e.target.value; draw(); };
  $("#cat").onchange = (e) => { f.cat = e.target.value; draw(); };
  $("#tag").onchange = (e) => { f.tag = e.target.value; draw(); };
  $("#prof").onchange = (e) => { f.profile = e.target.value; draw(); };
  if ($("#arch")) $("#arch").onchange = (e) => { f.arch = e.target.checked; draw(); };
  if ($("#rNew")) $("#rNew").onclick = () => { S.edit = null; };
  draw();
}

// ---------- zamiana / pominięcie składnika w posiłku ----------
function openSub(date, slot, pid, from, g) {
  const w = S.week.data; const m = w.days[date][slot]; const rid = W.recipeOf(m, pid);
  const eaters = m.mode === "shared" ? W.participants(m) : [pid];
  const exclude = new Set(eaters.flatMap(p => S.profiles[p]?.exclusions?.families || []));
  const cur = W.subsFor(m, pid)?.[from];
  const orig = S.recipes[rid].ingredients.find(x => x.p === from);
  const gBase = g || Math.round(orig?.g || 0);
  const list = substitutes(from, gBase || 100, S.products, { exclude });
  const sameWeek = W.weekDates(w.start).flatMap(d => SLOTS.map(sl => [d, sl])).filter(([d, sl]) => { const x = w.days[d]?.[sl];
    return x && (m.mode === "shared" ? x.mode === "shared" && x.recipeId === rid : x.mode !== "shared" && x.per?.[pid]?.recipeId === rid && !x.per[pid].outside); }).length;
  const st = { scope: "meal" };
  const d = sheet(`<h3>⇄ ${esc(S.products[from]?.name || from)}${gBase ? ` <span class="muted small">(${gBase} g)</span>` : ""}</h3>
    <p class="small muted">${m.mode === "shared" ? "Posiłek wspólny – zmiana dla wszystkich przy stole." : `Dla: ${esc(pName(pid))}.`} Ilość zamiennika liczona na te same kcal.</p>
    ${sameWeek > 1 ? `<div class="seg"><button class="on" data-sc="meal">Ten posiłek</button><button data-sc="week">Cały tydzień (${sameWeek}×)</button></div>` : ""}
    <div class="rlist">${cur ? `<button class="ritem" data-to="__restore"><span>↩ Przywróć oryginał</span><span class="muted small">${esc(S.products[from]?.name || from)}</span></button>` : ""}
      <button class="ritem" data-to="__skip"><span>🚫 Pomiń ten składnik</span><span class="muted small">bez zamiennika</span></button>
      ${list.map(x => `<button class="ritem" data-to="${x.id}" data-f="${x.f}"><span>${esc(x.name)}${x.related ? ` <span class="muted small">podobny</span>` : ""}</span><span class="muted small">≈ ${x.g} g · ${x.kcal100} kcal/100 g${x.fe100 >= 2 ? ` · Fe ${fmt(x.fe100, 1)}` : ""}</span></button>`).join("")
        || `<p class="muted small">Brak zamienników w bazie dla tej grupy produktów.</p>`}</div>
    <div class="row"><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  d.querySelectorAll("[data-sc]").forEach(b => b.onclick = () => { st.scope = b.dataset.sc; d.querySelectorAll("[data-sc]").forEach(x => x.classList.toggle("on", x === b)); });
  d.querySelectorAll("[data-to]").forEach(b => b.onclick = async () => {
    const to = b.dataset.to; const sub = to === "__restore" ? null : to === "__skip" ? { to: null } : { to, f: +b.dataset.f };
    const w2 = structuredClone(S.week.data); const slots = W.setSub(w2, date, slot, pid, from, sub, st.scope);
    closeSheet(); for (const sl of slots) await saveSlot(w2, sl); route();
    toast(sub === null ? "Przywrócono oryginał" : sub.to ? `Zamieniono na: ${S.products[sub.to].name}` : "Pominięto składnik", "ok");
  });
}

// ---------- desery: do listy zakupów i do planu dnia ----------
const MULTS = [[0.5, "½ całości"], [1, "Całość"], [2, "2 × całość"]];
const multTxt = (x) => (MULTS.find(m => m[0] === x)?.[1] || `×${fmt(x, 1)}`).toLowerCase();
function openDessertShop(rid) {
  const r = S.recipes[rid]; ensureLists();
  const lists = Object.entries(S.shop.lists || {}).filter(([, l]) => l.status !== "zamknieta").sort((a, b) => (b[1].createdAt || "").localeCompare(a[1].createdAt || ""));
  const st = { list: lists[0]?.[0] || "_new", mult: 1 };
  const d = sheet(`<h3>🛒 ${esc(r.name)} – do listy zakupów</h3>
    <label class="small">Lista<select id="dsList" style="width:100%">${lists.map(([id, l]) => `<option value="${id}">${esc(l.name)}</option>`).join("")}<option value="_new">+ nowa lista „Desery”</option></select></label>
    <div class="seg" id="dsMult">${MULTS.map(([v, n]) => `<button data-m="${v}" class="${v === 1 ? "on" : ""}">${n}</button>`).join("")}</div>
    <p class="small muted">${yieldOf(r) ? `Całość = ${yieldOf(r)} porcji.` : "Liczba porcji z całości nieustawiona – liczę ilość z przepisu."} Pozycje dostaną dopisek „do: ${esc(r.name)}”; „Przelicz” ich nie usuwa.</p>
    <div class="row"><button class="btn primary" id="dsGo">Dodaj</button><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  d.querySelector("#dsList").value = st.list; d.querySelector("#dsList").onchange = (e) => st.list = e.target.value;
  d.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { st.mult = +b.dataset.m; d.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b)); });
  d.querySelector("#dsGo").onclick = () => {
    const items = SH.dessertItems(r, rid, st.mult, S.products, rid + Date.now().toString(36));
    let lid = st.list;
    if (lid === "_new") { lid = be.newListId(); bg(be.createList(lid, { name: "Desery", createdAt: new Date().toISOString(), createdBy: S.user.email, createdByName: S.user.name || S.user.email,
      range: null, slots: null, status: "aktywna" }, items)); }
    else bg(be.writeItems(lid, items, []));
    closeSheet(); toast(`Dodano ${Object.keys(items).length} pozycji: ${r.name} (${multTxt(st.mult)})`, "ok");
  };
}
function openDessertPlan(rid) {
  const r = S.recipes[rid]; const today = todayYmd(); const days = [...Array(14)].map((_, i) => W.addDays(today, i));
  const st = { date: days.find(x => W.dayNum(x) === 7) || today, mult: 1 };
  const d = sheet(`<h3>📅 ${esc(r.name)} – zaplanuj</h3>
    <div class="row tight daypick">${days.map(x => `<button class="btn small ${x === st.date ? "primary" : ""}" data-dd="${x}">${DAY_NAMES[W.dayNum(x)]} ${dLabel(x)}</button>`).join("")}</div>
    <div class="seg">${MULTS.map(([v, n]) => `<button data-m="${v}" class="${v === 1 ? "on" : ""}">${n}</button>`).join("")}</div>
    <p class="small muted">Deser pojawi się w planie dnia jako „poza bilansem”, a lista zakupów z planu uwzględni jego składniki.</p>
    <div class="row"><button class="btn primary" id="dpGo">Zaplanuj</button><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  d.querySelectorAll("[data-dd]").forEach(b => b.onclick = () => { st.date = b.dataset.dd; d.querySelectorAll("[data-dd]").forEach(x => x.classList.toggle("primary", x === b)); });
  d.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { st.mult = +b.dataset.m; d.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b)); });
  d.querySelector("#dpGo").onclick = async () => {
    const sat = W.saturdayOf(st.date);
    const w = S.week.sat === sat && S.week.data ? structuredClone(S.week.data) : await be.getWeek(sat).catch(() => null);
    if (!w) return toast(`Brak planu na tydzień od ${dLabel(sat)} – najpierw go wygeneruj`, "err");
    const de = W.addDessert(w, st.date, rid, st.mult, S.user.email);
    if (S.week.sat === sat) S.week.data = w;
    closeSheet(); toast(`Zaplanowano: ${r.name} – ${DAY_NAMES[W.dayNum(st.date)]} ${dLabel(st.date)}`, "ok");
    bg(be.updateMeals(sat, [{ date: st.date, slot: "deser", meal: de }], { updatedAt: new Date().toISOString(), updatedBy: S.user.email }));
  };
}
function dessertHtml(w, d) {
  const items = w.days[d]?.deser?.items || []; if (!items.length) return "";
  return `<div class="slot dessert"><div class="sh">Deser <span class="muted small">poza bilansem</span></div>
    ${items.map((it, i) => `<div class="sl person one"><div class="ml"><span class="mn">🍰 <a href="#/przepis/${it.rid}">${esc(rName(it.rid))}</a></span><span class="mm">${multTxt(it.mult)}${yieldOf(S.recipes[it.rid]) ? ` · ${fmt(yieldOf(S.recipes[it.rid]) * it.mult)} porcji` : ""}</span></div>
      <button class="btn small dots" data-dx="${d}|${i}" aria-label="Usuń deser">✕</button></div>`).join("")}</div>`;
}
function bindDessertRemove(m, w) {
  m.querySelectorAll("[data-dx]").forEach(b => b.onclick = () => {
    const [d, i] = b.dataset.dx.split("|"); const it = w.days[d].deser.items[+i];
    if (!confirm(`Usunąć deser „${rName(it.rid)}” z planu?`)) return;
    const w2 = structuredClone(S.week.data); const de = W.removeDessert(w2, d, +i); S.week.data = w2;
    bg(be.updateMeals(w2.start, [{ date: d, slot: "deser", meal: de }], { updatedAt: new Date().toISOString(), updatedBy: S.user.email })); route();
  });
}

// Rozpiska ilości: „Gotujesz 4 porcje na sob + nd: Jacek ×1,00 + ×1,00 · Agata … = ×3,90 przepisu”
function cookTxt(cook) {
  const by = {}; for (const r of cook.rows) (by[r.pid] ||= []).push(r.scale);
  const n = cook.rows.length; const pl = n === 1 ? "porcję" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "porcje" : "porcji";
  return `Gotujesz ${n} ${pl}${cook.dates.length > 1 ? ` na ${cook.dates.map(d => DAY_NAMES[W.dayNum(d)]).join(" + ")}` : ""}: ${byOrder(Object.keys(by)).map(pid => `${esc(S.profiles[pid]?.name)} ${by[pid].map(x => "×" + fmt(x, 2)).join(" + ")}`).join(" · ")} = <b>×${fmt(cook.total, 2)} przepisu</b>`;
}
function vRecipe(m, id, cx = null) {
  const r = S.recipes[id];
  if (!r) { m.innerHTML = `<div class="card">Nie znaleziono przepisu.</div>`; return; }
  const P = S.portion;
  const ckey = id + (cx ? `/${cx.date}/${cx.slot}/${cx.pid}` : "");
  if (P.recipe !== ckey) { P.recipe = ckey; P.slot = ""; P.who = "me"; P.days = "day"; P.base = false; P.dm = "";
    if (cx) { P.profile = cx.pid || S.invite.profileId; P.slot = cx.slot;
      const mm = S.week.data?.days?.[cx.date]?.[cx.slot]; // we wspólnym posiłku „dla mnie” = zalogowana osoba, jeśli je
      if (mm?.mode === "shared" && W.participants(mm).includes(S.invite.profileId)) P.profile = S.invite.profileId; } }
  const wk = cx && S.week.data && S.week.sat === W.saturdayOf(cx.date) ? S.week.data : null;
  const meal = wk?.days?.[cx.date]?.[cx.slot];
  const cookCtx = meal && cx.pid !== undefined && W.recipeOf(meal, cx.pid) === id;
  const ctxW = cookCtx ? ctxFor(wk.start) : null;
  const cDay = cookCtx ? W.cookingScales(wk, ctxW, cx.date, cx.slot, "day", cx.pid) : null;
  const cBlk = cookCtx ? W.cookingScales(wk, ctxW, cx.date, cx.slot, "block", cx.pid) : null;
  // dwa przełączniki: dla kogo (ja / wszyscy przy stole) × na ile (dziś / dni bloku gotowane razem)
  const whoOpts = cookCtx && (cDay.rows.length > 1 || new Set(cBlk.rows.map(x => x.pid)).size > 1) ? [["me", "Dla mnie"], ["all", "Dla wszystkich przy stole"]] : [];
  const daysOpts = cookCtx && cBlk.dates.length > 1 ? [["day", "Dziś"], ["block", `Na ${cBlk.dates.length} dni (${cBlk.dates.map(d => DAY_NAMES[W.dayNum(d)]).join(" + ")})`]] : [];
  if (!whoOpts.length) P.who = "me"; if (!daysOpts.length) P.days = "day";
  const mePid = cookCtx && W.participants(meal).includes(P.profile) && W.recipeOf(meal, P.profile) === id ? P.profile : cx?.pid;
  // gospodarz posiłku do „Dołącz domownika”: wspólny – brak; indywidualny – osoba lub ta, do której dołączyła
  const joinHost = cookCtx && meal.mode !== "shared" ? (meal.per[cx.pid]?.with || cx.pid) : null;
  const canJoin = cookCtx && (meal.mode === "shared" || (joinHost && !meal.per[joinHost]?.outside)) && W.joinOptions(wk, ctxW, cx.date, cx.slot, joinHost).length > 0;
  if (!P.profile || !S.profiles[P.profile]) P.profile = S.invite.profileId || profileList()[0]?.[0];
  const prof = S.profiles[P.profile];
  if (!P.slot || !prof?.slots?.[P.slot]) P.slot = defaultSlotFor(r.category, prof);
  const base = recipeTotals(r, S.products); const fam = recipeFamilies(r, S.products);
  const target = slotKcal(prof, P.slot);
  const lim = S.config.scaleLimits || { min: 0.5, max: 2.0 };
  let ps = P.base ? { scale: 1, raw: 1, ok: true } : portionScale(base.kcal, target, lim);
  let cook = null;
  if (cookCtx && !P.base && (P.who === "all" || P.days === "block")) {
    cook = W.cookingScales(wk, ctxW, cx.date, cx.slot, P.days, P.who === "me" ? mePid : cx.pid, P.who);
    ps = { scale: cook.total, raw: cook.total, ok: true }; }
  // desery: poza bilansem, ilość w porcjach / całościach (yield = liczba porcji z całości)
  const isDes = r.category === "deser"; let dessertHtml = "";
  if (isDes) {
    const Y = yieldOf(r) || 0;
    const dOpts = Y ? [["p", 1, "1 porcja"], ["h", Y / 2, "½ całości"], ["c", Y, `Całość (${Y} porcji)`], ["d", Y * 2, "2 × całość"]] : [["p", 1, "Ilość z przepisu"]];
    if (!dOpts.some(o => o[0] === P.dm)) P.dm = Y ? "c" : "p";
    ps = { scale: dOpts.find(o => o[0] === P.dm)[1], raw: 1, ok: true }; cook = null;
    dessertHtml = `<div class="card portion"><div class="small">🍰 Deser · poza bilansem kcal${Y ? ` · wychodzi ${Y} porcji · 1 porcja ≈ ${fmt(base.kcal)} kcal`
      : ` · ${isAdmin() ? "ustaw w edytorze („Wychodzi porcji”), ile porcji daje całość" : "liczba porcji z całości nieustawiona"}`}</div>
      ${dOpts.length > 1 ? `<div class="seg">${dOpts.map(([v, , n]) => `<button class="${P.dm === v ? "on" : ""}" data-dm="${v}">${n}</button>`).join("")}</div>` : ""}
      <div class="row tight"><button class="btn small" id="dShop">🛒 Do listy zakupów</button><button class="btn small" id="dPlan">📅 Zaplanuj na dzień</button></div></div>`;
  }
  const k = ps.scale;
  // ilości: role składników (stałe / w sztukach / skaluj) i zamiany z planu; desery liniowo
  const mySubs = cookCtx ? W.subsFor(meal, mePid || cx.pid) : null;
  const amounts = isDes ? ingredientAmounts(r, k, S.products, null, { linear: true })
    : cook ? sumAmounts(cook.rows.map(row => ingredientAmounts(r, row.scale, S.products, W.subsFor(wk.days[row.date][cx.slot], row.pid))))
    : ingredientAmounts(r, k, S.products, P.base ? null : mySubs);
  const skipped = !isDes && !cook && mySubs && !P.base ? Object.entries(mySubs).filter(([, v]) => !v.to).map(([pid]) => pid) : [];
  const t = amountsTotals(amounts, S.products);
  const canSub = cookCtx && !isDes;
  const blocked = profileList().filter(([, p]) => (p.exclusions?.families || []).some(x => fam.includes(x)));
  const mine = (prof?.exclusions?.families || []).filter(x => fam.includes(x));
  m.innerHTML = `<a href="${cx ? "javascript:history.back()" : "#/przepisy"}" class="back">← ${cx ? "Wróć do planu" : "Przepisy"}</a>
    <h2>${esc(r.name)}${isAdmin() ? ` <button class="btn small" id="rEdit">✏️ Edytuj</button>` : ""}</h2>
    <div class="meta">${r.status && r.status !== "aktywny" ? `<span class="badge">${esc(STATUS_NAMES[r.status] || r.status)}</span> ` : ""}${CATEGORY_NAMES[r.category]}${r.timeMin ? ` · ${r.timeMin} min` : ""} · ${esc(r.source)} ${(r.tags || []).map(x => `<span class="tag ${x}">${TAG_NAMES[x] || x}</span>`).join("")}</div>
    ${isDes ? dessertHtml : `    <div class="card portion">
      ${whoOpts.length ? `<div class="seg">${whoOpts.map(([v, n]) => `<button class="${P.who === v ? "on" : ""}" data-who="${v}">${n}</button>`).join("")}</div>` : ""}
      ${daysOpts.length ? `<div class="seg">${daysOpts.map(([v, n]) => `<button class="${P.days === v ? "on" : ""}" data-days="${v}">${n}</button>`).join("")}</div>` : ""}
      ${canJoin ? `<div class="row tight"><button class="btn small" id="pJoin">➕ Dołącz domownika</button>${cDay.rows.length > 1 ? `<span class="muted small">Przy stole: ${cDay.rows.map(r => esc(S.profiles[r.pid]?.name)).join(", ")}</span>` : ""}</div>` : ""}
      ${cook ? `<div class="small">${cookTxt(cook)}</div>` : `
      <div class="row tight">
        <select id="pProf">${profileList().map(([pid, p]) => `<option value="${pid}" ${pid === P.profile ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <select id="pSlot">${slotsOf(prof).map(sl => `<option value="${sl}" ${sl === P.slot ? "selected" : ""}>${SLOT_NAMES[sl]} · ${slotKcal(prof, sl)} kcal</option>`).join("")}</select>
        <label class="chk"><input type="checkbox" id="pBase" ${P.base ? "checked" : ""}> porcja bazowa</label>
      </div>
      <div class="small ${ps.ok ? "muted" : "warntext"}">${P.base ? `Porcja bazowa przepisu: ${fmt(base.kcal)} kcal.` :
        `Porcja dla: <b>${esc(prof?.name)}</b> · ${SLOT_NAMES[P.slot]} ${target} kcal · skala ×${fmt(k, 2)}${ps.ok ? "" : ` – poza zakresem ${fmt(lim.min, 1)}–${fmt(lim.max, 1)}: przepis słabo pasuje do tego posiłku`}`}</div>`}
    </div>
`}
    ${mine.length ? `<div class="warn"><b>${esc(prof.name)}</b> wyklucza: ${mine.map(x => FAMILY_NAMES[x] || x).join(", ")} – ten przepis nie będzie proponowany tej osobie.</div>`
      : blocked.length ? `<div class="note">Zawiera: ${fam.map(x => FAMILY_NAMES[x] || x).join(", ")} – nie dla: ${blocked.map(([, p]) => esc(p.name)).join(", ")}</div>` : ""}
    <div class="stats"><div><b>${fmt(t.kcal)}</b>kcal</div><div><b>${fmt(t.p)}</b>białko g</div><div><b>${fmt(t.f)}</b>tłuszcz g</div><div><b>${fmt(t.c)}</b>węgl. g</div><div><b>${fmt(t.fe, 1)}</b>żelazo mg</div></div>
    <div class="card"><h3>Składniki</h3>
      <ul class="ing">${amounts.map(x => { const p = S.products[x.p]; return `<li ${canSub ? `class="subable" data-sub="${esc(x.subFrom || x.p)}" data-g="${Math.round(x.g)}"` : ""}><span>${esc(p?.name || x.p)}${x.subFrom ? ` <span class="muted small">zamiast: ${esc(S.products[x.subFrom]?.name || x.subFrom)}</span>` : ""}${canSub ? ` <span class="subhint">⇄</span>` : ""}</span><span>${esc(formatAmount({ ...x }, p, 1))}</span></li>`; }).join("")}
      ${skipped.map(pid => `<li class="subable skipped" data-sub="${esc(pid)}" data-g="0"><span>${esc(S.products[pid]?.name || pid)} <span class="muted small">pominięto</span></span><span>—</span></li>`).join("")}</ul>
      ${canSub ? `<p class="small muted">Dotknij składnika, żeby go zamienić albo pominąć${meal.mode === "shared" ? " (we wspólnym posiłku – dla wszystkich przy stole)" : ""}.</p>` : ""}</div>
    <div class="card"><h3>Przygotowanie</h3><p>${esc(r.steps)}</p></div>
    <p class="muted small">Porcja bazowa ${fmt(base.kcal)} kcal (wyliczone z gramatur; źródło podawało ${r.sourceKcal ?? "–"} kcal). Id: ${id}, wersja ${r.rev}.</p>
    <p><button class="btn small" id="rNote">💬 Uwaga do tego przepisu</button></p>`;
  const again = () => vRecipe(m, id, cx);
  m.querySelectorAll("[data-who]").forEach(b => b.onclick = () => { P.who = b.dataset.who; again(); });
  m.querySelectorAll("[data-days]").forEach(b => b.onclick = () => { P.days = b.dataset.days; again(); });
  if ($("#pJoin")) $("#pJoin").onclick = () => { P.who = "all"; openJoin(cx.date, cx.slot, joinHost); };
  if ($("#rEdit")) $("#rEdit").onclick = () => { location.hash = `#/edytuj/${id}`; };
  m.querySelectorAll("[data-dm]").forEach(b => b.onclick = () => { P.dm = b.dataset.dm; again(); });
  if ($("#dShop")) $("#dShop").onclick = () => openDessertShop(id);
  m.querySelectorAll("[data-sub]").forEach(li => li.onclick = () => openSub(cx.date, cx.slot, meal.mode === "shared" ? null : (mePid || cx.pid), li.dataset.sub, +li.dataset.g));
  if ($("#dPlan")) $("#dPlan").onclick = () => openDessertPlan(id);
  $("#rNote").onclick = () => N.openNoteForm(notesApi(), { label: `przepis: ${r.name}`, ref: `#/przepis/${id}` });
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
  return { sat, profiles: S.profiles, config: S.config, recipes: S.recipes, kcalOf: S.kcalOf, famOf: S.famOf, seasonOf: S.seasonOf, history, rng: Math.random };
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

// Linia posiłku: nazwa dania (1. wiersz) + drobne szczegóły (2. wiersz) – opcja kcal pomijana w widoku wspólnym
function mealLine(w, date, slot, pid, { kcal = true } = {}) {
  const m = w.days[date][slot]; const p = m.per[pid];
  if (p.outside) return `<span class="mn muted">poza domem</span><span class="mm">${[p.note && p.note !== "poza domem" ? esc(p.note) : "", p.kcal ? `~${p.kcal} kcal` : ""].filter(Boolean).join(" · ")}</span>`;
  const rid = m.mode === "shared" ? m.recipeId : p.recipeId;
  const kc = rid && p.scale ? Math.round(S.kcalOf[rid] * p.scale) : null;
  const lo = m.mode === "shared" ? (m.cook === false ? m.leftoverFrom : null) : (p.cook === false ? p.leftoverFrom : null);
  const guests = m.mode === "individual" ? byOrder(Object.keys(m.per).filter(g => m.per[g].with === pid && !m.per[g].outside)) : [];
  const meta = [kcal && kc ? `${kc} kcal` : "", lo ? `z ${DAY_NAMES[W.dayNum(lo)]}` : "",
    rid && (S.recipes[rid]?.tags || []).includes("zelazo") ? `<span class="fe">Fe</span>` : "",
    rid && W.inSeason({ seasonOf: S.seasonOf }, rid, date) ? "🌱" : "",
    (() => { const sb = W.subsFor(m, pid); const n = sb ? Object.keys(sb).length : 0; return n ? `⇄ ${n} ${n === 1 ? "zmiana" : n < 5 ? "zmiany" : "zmian"}` : ""; })(),
    (m.mode === "shared" ? m.locked : p.locked) ? "🔒" : "",
    p.with ? `z: ${esc(pName(p.with))}` : "", guests.length ? `+ ${guests.map(g => esc(pName(g))).join(", ")}` : "", p.extra ? "dodatkowo" : ""].filter(Boolean);
  return `<span class="mn">${rid ? `<a href="#/przepis/${rid}/${date}/${slot}/${pid}">${esc(rName(rid))}</a>` : `<span class="warntext">${rName(null)}</span>`}</span>${meta.length ? `<span class="mm">${meta.join(" · ")}</span>` : ""}`;
}

function slotHtml(w, date, slot, only) {
  const m = w.days[date][slot]; const parts = byOrder(W.participants(m));
  const outs = byOrder(Object.keys(m.per)).filter(pid => m.per[pid].outside).map(pid => [pid, m.per[pid]]);
  const extras = parts.filter(pid => m.per[pid].extra);
  const act = (pid = "") => `<button class="btn small dots" data-act="${date}|${slot}|${pid}" aria-label="Akcje">⋯</button>`;
  if (only) {
    if (!m.per[only]) return "";
    return `<div class="slot"><div class="sh">${SLOT_NAMES[slot]}${m.mode === "shared" ? ` <span class="badge sh2">wspólny</span>` : ""}</div>
      <div class="sl person one"><div class="ml">${mealLine(w, date, slot, only)}</div>${act(m.mode === "shared" ? "" : only)}</div></div>`;
  }
  if (m.mode === "shared") {
    const lena = parts.filter(pid => S.profiles[pid]?.flags?.ironRich && m.recipeId && !(S.recipes[m.recipeId]?.tags || []).includes("zelazo"));
    const kc = m.recipeId ? parts.map(pid => `${esc(pName(pid))} ${Math.round(S.kcalOf[m.recipeId] * (m.per[pid].scale || 0))}`).join(" · ") : "";
    return `<div class="slot shared"><div class="sh">${SLOT_NAMES[slot]} <span class="badge sh2">wspólny · ${parts.length} os.</span> ${act()}</div>
      <div class="sl"><div class="ml">${mealLine(w, date, slot, parts[0] || Object.keys(m.per)[0], { kcal: false })}</div></div>
      <div class="mm">${kc} kcal${extras.length ? ` · dodatkowo: ${extras.map(x => esc(pName(x))).join(", ")}` : ""}</div>
      ${outs.length ? `<div class="small muted">Poza domem: ${outs.map(([pid, p]) => esc(pName(pid)) + (p.note ? ` (${esc(p.note)})` : "")).join(", ")}</div>` : ""}
      ${lena.map(pid => `<div class="hint">Fe+ ${esc(pName(pid))}: ${esc(W.ironHints(S.profiles[pid])[0])}</div>`).join("")}</div>`;
  }
  return `<div class="slot"><div class="sh">${SLOT_NAMES[slot]} <span class="muted small">indywidualnie</span></div>
    ${byOrder(Object.keys(m.per)).map(pid => `<div class="sl person"><b>${esc(pName(pid))}</b><div class="ml">${mealLine(w, date, slot, pid)}</div>${act(pid)}</div>`).join("")}</div>`;
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
      const ui = S.weekUi[sat]?.open?.[d];
      const isOpen = ui !== undefined ? ui : d === today || (!W.weekDates(sat).includes(today) && d === sat) || matchMedia("(min-width:900px)").matches;
      return `<details class="day card" data-d="${d}" ${isOpen ? "open" : ""}>
        <summary><b>${DAY_FULL[W.dayNum(d)]}</b> ${dLabel(d)}${d === today ? ` <span class="badge sh2">dziś</span>` : ""}${sum ? ` <span class="muted small">· ${sum.kcal} / ${sum.target} kcal</span>` : ""}</summary>
        ${slots.map(sl => slotHtml(w, d, sl, only)).join("") || `<p class="muted small">Brak posiłków.</p>`}${dessertHtml(w, d)}</details>`; }).join("")}</div>
      <p class="muted small">Wygenerowano: ${w.generatedAt ? new Date(w.generatedAt).toLocaleString("pl-PL") : "—"}${w.updatedBy ? ` · ostatnia zmiana: ${esc(w.updatedBy)}` : ""}</p>`;
  }
  $("#wProf").onchange = (e) => { S.weekProfile = e.target.value; route(); };
  const ui = S.weekUi[sat] ||= { open: {}, y: 0 };
  if (w) bindDessertRemove(m, w);
  m.querySelectorAll("details.day").forEach(dd => dd.addEventListener("toggle", () => { ui.open[dd.dataset.d] = dd.open; }));
  if (w) S.restoreY = ui.y || 0;
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
        <div class="sl"><div class="ml">${mealLine(w, today, sl, pid)}</div></div>
        <div class="row tight">${e.extra ? "" : `<button class="btn small" data-out="${sl}">${e.outside ? "Jednak w domu" : "Jem poza domem"}</button>`}
        <button class="btn small" data-act="${today}|${sl}|${mm.mode === "shared" ? "" : pid}">⋯ więcej</button></div></div>`; }).join("")}</div>
    ${dessertHtml(w, today) ? `<div class="card tslot">${dessertHtml(w, today)}</div>` : ""}
    <p><a href="#/tydzien">Cały tydzień →</a></p>`;
  bindDessertRemove(m, w);
  $("#tProf").onchange = (e) => { S.todayProfile = e.target.value; route(); };
  m.querySelectorAll("[data-act]").forEach(b => b.onclick = () => { const [d, sl, p2] = b.dataset.act.split("|"); openActions(d, sl, p2); });
  m.querySelectorAll("[data-out]").forEach(b => b.onclick = async () => {
    const sl = b.dataset.out; const goingOut = !w.days[today][sl].per[pid].outside; let kc = null;
    if (goingOut) { const v = prompt("Orientacyjne kcal posiłku poza domem (opcjonalnie):", ""); if (v === null) return; kc = Math.round(+v) || null; }
    const w2 = structuredClone(S.week.data); const r = W.setOutside(w2, ctxFor(sat), today, sl, pid, goingOut, kc);
    await saveSlot(w2, sl); route(); if (r.warning) toast(r.warning, "err");
  });
}

// ---------- listy zakupów (M4) ----------
const SLOT_SHORT = { sniadanie: "śn", ii_sniadanie: "II śn", obiad: "obiad", przekaska: "przek", kolacja: "kol", deser: "🍰 deser" };
function ensureLists() {
  if (S.shop.unsubL) return;
  S.shop.unsubL = be.watchLists((d) => {
    S.shop.memory = d[SH.MEMORY_DOC]?.items || {};
    S.shop.lists = Object.fromEntries(Object.entries(d).filter(([id]) => !id.startsWith("_"))); rerenderShop(); }, (e) => toast("Błąd synchronizacji list: " + (e.code || e.message), "err"));
}
function ensureItems(id) {
  if (S.shop.listId === id) return;
  if (S.shop.unsubI) S.shop.unsubI();
  S.shop.listId = id; S.shop.items = undefined;
  S.shop.unsubI = be.watchItems(id, (d) => { if (S.shop.listId !== id) return; S.shop.items = d; rerenderShop(); },
    (e) => toast("Błąd synchronizacji listy: " + (e.code || e.message), "err"));
}
// Odświeżenie bez przewijania do góry (zmiany z innych telefonów, odhaczanie)
function rerenderShop() {
  const [, view, arg] = (location.hash || "").split("/"); const m = $("#main");
  if (view !== "zakupy" || !m || $("#sheet")) return;
  // zachowanie wpisywanego tekstu i kursora przy odświeżeniu (np. ktoś odhacza na innym telefonie)
  const keep = ["lsTxt", "lsAmt", "lsAisle"].map(id => [id, $("#" + id)?.value]); const act = document.activeElement?.id;
  const y = scrollY; arg ? vShopList(m, arg) : vShopping(m); scrollTo(0, y);
  for (const [id, v] of keep) if (v != null && $("#" + id)) $("#" + id).value = v;
  if (act && $("#" + act)) { $("#" + act).focus(); if (act === "lsTxt") drawSug(); }
}
// podpowiedzi przy dodawaniu pozycji ręcznej
function drawSug() {
  const box = $("#lsSug"); if (!box) return;
  const q = $("#lsTxt").value; const list = SH.suggestions(S.shop.memory, S.products, q, q ? 6 : 8);
  box.innerHTML = list.map((x, i) => `<button type="button" class="chip ${x.src}" data-sug="${i}">${esc(x.name)}${x.amount ? ` <span class="muted">${esc(x.amount)}</span>` : ""}</button>`).join("");
  box.querySelectorAll("[data-sug]").forEach(b => b.onclick = () => addManual(list[+b.dataset.sug]));
}
function addManual(x) {
  const id = S.shop.listId; const items = S.shop.items; if (!id || !items || !x?.name?.trim()) return;
  const it = SH.manualItem(x.name, x.aisle || "Inne", x.amount || "");
  const iid = be.newItemId(id); items[iid] = it;
  bg(be.setItem(id, iid, it)); bg(be.rememberItem(SH.memKey(it.name), SH.rememberEntry(S.shop.memory, it)));
  S.shop.memory[SH.memKey(it.name)] = SH.rememberEntry(S.shop.memory, it);
  if ($("#lsTxt")) { $("#lsTxt").value = ""; $("#lsAmt").value = ""; $("#lsAisle").value = "Inne"; }
  rerenderShop(); setTimeout(() => { $("#lsTxt")?.focus(); drawSug(); }, 0);
}
const bg = (p) => p.catch(e => toast("Błąd zapisu: " + (e.code || e.message), "err")); // zapis w tle (działa offline)
const rangeTxt = (l) => l.range ? `${DAY_NAMES[W.dayNum(l.range.from)]} ${dLabel(l.range.from)} – ${DAY_NAMES[W.dayNum(l.range.to)]} ${dLabel(l.range.to)}` : "lista ręczna";
const slotsTxt = (l) => !l.range ? "własne pozycje" : (!l.slots || l.slots.length === SLOTS.length ? "wszystkie posiłki" : l.slots.map(x => SLOT_NAMES[x]).join(", "))
  + (l.people ? ` · dla: ${l.people.map(p => esc(pName(p))).join(", ")}` : "");
async function weeksFor(from, to) {
  const out = {};
  for (const sat of SH.saturdaysIn(from, to)) out[sat] = S.week.sat === sat && S.week.data !== undefined ? S.week.data : await be.getWeek(sat).catch(() => null);
  return out;
}

function vShopping(m) {
  ensureLists(); const L = S.shop.lists;
  if (L === undefined) { m.innerHTML = `<h2>Zakupy</h2><div class="card muted">Wczytywanie…</div>`; return; }
  const arr = Object.entries(L).sort((a, b) => (b[1].createdAt || "").localeCompare(a[1].createdAt || ""));
  const act = arr.filter(([, l]) => l.status !== "zamknieta"), closed = arr.filter(([, l]) => l.status === "zamknieta");
  const card = ([id, l]) => `<a class="card listcard" href="#/zakupy/${id}"><b>${esc(l.name)}</b>
    <span class="muted small">${rangeTxt(l)} · ${slotsTxt(l)}</span><span class="muted small">utworzył(a): ${esc(l.createdByName || l.createdBy || "")}</span></a>`;
  m.innerHTML = `<h2>Zakupy</h2>
    <div class="row tight"><button class="btn primary" id="newList">+ Nowa lista z planu</button><button class="btn" id="newEmpty">+ Pusta lista</button></div>
    ${act.length ? act.map(card).join("") : `<div class="card muted">Brak aktywnych list. Utwórz listę z planu tygodnia.</div>`}
    ${closed.length ? `<details class="card"><summary>Zamknięte (${closed.length})</summary>${closed.map(card).join("")}</details>` : ""}`;
  $("#newList").onclick = () => openNewList();
  $("#newEmpty").onclick = async () => {
    const name = prompt("Nazwa listy:", "Dokupić"); if (!name) return;
    const id = be.newListId();
    bg(be.createList(id, { name: name.trim(), createdAt: new Date().toISOString(), createdBy: S.user.email, createdByName: S.user.name || S.user.email, range: null, slots: null, status: "aktywna" }, {}));
    location.hash = `#/zakupy/${id}`;
  };
}

function openNewList() {
  const today = todayYmd(); const sat = W.saturdayOf(today);
  const presets = { tw: [sat, W.addDays(sat, 6), "Ten tydzień"], dz: [today, W.addDays(sat, 6), "Od dziś do pt"], nt: [W.addDays(sat, 7), W.addDays(sat, 13), "Następny tydzień"] };
  const st = { from: today === sat ? sat : today, to: W.addDays(sat, 6), slots: [...SLOTS], people: profileList().map(([k]) => k), desserts: true };
  const d = sheet(`<h3>Nowa lista z planu</h3>
    <div class="row tight">${Object.entries(presets).map(([k, [, , n]]) => `<button class="btn small" data-pr="${k}">${n}</button>`).join("")}</div>
    <div class="row tight"><label>Od <input type="date" id="nlFrom"></label><label>Do <input type="date" id="nlTo"></label></div>
    <div class="small muted">Posiłki:</div><div class="row tight">${SLOTS.map(sl => `<label class="chk"><input type="checkbox" data-nls="${sl}" checked> ${SLOT_NAMES[sl]}</label>`).join("")}
      <label class="chk"><input type="checkbox" id="nlDes" checked> Desery z planu</label></div>
    <div class="small muted">Dla kogo:</div><div class="row tight">${profileList().map(([k, p]) => `<label class="chk"><input type="checkbox" data-nlp="${k}" checked> ${esc(p.name)}</label>`).join("")}</div>
    <label class="small">Nazwa <input id="nlName" style="width:100%"></label>
    <div id="nlInfo" class="small muted"></div>
    <div class="row"><button class="btn primary" id="nlGo">Utwórz listę</button><button class="btn" id="shClose">Anuluj</button></div>`);
  const sync = () => { d.querySelector("#nlFrom").value = st.from; d.querySelector("#nlTo").value = st.to;
    d.querySelector("#nlName").value = `Zakupy ${dLabel(st.from)}–${dLabel(st.to)}`;
    d.querySelector("#nlInfo").textContent = `${W.daysBetween(st.from, st.to) + 1} dni. Posiłki ugotowane przed pierwszym dniem („z wczoraj”) są pomijane.`; };
  sync();
  d.querySelectorAll("[data-pr]").forEach(b => b.onclick = () => { [st.from, st.to] = presets[b.dataset.pr]; sync(); });
  d.querySelector("#nlFrom").onchange = (e) => { st.from = e.target.value; if (st.to < st.from) st.to = st.from; sync(); };
  d.querySelector("#nlTo").onchange = (e) => { st.to = e.target.value; if (st.to < st.from) st.from = st.to; sync(); };
  d.querySelectorAll("[data-nls]").forEach(c => c.onchange = () => { st.slots = SLOTS.filter(sl => d.querySelector(`[data-nls="${sl}"]`).checked); });
  d.querySelectorAll("[data-nlp]").forEach(c => c.onchange = () => { st.people = profileList().map(([k]) => k).filter(k => d.querySelector(`[data-nlp="${k}"]`).checked); });
  d.querySelector("#nlDes").onchange = (e) => { st.desserts = e.target.checked; };
  d.querySelector("#shClose").onclick = closeSheet;
  d.querySelector("#nlGo").onclick = async () => {
    if (!st.slots.length && !st.desserts) return toast("Zaznacz co najmniej jeden posiłek", "err");
    if (!st.people.length) return toast("Zaznacz co najmniej jedną osobę", "err");
    if (W.daysBetween(st.from, st.to) > 20) return toast("Zakres najwyżej 3 tygodnie", "err");
    d.querySelector("#nlGo").disabled = true;
    const weeks = await weeksFor(st.from, st.to);
    const allP = st.people.length === profileList().length;
    const { need, missing } = SH.computeNeeds(weeks, S.recipes, { ...st, people: allP ? null : st.people, products: S.products });
    const items = SH.buildItems(need, S.products);
    if (!Object.keys(items).length) { d.querySelector("#nlGo").disabled = false; return toast(missing.length ? "Brak planu na wybrane dni – najpierw wygeneruj tydzień" : "Nic do kupienia w tym zakresie", "err"); }
    const id = be.newListId(); const now = new Date().toISOString();
    bg(be.createList(id, { name: d.querySelector("#nlName").value.trim() || "Zakupy", createdAt: now, createdBy: S.user.email, createdByName: S.user.name || S.user.email,
      range: { from: st.from, to: st.to }, slots: st.slots, people: allP ? null : st.people, desserts: st.desserts, status: "aktywna", recalcAt: now }, items));
    closeSheet(); location.hash = `#/zakupy/${id}`;
    if (missing.length) toast(`Bez planu: ${missing.map(x => DAY_NAMES[W.dayNum(x)] + " " + dLabel(x)).join(", ")} – te dni pominięto`, "err");
    else toast(`Lista utworzona: ${Object.keys(items).length} pozycji`, "ok");
  };
}

function itemRow(id, it) {
  const done = it.checked && !it.more;
  const src = (it.sources || []).map(x => `${x.date ? DAY_NAMES[W.dayNum(x.date)] + " " : ""}${SLOT_SHORT[x.slot] || x.slot}: ${esc(rName(x.recipeId))}`);
  return `<div class="sitem ${done ? "done" : ""} ${it.gone ? "gone" : ""}">
    <button class="ck" data-ck="${id}" aria-label="Kupione">${done ? "☑" : "☐"}</button>
    <div class="nm" data-src="${id}"><b>${esc(it.name)}</b> <span class="amt">${esc(it.amount || "")}</span>
      ${it.dessert ? `<span class="muted small"> · do: ${esc(it.dessert)}</span>` : ""}
      ${it.more ? `<span class="warntext small"> · dokup ~${fmt(Math.ceil(it.more / 5) * 5)} g (plan się zmienił)</span>` : ""}
      ${it.gone ? `<span class="muted small"> · już niepotrzebne (plan się zmienił)</span>` : ""}
      ${S.shop.open[id] && src.length ? `<div class="small muted src">${src.join("<br>")}</div>` : ""}
      ${done && it.checkedBy ? `<div class="small muted">${esc(String(it.checkedBy).split("@")[0])}</div>` : ""}</div>
    ${it.manual ? `<button class="ib" data-del="${id}" aria-label="Usuń">🗑</button>` : `<button class="ib" data-home="${id}" title="Mam w domu" aria-label="Mam w domu">🏠</button>`}</div>`;
}

function vShopList(m, id) {
  ensureLists(); ensureItems(id);
  const l = S.shop.lists?.[id]; const items = S.shop.items;
  if (S.shop.lists && !l) { m.innerHTML = `<a class="back" href="#/zakupy">← Listy</a><div class="card">Lista nie istnieje (mogła zostać usunięta).</div>`; return; }
  if (!l || items === undefined) { m.innerHTML = `<a class="back" href="#/zakupy">← Listy</a><div class="card muted">Wczytywanie…</div>`; return; }
  const all = Object.entries(items);
  const vis = Object.fromEntries(all.filter(([, it]) => !it.haveAtHome && (S.shop.showStaples || !it.staple) && (S.shop.showDone || !(it.checked && !it.more))));
  const home = all.filter(([, it]) => it.haveAtHome);
  const counted = all.filter(([, it]) => !it.haveAtHome && !it.staple && !it.gone);
  const done = counted.filter(([, it]) => it.checked && !it.more).length;
  const staples = all.filter(([, it]) => it.staple && !it.haveAtHome).length;
  const closed = l.status === "zamknieta";
  m.innerHTML = `<a class="back" href="#/zakupy">← Listy</a>
    <h2>${esc(l.name)}${closed ? ` <span class="badge">zamknięta</span>` : ""}</h2>
    <div class="muted small">${rangeTxt(l)} · ${slotsTxt(l)}</div>
    <div class="progress"><div style="width:${counted.length ? Math.round(done / counted.length * 100) : 0}%"></div></div>
    <div class="small">${done} / ${counted.length} kupione</div>
    <div class="row tight shopbar"><button class="btn primary" id="lsCopy">📋 Do Listonic</button>${l.range ? `<button class="btn" id="lsRecalc">🔄 Przelicz</button>` : ""}<button class="btn" id="lsMore">⋯</button></div>
    <form class="row tight addrow" id="lsAdd"><input id="lsTxt" placeholder="Dodaj pozycję, np. kawa" autocomplete="off"><input id="lsAmt" placeholder="ilość" style="width:5.5em">
      <select id="lsAisle">${AISLES.map(a => `<option ${a === "Inne" ? "selected" : ""}>${a}</option>`).join("")}</select><button class="btn">Dodaj</button></form>
    <div id="lsSug" class="chips"></div>
    <div class="row tight"><label class="chk"><input type="checkbox" id="lsDone" ${S.shop.showDone ? "checked" : ""}> pokaż kupione</label>
      ${staples ? `<label class="chk"><input type="checkbox" id="lsSt" ${S.shop.showStaples ? "checked" : ""}> pokaż „zawsze w domu” (${staples})</label>` : ""}</div>
    ${SH.groupByAisle(vis).map(g => `<div class="card aisle"><h3>${esc(g.aisle)}</h3>${g.items.map(it => itemRow(it.id, it)).join("")}</div>`).join("") || `<div class="card muted">Pusto. Dodaj pozycję powyżej.</div>`}
    ${home.length ? `<details class="card"><summary>Mam w domu (${home.length})</summary>${home.map(([iid, it]) => `<div class="sitem"><div class="nm"><b>${esc(it.name)}</b> <span class="amt">${esc(it.amount || "")}</span></div><button class="btn small" data-unhome="${iid}">przywróć</button></div>`).join("")}</details>` : ""}
    <p class="muted small">Dotknij nazwy, żeby zobaczyć, do czego jest potrzebny produkt.${l.recalcAt ? ` Przeliczono: ${new Date(l.recalcAt).toLocaleString("pl-PL")}.` : ""}</p>`;
  const now = () => new Date().toISOString();
  m.querySelectorAll("[data-ck]").forEach(b => b.onclick = () => {
    const it = items[b.dataset.ck]; const done2 = !(it.checked && !it.more);
    const patch = { checked: done2, checkedBy: done2 ? S.user.email : null, checkedAt: done2 ? now() : null, more: null };
    Object.assign(it, patch); rerenderShop(); bg(be.updateItem(id, b.dataset.ck, patch));
  });
  m.querySelectorAll("[data-src]").forEach(b => b.onclick = () => { S.shop.open[b.dataset.src] = !S.shop.open[b.dataset.src]; rerenderShop(); });
  m.querySelectorAll("[data-home]").forEach(b => b.onclick = () => { items[b.dataset.home].haveAtHome = true; rerenderShop(); bg(be.updateItem(id, b.dataset.home, { haveAtHome: true })); });
  m.querySelectorAll("[data-unhome]").forEach(b => b.onclick = () => { items[b.dataset.unhome].haveAtHome = false; rerenderShop(); bg(be.updateItem(id, b.dataset.unhome, { haveAtHome: false })); });
  m.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { delete items[b.dataset.del]; rerenderShop(); bg(be.deleteItem(id, b.dataset.del)); });
  $("#lsDone").onchange = (e) => { S.shop.showDone = e.target.checked; rerenderShop(); };
  if ($("#lsSt")) $("#lsSt").onchange = (e) => { S.shop.showStaples = e.target.checked; rerenderShop(); };
  $("#lsAdd").onsubmit = (e) => { e.preventDefault(); addManual({ name: $("#lsTxt").value, aisle: $("#lsAisle").value, amount: $("#lsAmt").value }); };
  $("#lsTxt").oninput = () => { // dział i ilość z pamięci, gdy nazwa pasuje dokładnie
    const n = $("#lsTxt").value; const a = SH.aisleFor(S.shop.memory, S.products, n); if (a) $("#lsAisle").value = a;
    const mm = S.shop.memory[SH.memKey(n)]; if (mm?.amount && !$("#lsAmt").value) $("#lsAmt").value = mm.amount;
    drawSug(); };
  $("#lsTxt").onfocus = drawSug;
  $("#lsCopy").onclick = () => openListonic(items);
  if ($("#lsRecalc")) $("#lsRecalc").onclick = () => recalcList(id, l, items);
  $("#lsMore").onclick = () => {
    const d = sheet(`<h3>${esc(l.name)}</h3><div class="acts">
      <button class="btn" data-a="rename">✏️ Zmień nazwę</button>
      <button class="btn" data-a="close">${closed ? "↩ Otwórz ponownie" : "✅ Zamknij listę (zakupy zrobione)"}</button>
      <button class="btn" data-a="uncheck">☐ Odznacz wszystko</button>
      <button class="btn danger" data-a="del">🗑 Usuń listę</button></div>
      <div class="row"><button class="btn" id="shClose">Anuluj</button></div>`);
    d.querySelector("#shClose").onclick = closeSheet;
    d.querySelector('[data-a="rename"]').onclick = () => { const n = prompt("Nazwa listy:", l.name); closeSheet(); if (n?.trim()) bg(be.updateList(id, { name: n.trim() })); };
    d.querySelector('[data-a="close"]').onclick = () => { closeSheet(); bg(be.updateList(id, { status: closed ? "aktywna" : "zamknieta" })); if (!closed) location.hash = "#/zakupy"; };
    d.querySelector('[data-a="uncheck"]').onclick = () => { closeSheet(); const ups = {};
      for (const [iid, it] of Object.entries(items)) if (it.checked) ups[iid] = { ...it, checked: false, checkedBy: null, checkedAt: null, more: null };
      bg(be.writeItems(id, ups, [])); };
    d.querySelector('[data-a="del"]').onclick = () => { if (!confirm(`Usunąć listę „${l.name}”? Tego nie da się cofnąć.`)) return;
      closeSheet(); location.hash = "#/zakupy"; bg(be.deleteList(id)); };
  };
}

async function recalcList(id, l, items) {
  const weeks = await weeksFor(l.range.from, l.range.to);
  const { need, missing } = SH.computeNeeds(weeks, S.recipes, { from: l.range.from, to: l.range.to, slots: l.slots || SLOTS, people: l.people || null, desserts: l.desserts !== false, products: S.products });
  const { upserts, deletes, stats } = SH.mergeItems(items, SH.buildItems(need, S.products));
  if (!Object.keys(upserts).length && !deletes.length) return toast("Lista jest aktualna", "ok");
  for (const dd of deletes) delete items[dd]; Object.assign(items, structuredClone(upserts)); rerenderShop();
  bg(be.writeItems(id, upserts, deletes, { recalcAt: new Date().toISOString() }));
  toast(`Przeliczono: +${stats.added} nowych, ${stats.changed} zmienionych, −${stats.removed} usuniętych${missing.length ? ` (bez planu: ${missing.length} dni)` : ""}`, "ok");
}

function openListonic(items) {
  const txt = SH.listonicText(items, { staples: S.shop.showStaples }); const n = txt ? txt.split("\n").length : 0;
  const d = sheet(`<h3>Kopiuj do Listonic</h3>
    <p class="small muted">${n} pozycji do kupienia (bez kupionych i „mam w domu”). W Listonic: wersja w przeglądarce (app.listonic.com) → lista → wklej – każda linia to osobny produkt.</p>
    <textarea id="lt" rows="12" style="width:100%" readonly>${esc(txt)}</textarea>
    <div class="row"><button class="btn primary" id="ltCopy">📋 Kopiuj</button><button class="btn" id="shClose">Zamknij</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  d.querySelector("#ltCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(txt); toast(`Skopiowano ${n} pozycji`, "ok"); closeSheet(); }
    catch { const t = d.querySelector("#lt"); t.focus(); t.select(); toast("Zaznaczono tekst – skopiuj ręcznie (przytrzymaj → Kopiuj)", "err"); }
  };
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
    <div class="card"><h3>Uwagi i pomysły</h3><p class="small muted">Coś nie działa albo masz pomysł? Zapisz – trafi do wspólnej listy w aplikacji.</p>
      <div class="row tight"><button class="btn primary" id="noteAdd">💬 Zgłoś uwagę</button><a class="btn" href="#/uwagi" id="noteList">Lista uwag${S.notes ? ` (${Object.values(S.notes).filter(n => n.status === "nowa").length} nowe)` : ""}</a></div></div>
    <div class="card"><h3>Profile rodziny</h3>
      <div class="profiles">${profileList().map(([id, p]) => `<div class="prof">${canEdit(id) ? `<a class="btn small edit" href="#/profil/${id}">Edytuj</a>` : ""}<div><b>${esc(p.name)}</b>${p.flags?.ironRich ? ` <span class="tag zelazo">Fe+</span>` : ""}${p.uid ? "" : ` <span class="muted small">(bez konta)</span>`} · ${p.kcalTarget} kcal</div>
        <div class="small">${slotsOf(p).map(s => `${SLOT_NAMES[s]} ${p.slots[s]}%`).join(" · ")}</div>
        ${(p.fixedExceptions || []).length ? `<div class="small muted">Poza domem: ${p.fixedExceptions.map(e => `${e.days.map(d => DAY_NAMES[d]).join(", ")} – ${e.slots.map(s => SLOT_NAMES[s]).join(", ")}`).join("; ")}</div>` : ""}
        ${(p.exclusions?.families || []).length ? `<div class="small muted">Wyklucza: ${p.exclusions.families.map(x => FAMILY_NAMES[x] || x).join(", ")}</div>` : ""}</div>`).join("")}</div></div>
    ${isAdmin() ? rulesHtml() + adminHtml() : ""}
    <div class="card muted small">Wersja aplikacji ${APP_VERSION} (${APP_STAGE}) · produkty ${S.config.versions?.products || "—"} · przepisy ${S.config.versions?.recipes || "—"}</div>`;
  $("#logout").onclick = () => be.signOut();
  $("#noteAdd").onclick = () => N.openNoteForm(notesApi(), null);
  N.ensureNotes(notesApi(), () => { const a = $("#noteList"); if (a && S.notes) a.textContent = `Lista uwag (${Object.values(S.notes).filter(n => n.status === "nowa").length} nowe)`; });
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
    <details class="card"><summary>Import danych</summary>
      <p class="muted small">Najpierw produkty, potem przepisy. Import dodaje nowe i aktualizuje zmienione – niczego nie usuwa. Przed importem zrób kopię.</p>
      <div class="row"><label class="btn">Wybierz plik produktów…<input type="file" accept=".json" id="fProd" hidden></label>
        <label class="btn">Wybierz plik przepisów…<input type="file" accept=".json" id="fRec" hidden></label></div>
      <div id="impOut"></div></details>
    <details class="card"><summary>Kopia zapasowa</summary><p class="muted small">Stan bazy: ${Object.keys(S.products).length} produktów, ${Object.keys(S.recipes).length} przepisów.
      Kopia zawiera ustawienia, profile (z wykluczeniami i preferencjami), produkty, przepisy, plany tygodni, listy zakupów, podpowiedzi i uwagi.</p>
      <div class="row"><button class="btn" id="export">Pobierz kopię (JSON)</button>
        <label class="btn">Przywróć z kopii…<input type="file" accept=".json" id="fRestore" hidden></label></div></details>`;
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
  $("#fRestore").onchange = (e) => readJson(e.target.files[0], openRestore);
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

async function exportBackup() {
  let weeks = {}, shopping = {}, notes = {};
  try { weeks = await be.listWeeks(); shopping = await be.dumpShopping(); notes = await be.listNotes(); }
  catch (e) { toast("Nie udało się pobrać planów/list: " + (e.code || e.message) + " – kopia bez nich", "err"); }
  const data = { kind: "kopia", schema: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    config: S.config, profiles: S.profiles, products: S.products, recipes: S.recipes, weeks, shopping, notes };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = `kopia-dieta-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Przywracanie z kopii: podsumowanie i wybór zakresu, potem zapis (administrator)
function openRestore(json) {
  if (json?.kind !== "kopia" || !json.config || !json.profiles) return toast("To nie jest plik kopii aplikacji", "err");
  const lists = Object.keys(json.shopping || {}).filter(k => !k.startsWith("_"));
  const mem = Object.keys(json.shopping?._pamiec?.items || {}).length;
  const meAdmin = json.config.invites?.[S.user.email]?.role === "admin";
  const parts = [
    ["cfg", "Ustawienia i profile", `zaproszenia, reguły tygodnia, ${Object.keys(json.profiles).length} profili${meAdmin ? "" : " – <b class='warntext'>niedostępne: w kopii nie jesteś administratorem</b>"}`, meAdmin],
    ["db", "Produkty i przepisy", `produkty: ${Object.keys(json.products || {}).length}, przepisy: ${Object.keys(json.recipes || {}).length} – zastąpią obecne (${Object.keys(S.products).length} / ${Object.keys(S.recipes).length})`, !!json.products],
    ["weeks", "Plany tygodni", `tygodnie: ${Object.keys(json.weeks || {}).length} – nadpiszą tygodnie o tych samych datach`, !!Object.keys(json.weeks || {}).length],
    ["notes", "Uwagi i pomysły", `uwagi: ${Object.keys(json.notes || {}).length} – nadpiszą uwagi o tych samych id`, !!Object.keys(json.notes || {}).length],
    ["shop", "Listy zakupów i podpowiedzi", `listy: ${lists.length}, podpowiedzi: ${mem} – nadpiszą listy o tych samych id`, !!(lists.length || mem)]];
  const d = sheet(`<h3>Przywróć z kopii</h3>
    <p class="small muted">Kopia z ${json.exportedAt ? new Date(json.exportedAt).toLocaleString("pl-PL") : "?"} (wersja aplikacji ${esc(json.appVersion || "?")}). Zaznacz, co przywrócić. Rzeczy spoza kopii (np. nowsze tygodnie) zostają.</p>
    ${parts.map(([k, n, info, on]) => `<label class="chk block"><input type="checkbox" data-rp="${k}" ${on ? "checked" : "disabled"}> <span><b>${n}</b><br><span class="small muted">${info}</span></span></label>`).join("")}
    <div class="row"><button class="btn primary" id="rsGo">Przywróć</button><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = closeSheet;
  d.querySelector("#rsGo").onclick = async () => {
    const sel = new Set([...d.querySelectorAll("[data-rp]:checked")].map(c => c.dataset.rp)); if (!sel.size) return toast("Nic nie zaznaczono", "err");
    if (!confirm("Przywrócić zaznaczone części? Obecne dane w tych częściach zostaną zastąpione.")) return;
    d.querySelector("#rsGo").disabled = true; d.querySelector("#rsGo").textContent = "Przywracanie…";
    try {
      if (sel.has("cfg")) { await be.setConfig(json.config); for (const [id, p] of Object.entries(json.profiles)) await be.setProfile(id, p); }
      if (sel.has("db")) for (const [coll, items, chunkOf] of [["products", json.products, (p) => productChunkOf(p.aisle)], ["recipes", json.recipes, (r) => recipeChunkOf(r.category)]]) {
        const chunks = {}; for (const cid of Object.keys(await be.getChunks(coll))) chunks[cid] = { items: {} };
        for (const [id, it] of Object.entries(items)) (chunks[chunkOf(it)] ||= { items: {} }).items[id] = it;
        for (const [cid, c] of Object.entries(chunks)) await be.setChunk(coll, cid, c);
      }
      if (sel.has("notes")) for (const [id, n] of Object.entries(json.notes)) await be.setNote(id, n);
      if (sel.has("weeks")) for (const [sat, w] of Object.entries(json.weeks)) await be.setWeek(sat, w);
      if (sel.has("shop")) {
        for (const id of lists) { const { _items, ...data } = json.shopping[id]; if (S.shop.lists?.[id]) await be.deleteList(id); await be.createList(id, data, _items || {}); }
        for (const [k, v] of Object.entries(json.shopping._pamiec?.items || {})) await be.rememberItem(k, v);
      }
      closeSheet(); toast("Przywrócono z kopii", "ok"); if (S.week.unsub) S.week.unsub(); S.week = { sat: null, data: undefined, unsub: null }; await boot();
    } catch (e) { toast("Błąd przywracania: " + (e.code || e.message), "err"); d.querySelector("#rsGo").disabled = false; d.querySelector("#rsGo").textContent = "Przywróć"; }
  };
}

// ---------- uruchomienie ----------
be.onAuth(async (u) => {
  S.user = u;
  if (!u) { S.config = null; if (S.notesUnsub) { S.notesUnsub(); S.notesUnsub = null; S.notes = undefined; } if (S.week.unsub) S.week.unsub(); S.week = { sat: null, data: undefined, unsub: null }; return renderLogin(); }
  screen(`<div class="center"><p class="muted">Wczytywanie…</p></div>`);
  await boot();
});

if ("serviceWorker" in navigator && !demo) navigator.serviceWorker.register("./sw.js").catch(() => {});
