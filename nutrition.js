// nutrition.js – v0.2.1 – wartości przepisu i formatowanie ilości
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
