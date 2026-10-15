// backend-demo.js – v0.5.0 – tryb pokazowy bez Firebase (adres z ?demo=1); dane tylko w pamięci przeglądarki
// Sprawdza ograniczenia Firestore (brak tablic w tablicach, brak undefined), żeby błędy wychodziły już w demo.
import { OWNER_EMAIL } from "./config.js";

export function createBackend() {
  const store = { config: null, profiles: {}, products: {}, recipes: {}, weeks: {}, shopping: {}, items: {} };
  const lw = []; const iw = {}; let seq = 0;
  const nLists = () => lw.forEach(cb => setTimeout(() => cb(clone(store.shopping)), 0));
  const nItems = (id) => (iw[id] || []).forEach(cb => setTimeout(() => cb(clone(store.items[id] || {})), 0));
  const watchers = {};
  const notify = (sat) => (watchers[sat] || []).forEach(cb => setTimeout(() => cb(store.weeks[sat] ? clone(store.weeks[sat]) : null, false), 0));
  let authCb = () => {};
  let user = null;
  const check = (x, inArr = false, path = "") => {
    if (x === undefined) throw Object.assign(new Error("undefined w " + path), { code: "invalid-argument" });
    if (Array.isArray(x)) { if (inArr) throw Object.assign(new Error("tablica w tablicy: " + path), { code: "invalid-argument" }); x.forEach((v, i) => check(v, true, path + "[" + i + "]")); }
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) check(v, false, path + "." + k);
  };
  const clone = (x) => { check(x); return JSON.parse(JSON.stringify(x)); };
  return {
    kind: "demo",
    onAuth(cb) { authCb = cb; setTimeout(() => cb(user), 0); },
    async signIn() { user = { uid: "demo-jacek", email: OWNER_EMAIL.toLowerCase(), name: "Jacek (demo)" }; authCb(user); },
    async signOut() { user = null; authCb(null); },
    async getConfig() { return store.config ? clone(store.config) : null; },
    async setConfig(d) { store.config = clone(d); },
    async getProfiles() { return clone(store.profiles); },
    async setProfile(id, d) { store.profiles[id] = clone(d); },
    async updateProfile(id, p) { Object.assign(store.profiles[id], clone(p)); },
    async getChunks(coll) { return clone(store[coll]); },
    async setChunk(coll, id, d) { store[coll][id] = clone(d); },
    async setChunkItem(coll, chunk, id, d) { (store[coll][chunk] ||= { items: {} }).items[id] = clone(d); },
    async deleteChunkItem(coll, chunk, id) { delete store[coll][chunk]?.items?.[id]; },
    async listWeeks() { return clone(store.weeks); },
    async getWeek(sat) { return store.weeks[sat] ? clone(store.weeks[sat]) : null; },
    async setWeek(sat, d) { store.weeks[sat] = clone(d); notify(sat); },
    async updateMeals(sat, items, meta = {}) {
      const w = store.weeks[sat]; if (!w) throw Object.assign(new Error("brak tygodnia"), { code: "not-found" });
      for (const it of items) { w.days[it.date] ||= {}; w.days[it.date][it.slot] = clone(it.meal); }
      Object.assign(w, clone(meta)); notify(sat);
    },
    watchWeek(sat, cb) { (watchers[sat] ||= []).push(cb); setTimeout(() => cb(store.weeks[sat] ? clone(store.weeks[sat]) : null, false), 0);
      return () => { watchers[sat] = watchers[sat].filter(x => x !== cb); }; },
    // listy zakupów
    watchLists(cb) { lw.push(cb); setTimeout(() => cb(clone(store.shopping)), 0); return () => lw.splice(lw.indexOf(cb), 1); },
    watchItems(id, cb) { (iw[id] ||= []).push(cb); setTimeout(() => cb(clone(store.items[id] || {})), 0); return () => { iw[id] = iw[id].filter(x => x !== cb); }; },
    newListId: () => "L" + (++seq) + Date.now().toString(36),
    newItemId: () => "i" + (++seq) + Date.now().toString(36),
    async createList(id, data, items) { store.shopping[id] = clone(data); store.items[id] = clone(items); nLists(); nItems(id); },
    async updateList(id, patch) { Object.assign(store.shopping[id], clone(patch)); nLists(); },
    async setItem(l, i, it) { (store.items[l] ||= {})[i] = clone(it); nItems(l); },
    async updateItem(l, i, patch) { if (!store.items[l]?.[i]) throw Object.assign(new Error("brak pozycji"), { code: "not-found" }); Object.assign(store.items[l][i], clone(patch)); nItems(l); },
    async deleteItem(l, i) { delete store.items[l]?.[i]; nItems(l); },
    async writeItems(l, ups, dels, listPatch = null) { const it = store.items[l] ||= {}; for (const [i, x] of Object.entries(ups)) it[i] = clone(x); for (const i of dels) delete it[i];
      if (listPatch) { Object.assign(store.shopping[l], clone(listPatch)); nLists(); } nItems(l); },
    async rememberItem(key, entry) { const m = store.shopping._pamiec ||= { items: {} }; m.items[key] = clone(entry); nLists(); },
    async dumpShopping() { const out = clone(store.shopping); for (const id of Object.keys(out)) if (!id.startsWith("_")) out[id]._items = clone(store.items[id] || {}); return out; },
    async deleteList(id) { delete store.shopping[id]; delete store.items[id]; nLists(); nItems(id); }
  };
}
