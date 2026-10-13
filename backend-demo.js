// backend-demo.js – v0.1.2 – tryb pokazowy bez Firebase (adres z ?demo=1); dane tylko w pamięci przeglądarki
// Sprawdza ograniczenia Firestore (brak tablic w tablicach, brak undefined), żeby błędy wychodziły już w demo.
import { OWNER_EMAIL } from "./config.js";

export function createBackend() {
  const store = { config: null, profiles: {}, products: {}, recipes: {} };
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
    async setChunk(coll, id, d) { store[coll][id] = clone(d); }
  };
}
