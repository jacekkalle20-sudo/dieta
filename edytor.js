// edytor.js – v0.5.0 – dodawanie i edycja przepisów oraz produktów w aplikacji (administratorzy)
import { CATEGORY_NAMES, TAG_NAMES, FAMILY_NAMES, AISLES, productChunkOf, recipeChunkOf } from "./defaults.js";
import { recipeTotals, recipeFamilies } from "./nutrition.js";

export const STATUS_NAMES = { aktywny: "aktywny", do_wyprobowania: "do wypróbowania (poza losowaniem)", do_uzupelnienia: "do uzupełnienia (poza losowaniem)", archiwum: "archiwum (ukryty)" };
export const UNIT_NAMES = { g: "g", ml: "ml", szt: "szt", lyzka: "łyżka", lyzeczka: "łyżeczka", plaster: "plaster", kromka: "kromka", garsc: "garść",
  szczypta: "szczypta", puszka: "puszka", zabek: "ząbek", lodyga: "łodyga", lisc: "liść", kostka: "kostka" };
const UNIT_FROM_TXT = { g: "g", ml: "ml", szt: "szt", sztuka: "szt", sztuki: "szt", "łyżka": "lyzka", "łyżki": "lyzka", "łyżeczka": "lyzeczka", "łyżeczki": "lyzeczka",
  plaster: "plaster", plastry: "plaster", kromka: "kromka", kromki: "kromka", "garść": "garsc", szczypta: "szczypta", puszka: "puszka", "ząbek": "zabek", "ząbki": "zabek",
  "łodyga": "lodyga", "łodygi": "lodyga", "liść": "lisc", "liście": "lisc", kostka: "kostka" };

// ---- czyste funkcje (testowane w Node) ----
export const unitsFor = (p) => ["g", ...(p?.density ? ["ml"] : []), ...Object.keys(p?.units || {})];
export function toGrams(p, qty, unit) {
  if (!(qty > 0)) return 0;
  if (unit === "g") return qty;
  if (unit === "ml") return qty * (p?.density || 1);
  return qty * (p?.units?.[unit] || 0);
}
export function ingredientTxt(qty, unit) { return `${String(Math.round(qty * 100) / 100).replace(".", ",")} ${UNIT_NAMES[unit] || unit}`; }
// Wiersz edytora z zapisanego składnika: odczyt ilości i jednostki z opisu („2 kromki”, „250 ml”), w razie wątpliwości gramy
export function rowFromIngredient(x, products) {
  const p = products[x.p];
  if (!x.g) return { p: x.p, qty: "", unit: "g" }; // „do smaku”
  const m = (x.txt || "").trim().match(/^(\d+(?:[.,]\d+)?)\s*([\p{L}]+)/u);
  if (m) { const qty = +m[1].replace(",", "."); const unit = UNIT_FROM_TXT[m[2].toLowerCase()];
    if (unit && unitsFor(p).includes(unit) && Math.abs(toGrams(p, qty, unit) - x.g) <= Math.max(1, x.g * 0.03)) return { p: x.p, qty, unit }; }
  return { p: x.p, qty: Math.round(x.g * 10) / 10, unit: "g" };
}
export function nextRecipeId(recipes) {
  const n = Math.max(0, ...Object.keys(recipes).map(k => +(k.match(/^r(\d+)$/)?.[1] || 0))); return "r" + String(n + 1).padStart(4, "0");
}
export function slugify(name, taken) {
  const base = name.toLowerCase().replace(/[ąćęłńóśźż]/g, c => "acelnoszz"["ąćęłńóśźż".indexOf(c)]).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "produkt";
  let id = base, i = 2; while (taken[id]) id = `${base}-${i++}`; return id;
}
// Przepis do zapisu z wersji roboczej; zwraca { recipe, errors }
export function buildRecipe(draft, products, old = null) {
  const errors = [];
  if (!draft.name.trim()) errors.push("Podaj nazwę przepisu.");
  if (!CATEGORY_NAMES[draft.category]) errors.push("Wybierz kategorię.");
  const ingredients = [];
  draft.rows.forEach((r, i) => {
    if (!r.p && !r.qty) return; // pusty wiersz
    if (!products[r.p]) { errors.push(`Składnik ${i + 1}: wybierz produkt z bazy (albo dodaj nowy).`); return; }
    const g = Math.round(toGrams(products[r.p], r.qty, r.unit) * 10) / 10;
    if (!(g > 0)) { if (r.qty === "" || r.qty === 0) ingredients.push({ p: r.p, g: 0, txt: "do smaku" }); else errors.push(`${products[r.p].name}: podaj ilość.`); return; }
    ingredients.push({ p: r.p, g, txt: ingredientTxt(r.qty, r.unit) });
  });
  if (!ingredients.length) errors.push("Dodaj co najmniej jeden składnik.");
  const recipe = { name: draft.name.trim(), category: draft.category, tags: [...draft.tags], ingredients, steps: draft.steps.trim(),
    timeMin: draft.timeMin > 0 ? Math.round(draft.timeMin) : null, source: draft.source.trim() || "Rodzina", calc: null,
    sourceKcal: old?.sourceKcal ?? null, status: draft.status || "aktywny", ratings: old?.ratings || {}, season: old?.season ?? null, rev: (old?.rev || 0) + 1 };
  if (ingredients.length) { const t = recipeTotals(recipe, products); recipe.calc = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10])); }
  return { recipe, errors };
}
export function buildProduct(d) {
  const errors = []; const num = (v) => Number(String(v ?? "").replace(",", "."));
  if (!d.name.trim()) errors.push("Podaj nazwę produktu.");
  const per100 = Object.fromEntries(["kcal", "p", "f", "c", "fe"].map(k => [k, num(d[k]) || 0]));
  if (!(num(d.kcal) >= 0) || d.kcal === "") errors.push("Podaj kcal na 100 g.");
  const units = {}; if (num(d.szt) > 0) units.szt = num(d.szt);
  const package_ = num(d.pkgQty) > 0 ? { qty: num(d.pkgQty), unit: d.pkgUnit, label: `opak. ${num(d.pkgQty)} ${d.pkgUnit}` } : null;
  if (package_?.unit === "szt" && !units.szt) errors.push("Opakowanie w sztukach wymaga wagi 1 sztuki.");
  return { product: { name: d.name.trim(), per100, density: d.liquid ? 1.0 : null, units, package: package_, aisle: d.aisle, subGroup: null,
    families: [...d.families], staple: !!d.staple, aliases: [d.name.trim().toLowerCase()] }, errors };
}

// ---- ekran edytora ----
// A = { S, be, $, esc, fmt, toast, sheet, closeSheet, profileList, W, refreshIndexes }
export function vEditRecipe(m, id, A) {
  const { S, esc, fmt } = A;
  const isNew = id === "nowy"; const old = isNew ? null : S.recipes[id];
  if (!isNew && !old) { m.innerHTML = `<div class="card">Nie znaleziono przepisu.</div>`; return; }
  if (!S.edit || S.edit.id !== id) S.edit = { id, d: old ? {
      name: old.name, category: old.category, tags: [...(old.tags || [])], steps: old.steps || "", timeMin: old.timeMin || "", source: old.source || "", status: old.status || "aktywny",
      rows: old.ingredients.map(x => rowFromIngredient(x, S.products)) }
    : { name: "", category: "obiad", tags: [], steps: "", timeMin: "", source: "Rodzina", status: "aktywny", rows: [{ p: "", qty: "", unit: "g" }] } };
  const D = S.edit.d; const P = S.products;
  const byName = {}; for (const [pid, p] of Object.entries(P)) byName[p.name.toLowerCase()] = pid;
  const draw = () => {
    const { recipe } = buildRecipe(D, P, old);
    const t = recipe.ingredients.length ? recipeTotals(recipe, P) : { kcal: 0, p: 0, f: 0, c: 0, fe: 0 };
    const fam = recipe.ingredients.length ? recipeFamilies(recipe, P) : [];
    const blocked = A.profileList().filter(([, p]) => (p.exclusions?.families || []).some(x => fam.includes(x)));
    m.innerHTML = `<a class="back" href="${isNew ? "#/przepisy" : `#/przepis/${id}`}">← ${isNew ? "Przepisy" : "Przepis"}</a>
      <h2>${isNew ? "Nowy przepis" : "Edycja przepisu"}</h2>
      <div class="card form">
        <label>Nazwa<input id="eName" value="${esc(D.name)}" placeholder="np. Gulasz z indykiem"></label>
        <div class="row tight"><label>Kategoria<select id="eCat">${Object.entries(CATEGORY_NAMES).map(([k, v]) => `<option value="${k}" ${D.category === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label>Czas (min)<input id="eTime" type="number" min="0" value="${esc(D.timeMin)}" style="width:6em"></label>
          <label>Status<select id="eStat">${Object.entries(STATUS_NAMES).map(([k, v]) => `<option value="${k}" ${D.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
        <div class="row tight">${Object.entries(TAG_NAMES).map(([k, v]) => `<label class="chk"><input type="checkbox" data-tag="${k}" ${D.tags.includes(k) ? "checked" : ""}> ${v}</label>`).join("")}</div>
        <label>Źródło<input id="eSrc" value="${esc(D.source)}"></label>
      </div>
      <div class="card"><h3>Składniki <span class="muted small">(na 1 porcję bazową)</span></h3>
        <datalist id="prodNames">${Object.values(P).map(p => `<option value="${esc(p.name)}">`).join("")}</datalist>
        ${D.rows.map((r, i) => { const p = P[r.p]; const g = p ? toGrams(p, +r.qty, r.unit) : 0;
          return `<div class="erow"><input list="prodNames" data-pn="${i}" value="${esc(p?.name || r.name || "")}" placeholder="produkt…" class="${r.name && !p ? "bad" : ""}">
            <input type="number" step="any" min="0" data-q="${i}" value="${esc(r.qty)}" placeholder="do smaku">
            <select data-u="${i}">${unitsFor(p).map(u => `<option value="${u}" ${r.unit === u ? "selected" : ""}>${UNIT_NAMES[u] || u}${u !== "g" && p?.units?.[u] ? ` (${p.units[u]} g)` : ""}</option>`).join("")}</select>
            <button class="ib" data-rm="${i}" aria-label="Usuń">✕</button>
            <div class="small muted einfo">${p ? `${fmt(g)} g · ${fmt(p.per100.kcal * g / 100)} kcal` : r.name ? `<span class="warntext">brak w bazie</span>` : ""}</div></div>`; }).join("")}
        <div class="row tight"><button class="btn small" id="eAdd">+ Składnik</button><button class="btn small" id="eNewProd">+ Nowy produkt do bazy</button></div>
      </div>
      <div class="stats"><div><b>${fmt(t.kcal)}</b>kcal</div><div><b>${fmt(t.p)}</b>białko g</div><div><b>${fmt(t.f)}</b>tłuszcz g</div><div><b>${fmt(t.c)}</b>węgl. g</div><div><b>${fmt(t.fe, 1)}</b>żelazo mg</div></div>
      ${blocked.length ? `<div class="note">Zawiera: ${fam.map(x => FAMILY_NAMES[x] || x).join(", ")} – nie będzie proponowany: ${blocked.map(([, p]) => esc(p.name)).join(", ")}</div>` : ""}
      <div class="card"><h3>Przygotowanie</h3><textarea id="eSteps" rows="6" style="width:100%">${esc(D.steps)}</textarea></div>
      <div class="row"><button class="btn primary" id="eSave">Zapisz przepis</button><a class="btn" href="${isNew ? "#/przepisy" : `#/przepis/${id}`}" id="eCancel">Anuluj</a>
        ${!isNew && D.status !== "archiwum" ? `<button class="btn danger" id="eArch">Do archiwum</button>` : ""}</div>
      <p class="muted small">Porcja bazowa = 1 osoba ok. ${fmt(t.kcal)} kcal; aplikacja i tak skaluje porcje do kcal każdej osoby. ${isNew ? "" : `Id: ${id}, zapis podniesie wersję do ${(old.rev || 0) + 1}.`}</p>`;
    bind();
  };
  const keepScroll = (fn) => { const y = scrollY; fn(); scrollTo(0, y); };
  const bind = () => {
    const $ = A.$;
    $("#eName").oninput = (e) => D.name = e.target.value;
    $("#eCat").onchange = (e) => D.category = e.target.value;
    $("#eTime").oninput = (e) => D.timeMin = e.target.value;
    $("#eStat").onchange = (e) => D.status = e.target.value;
    $("#eSrc").oninput = (e) => D.source = e.target.value;
    $("#eSteps").oninput = (e) => D.steps = e.target.value;
    m.querySelectorAll("[data-tag]").forEach(c => c.onchange = () => { D.tags = c.checked ? [...new Set([...D.tags, c.dataset.tag])] : D.tags.filter(x => x !== c.dataset.tag); });
    m.querySelectorAll("[data-pn]").forEach(inp => inp.onchange = () => { const r = D.rows[+inp.dataset.pn]; const pid = byName[inp.value.trim().toLowerCase()];
      r.p = pid || ""; r.name = inp.value.trim(); if (pid && !unitsFor(P[pid]).includes(r.unit)) r.unit = "g"; keepScroll(draw); });
    m.querySelectorAll("[data-q]").forEach(inp => inp.onchange = () => { D.rows[+inp.dataset.q].qty = inp.value === "" ? "" : +inp.value; keepScroll(draw); });
    m.querySelectorAll("[data-u]").forEach(sel => sel.onchange = () => { D.rows[+sel.dataset.u].unit = sel.value; keepScroll(draw); });
    m.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { D.rows.splice(+b.dataset.rm, 1); if (!D.rows.length) D.rows.push({ p: "", qty: "", unit: "g" }); keepScroll(draw); });
    $("#eAdd").onclick = () => { D.rows.push({ p: "", qty: "", unit: "g" }); keepScroll(draw); setTimeout(() => m.querySelector(`[data-pn="${D.rows.length - 1}"]`)?.focus(), 0); };
    $("#eNewProd").onclick = () => { const miss = D.rows.find(x => x.name && !x.p);
      openNewProduct(A, (pid) => { const r = miss || D.rows.find(x => !x.p) || (D.rows.push({ p: "", qty: "", unit: "g" }), D.rows[D.rows.length - 1]);
        r.p = pid; r.name = P[pid].name; byName[P[pid].name.toLowerCase()] = pid; keepScroll(draw); }, miss?.name || ""); };
    $("#eSave").onclick = async () => {
      const { recipe, errors } = buildRecipe(D, P, old);
      if (errors.length) return A.toast(errors[0], "err");
      const rid = isNew ? nextRecipeId(S.recipes) : id; $("#eSave").disabled = true;
      try {
        await A.be.setChunkItem("recipes", recipeChunkOf(recipe.category), rid, recipe);
        if (old && old.category !== recipe.category) await A.be.deleteChunkItem("recipes", recipeChunkOf(old.category), rid);
        S.recipes[rid] = recipe; A.refreshIndexes(); S.edit = null;
        A.toast(isNew ? "Przepis dodany" : "Przepis zapisany", "ok"); location.hash = `#/przepis/${rid}`;
      } catch (e) { A.toast("Błąd zapisu: " + (e.code || e.message), "err"); $("#eSave").disabled = false; }
    };
    if ($("#eArch")) $("#eArch").onclick = () => { if (!confirm("Przenieść przepis do archiwum? Nie będzie losowany ani widoczny na liście (zostaje w zaplanowanych tygodniach).")) return;
      D.status = "archiwum"; $("#eSave").click(); };
    $("#eCancel").onclick = () => { S.edit = null; };
  };
  draw();
}

export function openNewProduct(A, onDone, prefill = "") {
  const { S, esc } = A;
  const d = A.sheet(`<h3>Nowy produkt do bazy</h3>
    <label>Nazwa<input id="npName" placeholder="np. Komosa ryżowa" value="${esc(prefill)}"></label>
    <label>Dział sklepu<select id="npAisle">${AISLES.map(a => `<option>${a}</option>`).join("")}</select></label>
    <div class="small muted">Wartości na 100 g (z etykiety):</div>
    <div class="row tight npvals">${[["kcal", "kcal"], ["p", "białko g"], ["f", "tłuszcz g"], ["c", "węgl. g"], ["fe", "żelazo mg"]].map(([k, n]) =>
      `<label>${n}<input type="number" step="any" min="0" id="np_${k}" style="width:5.5em"></label>`).join("")}</div>
    <div class="row tight"><label>Waga 1 szt (g, opcj.)<input type="number" step="any" min="0" id="npSzt" style="width:6em"></label>
      <label>Opakowanie<input type="number" step="any" min="0" id="npPkg" style="width:6em" placeholder="np. 500"></label>
      <label>&nbsp;<select id="npPkgU"><option>g</option><option>ml</option><option>szt</option></select></label></div>
    <div class="row tight"><label class="chk"><input type="checkbox" id="npLiq"> płyn (ilość w ml)</label><label class="chk"><input type="checkbox" id="npStaple"> zawsze w domu (przyprawa)</label></div>
    <div class="small muted">Zawiera (do wykluczeń):</div>
    <div class="row tight">${Object.entries(FAMILY_NAMES).map(([f, n]) => `<label class="chk"><input type="checkbox" data-npf="${f}"> ${esc(n)}</label>`).join("")}</div>
    <div class="row"><button class="btn primary" id="npSave">Dodaj produkt</button><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = A.closeSheet;
  d.querySelector("#npSave").onclick = async () => {
    const v = (id) => d.querySelector(id).value;
    const { product, errors } = buildProduct({ name: v("#npName"), aisle: v("#npAisle"), kcal: v("#np_kcal"), p: v("#np_p"), f: v("#np_f"), c: v("#np_c"), fe: v("#np_fe"),
      szt: v("#npSzt"), pkgQty: v("#npPkg"), pkgUnit: v("#npPkgU"), liquid: d.querySelector("#npLiq").checked, staple: d.querySelector("#npStaple").checked,
      families: [...d.querySelectorAll("[data-npf]:checked")].map(c => c.dataset.npf) });
    if (errors.length) return A.toast(errors[0], "err");
    if (Object.values(S.products).some(p => p.name.toLowerCase() === product.name.toLowerCase())) return A.toast("Taki produkt już jest w bazie", "err");
    const pid = slugify(product.name, S.products); d.querySelector("#npSave").disabled = true;
    try { await A.be.setChunkItem("products", productChunkOf(product.aisle), pid, product); S.products[pid] = product; A.refreshIndexes();
      A.closeSheet(); A.toast(`Dodano produkt: ${product.name}`, "ok"); onDone(pid); }
    catch (e) { A.toast("Błąd zapisu: " + (e.code || e.message), "err"); d.querySelector("#npSave").disabled = false; }
  };
}
