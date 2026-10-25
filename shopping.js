// shopping.js – v0.7.1 – lista zakupów: sumowanie składników z planu, opakowania, działy, przeliczanie, tekst do Listonic
// Bez zależności od Firebase – testowane w Node.
import { SLOTS, AISLES } from "./defaults.js";
import { addDays, saturdayOf, participants, recipeOf, subsFor } from "./week.js";
import { yieldOf, ingredientAmounts } from "./nutrition.js";

// Soboty tygodni potrzebnych dla zakresu dat
export function saturdaysIn(from, to) {
  const out = []; for (let s = saturdayOf(from); s <= to; s = addDays(s, 7)) out.push(s); return out;
}

// Zapotrzebowanie: { productId: { g, sources: [{date, slot, recipeId}] } } + dni bez planu
// weeks = { sobota: dokument tygodnia | null }, opts = { from, to, slots, people (null = wszyscy), desserts }
// Desery z planu dnia (days[d].deser.items: [{rid, mult}]) liczone na całość: g × yield × mult, bez filtra osób.
export function computeNeeds(weeks, recipes, { from, to, slots = SLOTS, people = null, desserts = true, products = null }) {
  const need = {}; const missing = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = weeks[saturdayOf(d)]?.days?.[d];
    if (!day) { missing.push(d); continue; }
    for (const sl of SLOTS) {
      if (!slots.includes(sl)) continue;
      const m = day[sl]; if (!m) continue;
      for (const pid of participants(m)) {
        if (people && !people.includes(pid)) continue;
        const p = m.per[pid]; const rid = recipeOf(m, pid); const r = recipes[rid];
        if (!r || !p.scale) continue;
        // „z wczoraj”: składniki kupione razem z dniem gotowania; gdy gotowanie było przed zakresem – pomiń
        const lo = m.mode === "shared" ? (m.cook === false ? m.leftoverFrom : null) : (p.cook === false ? p.leftoverFrom : null);
        if (lo && lo < from) continue;
        // z bazą produktów: role składników i zamiany w posiłku; bez niej – proste mnożenie (testy, zgodność)
        const amounts = products ? ingredientAmounts(r, p.scale, products, subsFor(m, pid)) : r.ingredients.map(x => ({ ...x, g: x.g * p.scale }));
        for (const x of amounts) {
          if (!x.g) continue;
          const e = need[x.p] ||= { g: 0, sources: [] };
          e.g += x.g;
          if (!e.sources.some(s => s.date === d && s.slot === sl && s.recipeId === rid)) e.sources.push({ date: d, slot: sl, recipeId: rid });
        }
      }
    }
    if (desserts) for (const it of day.deser?.items || []) {
      const r = recipes[it.rid]; if (!r) continue;
      const k = (yieldOf(r) || 1) * (it.mult || 1);
      for (const x of r.ingredients) { if (!x.g) continue;
        const e = need[x.p] ||= { g: 0, sources: [] }; e.g += x.g * k;
        if (!e.sources.some(s => s.date === d && s.slot === "deser" && s.recipeId === it.rid)) e.sources.push({ date: d, slot: "deser", recipeId: it.rid }); }
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
    const q = it.packages ? `${it.packages.n} × ${it.packages.label}` : it.productId ? (it.amount || "").replace(/ \(~.*\)$/, "") : (it.amount || "");
    lines.push(`${it.name}${q ? " " + q : ""}`.trim());
  }
  return lines.join("\n");
}

// Pozycja ręczna
export function manualItem(text, aisle = "Inne", amount = "") {
  return { productId: null, name: text.trim(), aisle, staple: false, qtyG: null, amount: amount.trim(), packages: null, pieces: null,
    sources: [], manual: true, haveAtHome: false, checked: false, checkedBy: null, checkedAt: null };
}

// ---------- pamięć pozycji ręcznych (podpowiedzi) ----------
// Dokument shopping/_pamiec: { items: { klucz: {name, aisle, amount, n, last} } }
export const MEMORY_DOC = "_pamiec";
export const memKey = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");
export function rememberEntry(memory, item, now = new Date().toISOString()) {
  const old = memory?.[memKey(item.name)];
  return { name: item.name.trim(), aisle: item.aisle || "Inne", amount: item.amount || "", n: (old?.n || 0) + 1, last: now };
}
// Podpowiedzi: najpierw z pamięci (częściej dodawane wyżej), potem produkty z bazy
export function suggestions(memory, products, query, limit = 6) {
  const q = memKey(query || ""); const out = []; const seen = new Set();
  const mem = Object.values(memory || {}).sort((a, b) => (b.n || 0) - (a.n || 0) || (b.last || "").localeCompare(a.last || ""));
  for (const m of mem) if (!q || memKey(m.name).includes(q)) { out.push({ ...m, src: "mem" }); seen.add(memKey(m.name)); }
  if (q.length >= 2) for (const p of Object.values(products || {})) {
    const k = memKey(p.name); if (seen.has(k)) continue;
    if (k.startsWith(q) || (p.aliases || []).some(a => memKey(a).startsWith(q))) { out.push({ name: p.name, aisle: p.aisle, amount: "", src: "prod" }); seen.add(k); }
  }
  return out.slice(0, limit);
}
// Dział dla wpisanej nazwy (dokładne dopasowanie z pamięci lub bazy produktów)
export function aisleFor(memory, products, name) {
  const k = memKey(name); if (!k) return null;
  if (memory?.[k]) return memory[k].aisle;
  const p = Object.values(products || {}).find(p => memKey(p.name) === k || (p.aliases || []).some(a => memKey(a) === k));
  return p?.aisle || null;
}

// ---------- desery ----------
// Pozycje listy dla deseru (całość × mult); oznaczone jako ręczne – „Przelicz” ich nie rusza
export function dessertItems(recipe, rid, mult, products, tag) {
  const k = (yieldOf(recipe) || 1) * mult; const sum = {};
  for (const x of recipe.ingredients) if (x.g) sum[x.p] = (sum[x.p] || 0) + x.g * k;
  const out = {};
  for (const [pid, g] of Object.entries(sum)) {
    const pr = products[pid]; const a = buyAmount(pr, g);
    out[`d-${tag}-${pid}`] = { productId: pid, name: pr?.name || pid, aisle: pr?.aisle || "Inne", staple: !!pr?.staple, qtyG: Math.round(g * 10) / 10,
      amount: a.text, packages: a.packages, pieces: a.pieces, sources: [{ date: null, slot: "deser", recipeId: rid }], manual: true, dessert: recipe.name,
      haveAtHome: false, checked: false, checkedBy: null, checkedAt: null };
  }
  return out;
}

// ---------- części listy z planu (v0.7.1) ----------
// Lista może mieć kilka dodań z planu: parts = [{id, from, to, slots, people, desserts}]; starsze listy – pola range/slots/people/desserts
export function partsOf(list) {
  if (Array.isArray(list?.parts)) return list.parts;
  return list?.range ? [{ id: "p0", from: list.range.from, to: list.range.to, slots: list.slots || SLOTS, people: list.people || null, desserts: list.desserts !== false }] : [];
}
// Czy nowa część dubluje dni już dodane (te same dni i choć jeden wspólny posiłek i osoba) – wtedy składniki liczyłyby się dwa razy
export function partOverlap(parts, np) {
  return parts.find(p => p.from <= np.to && np.from <= p.to
    && ((p.slots || SLOTS).some(s => (np.slots || SLOTS).includes(s)) || (p.desserts !== false && np.desserts !== false))
    && (!p.people || !np.people || p.people.some(x => np.people.includes(x)))) || null;
}
// Zapotrzebowanie ze wszystkich części (sumowane), dni bez planu – suma
export function needsForParts(weeks, recipes, parts, products) {
  const need = {}; const missing = new Set();
  for (const pt of parts) {
    const r = computeNeeds(weeks, recipes, { from: pt.from, to: pt.to, slots: pt.slots || SLOTS, people: pt.people || null, desserts: pt.desserts !== false, products });
    for (const d of r.missing) missing.add(d);
    for (const [pid, e] of Object.entries(r.need)) { const t = need[pid] ||= { g: 0, sources: [] }; t.g += e.g;
      for (const s of e.sources) if (!t.sources.some(x => x.date === s.date && x.slot === s.slot && x.recipeId === s.recipeId)) t.sources.push(s); }
  }
  return { need, missing: [...missing].sort() };
}
