// shopping.js – v0.4.0 – lista zakupów: sumowanie składników z planu, opakowania, działy, przeliczanie, tekst do Listonic
// Bez zależności od Firebase – testowane w Node.
import { SLOTS, AISLES } from "./defaults.js";
import { addDays, saturdayOf, participants, recipeOf } from "./week.js";

// Soboty tygodni potrzebnych dla zakresu dat
export function saturdaysIn(from, to) {
  const out = []; for (let s = saturdayOf(from); s <= to; s = addDays(s, 7)) out.push(s); return out;
}

// Zapotrzebowanie: { productId: { g, sources: [{date, slot, recipeId}] } } + dni bez planu
// weeks = { sobota: dokument tygodnia | null }, opts = { from, to, slots }
export function computeNeeds(weeks, recipes, { from, to, slots = SLOTS }) {
  const need = {}; const missing = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = weeks[saturdayOf(d)]?.days?.[d];
    if (!day) { missing.push(d); continue; }
    for (const sl of SLOTS) {
      if (!slots.includes(sl)) continue;
      const m = day[sl]; if (!m) continue;
      for (const pid of participants(m)) {
        const p = m.per[pid]; const rid = recipeOf(m, pid); const r = recipes[rid];
        if (!r || !p.scale) continue;
        // „z wczoraj”: składniki kupione razem z dniem gotowania; gdy gotowanie było przed zakresem – pomiń
        const lo = m.mode === "shared" ? (m.cook === false ? m.leftoverFrom : null) : (p.cook === false ? p.leftoverFrom : null);
        if (lo && lo < from) continue;
        for (const x of r.ingredients) {
          if (!x.g) continue;
          const e = need[x.p] ||= { g: 0, sources: [] };
          e.g += x.g * p.scale;
          if (!e.sources.some(s => s.date === d && s.slot === sl && s.recipeId === rid)) e.sources.push({ date: d, slot: sl, recipeId: rid });
        }
      }
    }
  }
  return { need, missing };
}

// Gramy jednego opakowania (null = brak opakowania standardowego)
export function packageGrams(product) {
  const pk = product?.package; if (!pk || !pk.qty) return null;
  if (pk.unit === "g") return pk.qty;
  if (pk.unit === "ml") return pk.qty * (product.density || 1);
  if (pk.unit === "szt") return product.units?.szt ? pk.qty * product.units.szt : null;
  return null;
}
const roundG = (g) => g >= 100 ? Math.ceil(g / 10) * 10 : g >= 20 ? Math.ceil(g / 5) * 5 : Math.max(1, Math.ceil(g));
const fmtNum = (n) => String(n).replace(".", ",");

// Ilość do kupienia: { packages: {n, label} | null, pieces: n | null, text }
export function buyAmount(product, g) {
  const pg = packageGrams(product);
  const gTxt = product?.density && product?.package?.unit === "ml" ? `${roundG(g / product.density)} ml` : `${roundG(g)} g`;
  if (pg) {
    const n = Math.max(1, Math.ceil(g / pg - 0.05)); // 5% tolerancji – 152 g jogurtu to nadal 1 kubek
    return { packages: { n, label: product.package.label }, pieces: null, text: `${n} × ${product.package.label} (${gTxt})` };
  }
  const szt = product?.units?.szt;
  if (szt) {
    const n = Math.max(0.5, Math.ceil(g / szt * 2 - 0.2) / 2); // w górę do pół sztuki
    return { packages: null, pieces: n, text: `${fmtNum(n)} szt (~${roundG(g)} g)` };
  }
  return { packages: null, pieces: null, text: gTxt };
}

// Pozycje listy wyliczone z zapotrzebowania (klucz = id produktu)
export function buildItems(need, products) {
  const out = {};
  for (const [pid, e] of Object.entries(need)) {
    const pr = products[pid]; const a = buyAmount(pr, e.g);
    out[pid] = { productId: pid, name: pr?.name || pid, aisle: pr?.aisle || "Inne", staple: !!pr?.staple,
      qtyG: Math.round(e.g * 10) / 10, amount: a.text, packages: a.packages, pieces: a.pieces,
      sources: [...e.sources].sort((x, y) => (x.date + SLOTS.indexOf(x.slot)).localeCompare(y.date + SLOTS.indexOf(y.slot))),
      manual: false, haveAtHome: false, checked: false, checkedBy: null, checkedAt: null };
  }
  return out;
}

// Przeliczenie istniejącej listy: zachowuje odhaczenia, „mam w domu” i pozycje ręczne
// Zwraca { upserts: {id: item}, deletes: [id], stats: {added, changed, removed} }
export function mergeItems(existing, fresh) {
  const upserts = {}; const deletes = []; const stats = { added: 0, changed: 0, removed: 0 };
  for (const [id, f] of Object.entries(fresh)) {
    const e = existing[id];
    if (!e || e.manual) { upserts[id] = f; stats.added++; continue; }
    const same = Math.abs((e.qtyG || 0) - f.qtyG) < 0.5 && !e.gone && JSON.stringify(e.sources) === JSON.stringify(f.sources);
    if (same) continue;
    const more = e.checked && f.qtyG > (e.qtyG || 0) + 0.5;
    upserts[id] = { ...f, haveAtHome: !!e.haveAtHome, checked: !!e.checked, checkedBy: e.checkedBy || null, checkedAt: e.checkedAt || null,
      more: more ? Math.round((f.qtyG - (e.qtyG || 0)) * 10) / 10 : (e.more && e.checked ? e.more : null), gone: false };
    stats.changed++;
  }
  for (const [id, e] of Object.entries(existing)) {
    if (e.manual || fresh[id]) continue;
    if (e.checked) { if (!e.gone) { upserts[id] = { ...e, gone: true, more: null }; stats.changed++; } }
    else { deletes.push(id); stats.removed++; }
  }
  return { upserts, deletes, stats };
}

// Pozycje do wyświetlenia pogrupowane wg działów sklepu
export function groupByAisle(items) {
  const groups = AISLES.map(a => ({ aisle: a, items: [] }));
  const other = groups[groups.length - 1];
  for (const [id, it] of Object.entries(items)) (groups.find(g => g.aisle === it.aisle) || other).items.push({ id, ...it });
  for (const g of groups) g.items.sort((a, b) => (a.checked - b.checked) || a.name.localeCompare(b.name, "pl"));
  return groups.filter(g => g.items.length);
}

// Tekst do wklejenia w Listonic: jedna pozycja w linii, ilość po nazwie, bez punktorów
export function listonicText(items, { staples = false } = {}) {
  const lines = [];
  for (const g of groupByAisle(items)) for (const it of g.items) {
    if (it.haveAtHome || it.gone || (it.staple && !staples)) continue;
    if (it.checked && it.more) { lines.push(`${it.name} ~${roundG(it.more)} g`); continue; } // dokupić po zmianie planu
    if (it.checked) continue;
    const q = it.manual ? (it.amount || "") : it.packages ? `${it.packages.n} × ${it.packages.label}` : it.amount.replace(/ \(~.*\)$/, "");
    lines.push(`${it.name}${q ? " " + q : ""}`.trim());
  }
  return lines.join("\n");
}

// Pozycja ręczna
export function manualItem(text, aisle = "Inne", amount = "") {
  return { productId: null, name: text.trim(), aisle, staple: false, qtyG: null, amount: amount.trim(), packages: null, pieces: null,
    sources: [], manual: true, haveAtHome: false, checked: false, checkedBy: null, checkedAt: null };
}
