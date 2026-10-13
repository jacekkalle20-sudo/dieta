// backend-firebase.js – v0.1.0 – dostęp do Firebase (Auth + Firestore)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs,
  setDoc, updateDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../config.js";

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
    setChunk: (coll, id, data) => setDoc(doc(db, coll, id), data)
  };
}
