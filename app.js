// app.js – Dieta dla Rodziny – v0.2.0 (M2: edycja profili, przepis w porcji osoby)
import { APP_VERSION, APP_STAGE } from "./version.js";
import { OWNER_EMAIL } from "./config.js";
import { defaultConfig, defaultProfiles, CATEGORY_NAMES, TAG_NAMES, FAMILY_NAMES, SLOT_NAMES, DAY_NAMES, productChunkOf, recipeChunkOf } from "./defaults.js";
import { validateProducts, validateRecipes, diffItems, mergeIntoChunks } from "./importer.js";
import { recipeTotals, recipeFamilies, formatAmount } from "./nutrition.js";
import { slotKcal, portionScale, defaultSlotFor, validateSlots } from "./scaling.js";
import { SLOTS } from "./defaults.js";

const demo = new URLSearchParams(location.search).has("demo");
const { createBackend } = await import(demo ? "./backend-demo.js" : "./backend-firebase.js");
const be = createBackend();

const S = { user: null, config: null, profiles: {}, products: {}, recipes: {}, invite: null, filters: { q: "", cat: "", tag: "", profile: "" }, portion: { profile: "", slot: "", base: false, recipe: "" } };
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAdmin = () => S.invite?.role === "admin";
const fmt = (n, d = 0) => Number(n).toLocaleString("pl-PL", { maximumFractionDigits: d, minimumFractionDigits: d });
const profileList = () => Object.entries(S.profiles).sort((a, b) => (a[1].order || 9) - (b[1].order || 9));

function toast(msg, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  box.appendChild(t); setTimeout(() => t.remove(), 3500);
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
}

// ---------- powłoka i nawigacja ----------
const NAV = [["dzis", "Dziś", "☀️"], ["tydzien", "Tydzień", "📅"], ["zakupy", "Zakupy", "🛒"], ["przepisy", "Przepisy", "📖"], ["wiecej", "Więcej", "☰"]];
function renderShell() {
  screen(`<nav class="nav">${NAV.map(([k, n, i]) => `<a href="#/${k}" data-k="${k}"><span>${i}</span>${n}</a>`).join("")}</nav>
    <main id="main"></main>${footer()}`);
}
addEventListener("hashchange", () => S.config && route());
function route() {
  const [, view, arg] = (location.hash || "#/przepisy").split("/");
  document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("on", a.dataset.k === ({ przepis: "przepisy", profil: "wiecej" }[view] || view)));
  const m = $("#main"); if (!m) return;
  ({ dzis: () => vSoon(m, "Dziś", "M3"), tydzien: () => vSoon(m, "Plan tygodnia", "M3"), zakupy: () => vSoon(m, "Lista zakupów", "M4"),
     przepisy: () => vRecipes(m), przepis: () => vRecipe(m, arg), profil: () => vProfile(m, arg), wiecej: () => vMore(m) }[view] || (() => vRecipes(m)))();
  window.scrollTo(0, 0);
}

function vSoon(m, title, stage) {
  m.innerHTML = `<h2>${title}</h2><div class="card muted">Ten ekran pojawi się w etapie ${stage}. Teraz (v${APP_VERSION}) działa logowanie, baza przepisów, zaproszenia oraz import i eksport.</div>`;
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

function vRecipe(m, id) {
  const r = S.recipes[id];
  if (!r) { m.innerHTML = `<div class="card">Nie znaleziono przepisu.</div>`; return; }
  const P = S.portion;
  if (P.recipe !== id) { P.recipe = id; P.slot = ""; }
  if (!P.profile || !S.profiles[P.profile]) P.profile = S.invite.profileId || profileList()[0]?.[0];
  const prof = S.profiles[P.profile];
  if (!P.slot || !prof?.slots?.[P.slot]) P.slot = defaultSlotFor(r.category, prof);
  const base = recipeTotals(r, S.products); const fam = recipeFamilies(r, S.products);
  const target = slotKcal(prof, P.slot);
  const lim = S.config.scaleLimits || { min: 0.5, max: 2.0 };
  const ps = P.base ? { scale: 1, raw: 1, ok: true } : portionScale(base.kcal, target, lim);
  const k = ps.scale; const t = Object.fromEntries(Object.entries(base).map(([a, v]) => [a, v * k]));
  const blocked = profileList().filter(([, p]) => (p.exclusions?.families || []).some(x => fam.includes(x)));
  const mine = (prof?.exclusions?.families || []).filter(x => fam.includes(x));
  m.innerHTML = `<a href="#/przepisy" class="back">← Przepisy</a>
    <h2>${esc(r.name)}</h2>
    <div class="meta">${CATEGORY_NAMES[r.category]}${r.timeMin ? ` · ${r.timeMin} min` : ""} · ${esc(r.source)} ${(r.tags || []).map(x => `<span class="tag ${x}">${TAG_NAMES[x] || x}</span>`).join("")}</div>
    <div class="card portion">
      <div class="row tight">
        <select id="pProf">${profileList().map(([pid, p]) => `<option value="${pid}" ${pid === P.profile ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <select id="pSlot">${Object.keys(prof?.slots || {}).map(sl => `<option value="${sl}" ${sl === P.slot ? "selected" : ""}>${SLOT_NAMES[sl]} · ${slotKcal(prof, sl)} kcal</option>`).join("")}</select>
        <label class="chk"><input type="checkbox" id="pBase" ${P.base ? "checked" : ""}> porcja bazowa</label>
      </div>
      <div class="small ${ps.ok ? "muted" : "warntext"}">${P.base ? `Porcja bazowa przepisu: ${fmt(base.kcal)} kcal.` :
        `Porcja dla: <b>${esc(prof?.name)}</b> · ${SLOT_NAMES[P.slot]} ${target} kcal · skala ×${fmt(k, 2)}${ps.ok ? "" : ` – poza zakresem ${fmt(lim.min, 1)}–${fmt(lim.max, 1)}: przepis słabo pasuje do tego posiłku`}`}</div>
    </div>
    ${mine.length ? `<div class="warn"><b>${esc(prof.name)}</b> wyklucza: ${mine.map(x => FAMILY_NAMES[x] || x).join(", ")} – ten przepis nie będzie proponowany tej osobie.</div>`
      : blocked.length ? `<div class="note">Zawiera: ${fam.map(x => FAMILY_NAMES[x] || x).join(", ")} – nie dla: ${blocked.map(([, p]) => esc(p.name)).join(", ")}</div>` : ""}
    <div class="stats"><div><b>${fmt(t.kcal)}</b>kcal</div><div><b>${fmt(t.p)}</b>białko g</div><div><b>${fmt(t.f)}</b>tłuszcz g</div><div><b>${fmt(t.c)}</b>węgl. g</div><div><b>${fmt(t.fe, 1)}</b>żelazo mg</div></div>
    <div class="card"><h3>Składniki</h3>
      <ul class="ing">${r.ingredients.map(x => { const p = S.products[x.p]; return `<li><span>${esc(p?.name || x.p)}</span><span>${esc(formatAmount(x, p, k))}</span></li>`; }).join("")}</ul></div>
    <div class="card"><h3>Przygotowanie</h3><p>${esc(r.steps)}</p></div>
    <p class="muted small">Porcja bazowa ${fmt(base.kcal)} kcal (wyliczone z gramatur; źródło podawało ${r.sourceKcal ?? "–"} kcal). Id: ${id}, wersja ${r.rev}.</p>`;
  $("#pProf").onchange = (e) => { P.profile = e.target.value; P.slot = ""; vRecipe(m, id); };
  $("#pSlot").onchange = (e) => { P.slot = e.target.value; vRecipe(m, id); };
  $("#pBase").onchange = (e) => { P.base = e.target.checked; vRecipe(m, id); };
}

// ---------- więcej: profil, rodzina, import ----------
function vMore(m) {
  const me = S.profiles[S.invite.profileId];
  m.innerHTML = `<h2>Więcej</h2>
    <div class="card"><h3>Zalogowano</h3><p>${esc(S.user.name)} · ${esc(S.user.email)}<br>Profil: <b>${esc(me?.name || "—")}</b> · rola: ${isAdmin() ? "administrator" : "domownik"}</p>
      <button class="btn" id="logout">Wyloguj</button></div>
    <div class="card"><h3>Profile rodziny</h3>
      <div class="profiles">${profileList().map(([id, p]) => `<div class="prof">${canEdit(id) ? `<a class="btn small edit" href="#/profil/${id}">Edytuj</a>` : ""}<div><b>${esc(p.name)}</b>${p.flags?.ironRich ? ` <span class="tag zelazo">Fe+</span>` : ""}${p.uid ? "" : ` <span class="muted small">(bez konta)</span>`} · ${p.kcalTarget} kcal</div>
        <div class="small">${Object.entries(p.slots).map(([s, v]) => `${SLOT_NAMES[s]} ${v}%`).join(" · ")}</div>
        ${(p.fixedExceptions || []).length ? `<div class="small muted">Poza domem: ${p.fixedExceptions.map(e => `${e.days.map(d => DAY_NAMES[d]).join(", ")} – ${e.slots.map(s => SLOT_NAMES[s]).join(", ")}`).join("; ")}</div>` : ""}
        ${(p.exclusions?.families || []).length ? `<div class="small muted">Wyklucza: ${p.exclusions.families.map(x => FAMILY_NAMES[x] || x).join(", ")}</div>` : ""}</div>`).join("")}</div></div>
    ${isAdmin() ? adminHtml() : ""}
    <div class="card muted small">Wersja aplikacji ${APP_VERSION} (${APP_STAGE}) · produkty ${S.config.versions?.products || "—"} · przepisy ${S.config.versions?.recipes || "—"}</div>`;
  $("#logout").onclick = () => be.signOut();
  if (isAdmin()) bindAdmin();
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
          <div class="small muted">Posiłki:</div><div class="row tight">${Object.keys(d.slots).map(sl => `<label class="chk"><input type="checkbox" data-eslot="${sl}"> ${SLOT_NAMES[sl]}</label>`).join("")}</div>
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
  if (!u) { S.config = null; return renderLogin(); }
  screen(`<div class="center"><p class="muted">Wczytywanie…</p></div>`);
  await boot();
});

if ("serviceWorker" in navigator && !demo) navigator.serviceWorker.register("./sw.js").catch(() => {});
