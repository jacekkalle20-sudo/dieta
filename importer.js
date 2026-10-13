// importer.js – v0.1.0 – walidacja i porównanie plików importu (bez zależności od Firebase – testowalne)
const NUM = (x) => typeof x === "number" && isFinite(x);
const CATS = ["sniadanie", "ii_sniadanie", "przekaska", "obiad", "kolacja", "deser"];

export function validateProducts(json) {
  const errors = [];
  if (!json || json.kind !== "produkty") errors.push("To nie jest plik produktów (pole kind ≠ \"produkty\").");
  if (json && json.schema !== 1) errors.push(`Nieobsługiwana wersja schematu: ${json && json.schema}.`);
  const items = (json && json.items) || {};
  for (const [id, p] of Object.entries(items)) {
    if (!p.name) errors.push(`${id}: brak nazwy`);
    if (!p.per100 || !["kcal", "p", "f", "c", "fe"].every(k => NUM(p.per100[k]))) errors.push(`${id}: niepełne wartości na 100 g`);
    if (!p.aisle) errors.push(`${id}: brak działu`);
    if (p.units && Object.values(p.units).some(v => !NUM(v) || v <= 0)) errors.push(`${id}: błędna waga jednostki`);
  }
  if (!Object.keys(items).length) errors.push("Plik nie zawiera produktów.");
  return { ok: errors.length === 0, errors, count: Object.keys(items).length };
}

export function validateRecipes(json, productIds) {
  const errors = [];
  if (!json || json.kind !== "przepisy") errors.push("To nie jest plik przepisów (pole kind ≠ \"przepisy\").");
  if (json && json.schema !== 1) errors.push(`Nieobsługiwana wersja schematu: ${json && json.schema}.`);
  const items = (json && json.items) || {};
  const known = new Set(productIds);
  for (const [id, r] of Object.entries(items)) {
    if (!r.name) errors.push(`${id}: brak nazwy`);
    if (!CATS.includes(r.category)) errors.push(`${id}: nieznana kategoria ${r.category}`);
    if (!Array.isArray(r.ingredients) || !r.ingredients.length) errors.push(`${id}: brak składników`);
    for (const x of r.ingredients || []) {
      if (!known.has(x.p)) errors.push(`${id} (${r.name}): nieznany produkt „${x.p}” – zaimportuj najpierw produkty`);
      if (!NUM(x.g) || x.g < 0) errors.push(`${id}: błędna gramatura ${x.p}`);
    }
    if (!NUM(r.rev)) errors.push(`${id}: brak numeru wersji (rev)`);
  }
  if (!Object.keys(items).length) errors.push("Plik nie zawiera przepisów.");
  return { ok: errors.length === 0, errors: errors.slice(0, 50), errorCount: errors.length, count: Object.keys(items).length };
}

// Porównanie: nowe / zmienione / bez zmian (przepisy wg rev, produkty wg treści)
export function diffItems(existing, incoming, useRev) {
  const res = { added: [], changed: [], same: [] };
  for (const [id, item] of Object.entries(incoming)) {
    const old = existing[id];
    if (!old) res.added.push(id);
    else if (useRev ? (item.rev || 0) > (old.rev || 0) : JSON.stringify(old) !== JSON.stringify(item)) res.changed.push(id);
    else res.same.push(id);
  }
  return res;
}

// Podział elementów na dokumenty zbiorcze z zachowaniem istniejących (nic nie jest usuwane)
export function mergeIntoChunks(existingChunks, incoming, ids, chunkOf) {
  const out = {};
  for (const [cid, c] of Object.entries(existingChunks)) out[cid] = { items: { ...(c.items || {}) } };
  for (const id of ids) {
    const item = incoming[id];
    const cid = chunkOf(item);
    for (const c of Object.values(out)) if (c.items[id] && chunkOf(c.items[id]) !== cid) delete c.items[id];
    (out[cid] ||= { items: {} }).items[id] = item;
  }
  return out;
}
