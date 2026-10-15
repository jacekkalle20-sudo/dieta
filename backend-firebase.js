// backend-firebase.js – v0.5.0 – dostęp do Firebase (Auth + Firestore)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, collection, onSnapshot, FieldPath, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export function createBackend() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const toUser = (u) => u ? { uid: u.uid, email: (u.email || "").toLowerCase(), name: u.displayName || u.email } : null;
  return {
    kind: "firebase",
    onAuth: (cb) => onAuthStateChanged(auth, (u) => cb(toUser(u))),
    signIn: () => signInWithPopup(auth, new GoogleAuthProvider()),
    signOut: () => fbSignOut(auth),
    async getConfig() { const s = await getDoc(doc(db, "config", "household")); return s.exists() ? s.data() : null; },
    setConfig: (data) => setDoc(doc(db, "config", "household"), data),
    async getProfiles() { const out = {}; (await getDocs(collection(db, "profiles"))).forEach(d => out[d.id] = d.data()); return out; },
    setProfile: (id, data) => setDoc(doc(db, "profiles", id), data),
    updateProfile: (id, patch) => updateDoc(doc(db, "profiles", id), patch),
    async getChunks(coll) { const out = {}; (await getDocs(collection(db, coll))).forEach(d => out[d.id] = d.data()); return out; },
    setChunk: (coll, id, data) => setDoc(doc(db, coll, id), data),
    // pojedynczy element w dokumencie zbiorczym (edytor przepisów i produktów)
    async setChunkItem(coll, chunk, id, data) {
      try { await updateDoc(doc(db, coll, chunk), new FieldPath("items", id), data); }
      catch (e) { if (e.code !== "not-found") throw e; await setDoc(doc(db, coll, chunk), { items: { [id]: data } }); }
    },
    deleteChunkItem: (coll, chunk, id) => updateDoc(doc(db, coll, chunk), new FieldPath("items", id), deleteField()),
    async listWeeks() { const out = {}; (await getDocs(collection(db, "weeks"))).forEach(d => out[d.id] = d.data()); return out; },
    async getWeek(sat) { const s = await getDoc(doc(db, "weeks", sat)); return s.exists() ? s.data() : null; },
    setWeek: (sat, data) => setDoc(doc(db, "weeks", sat), data),
    // zapis pojedynczych posiłków: [{date, slot, meal}]
    updateMeals(sat, items, meta = {}) {
      const args = [];
      for (const it of items) args.push(new FieldPath("days", it.date, it.slot), it.meal);
      for (const [k, v] of Object.entries(meta)) args.push(new FieldPath(k), v);
      return updateDoc(doc(db, "weeks", sat), ...args);
    },
    watchWeek(sat, cb, onErr) { return onSnapshot(doc(db, "weeks", sat), (s) => cb(s.exists() ? s.data() : null, s.metadata.hasPendingWrites), onErr); },

    // ---- listy zakupów: shopping/{listId} + shopping/{listId}/items/{itemId} ----
    // Zapisy nie czekają na serwer (offline): zwracają obietnicę potwierdzenia, a ekran odświeża się z pamięci lokalnej.
    watchLists(cb, onErr) { return onSnapshot(collection(db, "shopping"), (q) => { const out = {}; q.forEach(d => out[d.id] = d.data()); cb(out); }, onErr); },
    watchItems(listId, cb, onErr) { return onSnapshot(collection(db, "shopping", listId, "items"), (q) => { const out = {}; q.forEach(d => out[d.id] = d.data()); cb(out); }, onErr); },
    newListId: () => doc(collection(db, "shopping")).id,
    newItemId: (listId) => doc(collection(db, "shopping", listId, "items")).id,
    async createList(id, data, items) {
      const ref = doc(db, "shopping", id);
      const entries = Object.entries(items); const jobs = [];
      for (let i = 0; i < Math.max(1, entries.length); i += 400) {
        const b = writeBatch(db); if (i === 0) b.set(ref, data);
        for (const [iid, it] of entries.slice(i, i + 400)) b.set(doc(db, "shopping", id, "items", iid), it);
        jobs.push(b.commit());
      }
      return Promise.all(jobs);
    },
    updateList: (id, patch) => updateDoc(doc(db, "shopping", id), patch),
    setItem: (listId, itemId, item) => setDoc(doc(db, "shopping", listId, "items", itemId), item),
    updateItem: (listId, itemId, patch) => updateDoc(doc(db, "shopping", listId, "items", itemId), patch),
    deleteItem: (listId, itemId) => deleteDoc(doc(db, "shopping", listId, "items", itemId)),
    writeItems(listId, upserts, deletes, listPatch = null) {
      const ops = [...Object.entries(upserts).map(([id, it]) => ["set", id, it]), ...deletes.map(id => ["del", id])]; const jobs = [];
      for (let i = 0; i < Math.max(1, ops.length); i += 400) {
        const b = writeBatch(db); if (i === 0 && listPatch) b.update(doc(db, "shopping", listId), listPatch);
        for (const [op, id, it] of ops.slice(i, i + 400)) { const r = doc(db, "shopping", listId, "items", id); if (op === "set") b.set(r, it); else b.delete(r); }
        jobs.push(b.commit());
      }
      return Promise.all(jobs);
    },
    rememberItem: (key, entry) => setDoc(doc(db, "shopping", "_pamiec"), { items: { [key]: entry } }, { merge: true }),
    async dumpShopping() {
      const out = {}; const q = await getDocs(collection(db, "shopping"));
      for (const d of q.docs) { out[d.id] = { ...d.data() }; if (d.id.startsWith("_")) continue;
        const it = {}; (await getDocs(collection(db, "shopping", d.id, "items"))).forEach(x => it[x.id] = x.data()); out[d.id]._items = it; }
      return out;
    },
    async deleteList(id) {
      const q = await getDocs(collection(db, "shopping", id, "items")); const ids = []; q.forEach(d => ids.push(d.id));
      for (let i = 0; i < ids.length; i += 400) { const b = writeBatch(db); for (const x of ids.slice(i, i + 400)) b.delete(doc(db, "shopping", id, "items", x)); await b.commit(); }
      return deleteDoc(doc(db, "shopping", id));
    }
  };
}
