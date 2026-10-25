// nutrition.js – v0.3.0 – wartości przepisu, formatowanie ilości, role składników (skaluj / stały / w sztukach) i zamiany
export function recipeTotals(recipe, products) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, fe: 0 };
  for (const x of recipe.ingredients) {
    const pr = products[x.p]; if (!pr) continue;
    for (const k of Object.keys(t)) t[k] += pr.per100[k] * x.g / 100;
  }
  return t;
}

export function recipeFamilies(recipe, products) {
  const s = new Set();
  for (const x of recipe.ingredients) for (const f of (products[x.p]?.families || [])) s.add(f);
  return [...s];
}

// Ilość do wyświetlenia (skala 1 = porcja bazowa)
export function formatAmount(x, product, scale = 1) {
  if (!x.g) return "do smaku";
  const g = x.g * scale;
  const ml = /\bml\b/.test(x.txt || "") && product?.density;
  if (ml) return `${Math.round(g / product.density / 10) * 10 || Math.round(g / product.density)} ml`;
  const unitTxt = (x.txt || "").match(/(?<![\p{L}])(sztuki|sztuka|sztuk|szt|kromka|kromki|ząbek|ząbki|łodygi|puszka)(?![\p{L}])/u);
  const grams = g >= 20 ? Math.round(g / 5) * 5 : Math.round(g);
  if (unitTxt && product?.units) {
    const key = { szt: "szt", sztuka: "szt", sztuki: "szt", sztuk: "szt", kromka: "kromka", kromki: "kromka", "ząbek": "zabek", "ząbki": "zabek", "łodygi": "lodyga", puszka: "puszka" }[unitTxt[1]];
    const w = product.units[key];
    if (w) { const n = Math.round(g / w * 2) / 2; return `${grams} g (${String(n).replace(".", ",")} ${key === "szt" ? "szt" : unitTxt[1]})`; }
  }
  return `${grams} g`;
}

// Liczba porcji z całości (desery): pole yield albo odczyt z opisu „Na całość (16 kawałków)”
export function yieldOf(recipe) {
  if (recipe?.yield > 0) return recipe.yield;
  const m = (recipe?.steps || "").match(/Na całość \((\d+)/i);
  return m ? +m[1] : null;
}

// ---------- role składników ----------
// x.r: "s" – skaluj (dopasowuje kcal), "c" – stały (zawsze tyle samo), "n" – w sztukach (zaokrąglany do całych / ½);
// brak x.r = rola automatyczna.
export const ROLE_NAMES = { s: "skaluj", c: "stały", n: "w sztukach" };
const PIECE_TXT = [[/(^|[^\p{L}])(szt|sztuk[ai]?)([^\p{L}]|$)/u, "szt"], [/kromk/u, "kromka"], [/plast/u, "plaster"], [/puszk/u, "puszka"]];
// Waga jednej sztuki dla składnika (null = nie liczy się w sztukach)
export function pieceWeight(x, p) {
  const t = (x.txt || "").toLowerCase();
  for (const [re, key] of PIECE_TXT) if (re.test(t) && p?.units?.[key]) return p.units[key];
  const pk = p?.package; // małe opakowanie zużywane w całości, np. kubek jogurtu 150 g
  if (pk && pk.unit === "g" && pk.qty <= 250 && x.g && Math.abs(x.g - pk.qty) / pk.qty <= 0.05) return pk.qty;
  if (x.r === "n") return p?.units?.szt || p?.units?.kromka || p?.units?.plaster || p?.units?.puszka || (pk?.unit === "g" && pk.qty <= 250 ? pk.qty : null);
  return null;
}
export function roleOf(x, p) {
  if (x.r) return x.r;
  if (!x.g || p?.staple || ["przyprawy", "ziola-swieze"].includes(p?.subGroup)) return "c";
  return pieceWeight(x, p) ? "n" : "s";
}
const kcalOfG = (p, g) => (p?.per100?.kcal || 0) * g / 100;

// Zamiany w posiłku: subs = { from: { to: productId | null (pominięty), f: mnożnik gramów } }
export function applySubs(ingredients, subs) {
  if (!subs) return ingredients.map(x => ({ ...x }));
  const out = [];
  for (const x of ingredients) {
    const s = subs[x.p];
    if (!s) { out.push({ ...x }); continue; }
    if (!s.to) continue; // pominięty
    out.push({ p: s.to, g: Math.round(x.g * (s.f || 1) * 10) / 10, txt: "", r: x.r === "c" || !x.g ? "c" : "s", subFrom: x.p });
  }
  return out;
}

// Ilości składników dla porcji o skali `scale` (cel kcal = kcal przepisu × skala).
// Stałe – bez zmian; w sztukach – zaokrąglone (½ dla sztuk ≥ 100 g); reszta kcal z „skaluj”.
// Zwraca [{p, g, txt, role, subFrom?}] – g to gramy dla tej porcji.
export function ingredientAmounts(recipe, scale, products, subs = null, { linear = false } = {}) {
  const ings = applySubs(recipe.ingredients, subs);
  const baseKcal = recipeTotals({ ingredients: ings }, products).kcal;
  if (linear || !baseKcal) return ings.map(x => ({ ...x, g: x.g * scale, role: "s" }));
  const target = baseKcal * scale;
  const rows = ings.map(x => { const p = products[x.p]; return { ...x, role: roleOf(x, p), w: pieceWeight(x, p), p0: p }; });
  let fixed = 0, sBase = 0;
  for (const r of rows) {
    if (r.role === "c") { fixed += kcalOfG(r.p0, r.g); r.out = r.g; }
    else if (r.role === "n" && r.w) { const step = r.w >= 100 ? 0.5 : 1; const n = Math.max(step, Math.round(r.g * scale / r.w / step) * step);
      r.out = n * r.w; fixed += kcalOfG(r.p0, r.out); }
    else { r.role = "s"; sBase += kcalOfG(r.p0, r.g); }
  }
  let ks = scale;
  if (sBase > 0) ks = Math.min(4, Math.max(0.25, (target - fixed) / sBase));
  return rows.map(({ p0, w, out, ...r }) => ({ ...r, g: r.role === "s" ? r.g * ks : out }));
}
// Suma kilku list ilości (np. porcje wszystkich osób przy stole)
export function sumAmounts(lists) {
  const by = new Map();
  for (const l of lists) for (const x of l) { const k = x.p + "|" + (x.txt || ""); const e = by.get(k); if (e) e.g += x.g; else by.set(k, { ...x }); }
  return [...by.values()];
}
export function amountsTotals(amounts, products) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, fe: 0 };
  for (const x of amounts) { const pr = products[x.p]; if (!pr) continue; for (const k of Object.keys(t)) t[k] += pr.per100[k] * x.g / 100; }
  return t;
}

// ---------- zamienniki ----------
// Produkty z tej samej grupy, posortowane wg podobieństwa profilu (udział kcal z białka/tłuszczu/węgl. + żelazo);
// g – ilość dająca te same kcal (mnożnik ograniczony do 0,3–3).
// Grupy pokrewne – zamienniki z nich pokazywane po produktach z tej samej grupy
export const RELATED_GROUPS = { mleko: ["napoje-roslinne", "napoje-mleczne"], "napoje-roslinne": ["mleko"], "napoje-mleczne": ["mleko", "jogurty"],
  jogurty: ["napoje-mleczne", "smietany"], smietany: ["jogurty"], "owoce-jagodowe": ["owoce-swieze"], "owoce-swieze": ["owoce-jagodowe", "cytrusy"],
  cytrusy: ["owoce-swieze"], kasze: ["ryz", "makarony"], ryz: ["kasze", "makarony"], makarony: ["kasze", "ryz"], platki: ["kasze"],
  drob: ["wieprzowina", "wolowina"], wieprzowina: ["drob", "wolowina"], wolowina: ["drob", "wieprzowina"], mielone: ["drob"],
  "ryby-biale": ["ryby-tluste"], "ryby-tluste": ["ryby-biale"], orzechy: ["nasiona"], nasiona: ["orzechy"], pieczywo: ["pieczywo-chrupkie"],
  "pieczywo-chrupkie": ["pieczywo"], straczki: ["straczki-suche"], "straczki-suche": ["straczki"], tofu: ["straczki"], twarogi: ["serki-kanapkowe"],
  "serki-kanapkowe": ["twarogi"], liscie: ["warzywa-salatkowe"], "warzywa-salatkowe": ["liscie"], skrobiowe: ["kasze"], oleje: ["tluszcze"], tluszcze: ["oleje"] };
export function substitutes(fromId, g, products, { exclude = new Set(), limit = 12 } = {}) {
  const a = products[fromId]; if (!a) return [];
  const prof = (p) => { const s = p.per100; const k = Math.max(1, 4 * s.p + 9 * s.f + 4 * s.c); return [4 * s.p / k, 9 * s.f / k, 4 * s.c / k, Math.min(1, s.fe / 10)]; };
  const pa = prof(a); const out = [];
  for (const [id, p] of Object.entries(products)) {
    const rel = !a.subGroup ? -1 : p.subGroup === a.subGroup ? 0 : (RELATED_GROUPS[a.subGroup] || []).includes(p.subGroup) ? 1 : -1;
    if (id === fromId || rel < 0 || p.staple) continue;
    if ((p.families || []).some(f => exclude.has(f))) continue;
    const pb = prof(p); const dist = pa.reduce((s, v, i) => s + (v - pb[i]) ** 2, 0) + Math.abs(Math.log(((p.per100.kcal || 1) / (a.per100.kcal || 1)))) * 0.05 + rel * 0.15;
    const f = a.per100.kcal > 0 && p.per100.kcal > 0 ? Math.min(3, Math.max(0.3, a.per100.kcal / p.per100.kcal)) : 1;
    out.push({ id, name: p.name, f, g: Math.round(g * f), kcal100: p.per100.kcal, fe100: p.per100.fe, dist, related: rel === 1 });
  }
  return out.sort((x, y) => x.dist - y.dist).slice(0, limit);
}
