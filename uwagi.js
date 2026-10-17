// uwagi.js – v0.6.0 – „Zgłoś uwagę”: uwagi i pomysły domowników zapisywane w aplikacji (kolekcja uwagi)
export const KINDS = { blad: "🐞 błąd", pomysl: "💡 pomysł", przepis: "🍲 przepis", inne: "💬 inne" };
export const STATUSES = { nowa: "nowa", przyjeta: "przyjęta", zrobiona: "zrobiona", odrzucona: "odrzucona" };
const OPEN = ["nowa", "przyjeta"];

// ---- czyste funkcje (testowane w Node) ----
export function newNote({ text, kind, email, name, profileId, context = null, now = new Date().toISOString() }) {
  return { text: text.trim(), kind: KINDS[kind] ? kind : "inne", by: email, byName: name || email, profileId: profileId || null,
    at: now, status: "nowa", answer: "", context };
}
export function sortNotes(notes) {
  return Object.entries(notes).sort((a, b) => (OPEN.includes(b[1].status) - OPEN.includes(a[1].status)) || (b[1].at || "").localeCompare(a[1].at || ""));
}
// Tekst do wklejenia Claude: otwarte uwagi (nowe i przyjęte), od najstarszej
export function notesText(notes, statuses = OPEN) {
  const list = Object.values(notes).filter(n => statuses.includes(n.status)).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  return list.map((n, i) => `${i + 1}. [${(KINDS[n.kind] || n.kind).replace(/^\S+ /, "")}${n.status === "przyjeta" ? ", przyjęta" : ""}] ${n.text}`
    + `${n.context?.label ? ` (dotyczy: ${n.context.label})` : ""} – ${n.byName || n.by}, ${(n.at || "").slice(0, 10)}`).join("\n");
}

// ---- ekrany ----
// A = { S, be, $, esc, toast, sheet, closeSheet, isAdmin }
export function ensureNotes(A, onChange) {
  const { S } = A; if (S.notesUnsub) return;
  S.notesUnsub = A.be.watchNotes((d) => { S.notes = d; onChange(); }, (e) => A.toast("Błąd synchronizacji uwag: " + (e.code || e.message), "err"));
}
export function openNoteForm(A, context = null) {
  const { S, esc } = A;
  const d = A.sheet(`<h3>💬 Zgłoś uwagę</h3>
    ${context?.label ? `<p class="small muted">Dotyczy: ${esc(context.label)}</p>` : ""}
    <div class="row tight">${Object.entries(KINDS).map(([k, n], i) => `<label class="chk"><input type="radio" name="nk" value="${k}" ${i === (context ? 2 : 1) ? "checked" : ""}> ${n}</label>`).join("")}</div>
    <textarea id="nText" rows="5" style="width:100%" placeholder="Co nie działa, co poprawić, jaki pomysł…"></textarea>
    <p class="small muted">Uwaga trafi do listy w aplikacji (Więcej → Uwagi). Jacek i Agata zobaczą ją i oznaczą status.</p>
    <div class="row"><button class="btn primary" id="nSave">Zapisz uwagę</button><button class="btn" id="shClose">Anuluj</button></div>`);
  d.querySelector("#shClose").onclick = A.closeSheet;
  setTimeout(() => d.querySelector("#nText").focus(), 50);
  d.querySelector("#nSave").onclick = () => {
    const text = d.querySelector("#nText").value; if (!text.trim()) return A.toast("Wpisz treść uwagi", "err");
    const n = newNote({ text, kind: d.querySelector("[name=nk]:checked").value, email: S.user.email, name: S.profiles[S.invite.profileId]?.name || S.user.name,
      profileId: S.invite.profileId, context });
    const id = A.be.newNoteId(); (S.notes ||= {})[id] = n;
    A.be.setNote(id, n).catch(e => A.toast("Błąd zapisu: " + (e.code || e.message), "err"));
    A.closeSheet(); A.toast("Dziękuję – uwaga zapisana", "ok");
  };
}
export function vNotes(m, A) {
  const { S, esc } = A; const admin = A.isAdmin();
  ensureNotes(A, () => { if ((location.hash || "").startsWith("#/uwagi") && !A.$("#sheet")) vNotes(m, A); });
  if (S.notes === undefined) { m.innerHTML = `<h2>Uwagi</h2><div class="card muted">Wczytywanie…</div>`; return; }
  const f = S.notesFilter ||= admin ? "open" : "mine";
  const all = sortNotes(S.notes).filter(([, n]) => f === "all" || (f === "open" && OPEN.includes(n.status)) || (f === "mine" && n.by === S.user.email));
  const nNew = Object.values(S.notes).filter(n => n.status === "nowa").length;
  m.innerHTML = `<a class="back" href="#/wiecej">← Więcej</a>
    <h2>Uwagi i pomysły ${nNew ? `<span class="badge sh2">${nNew} nowe</span>` : ""}</h2>
    <div class="row tight"><button class="btn primary" id="nAdd">💬 Zgłoś uwagę</button>${admin ? `<button class="btn" id="nCopy">📋 Kopiuj otwarte</button>` : ""}</div>
    <div class="seg">${[["open", "Otwarte"], ["mine", "Moje"], ["all", "Wszystkie"]].map(([k, n]) => `<button class="${f === k ? "on" : ""}" data-nf="${k}">${n}</button>`).join("")}</div>
    ${all.map(([id, n]) => `<div class="card note-card st-${n.status}">
      <div class="small muted">${KINDS[n.kind] || n.kind} · ${esc(n.byName || n.by)} · ${new Date(n.at).toLocaleDateString("pl-PL")}${n.context?.label ? ` · <a href="${esc(n.context.ref || "#")}">${esc(n.context.label)}</a>` : ""}</div>
      <p class="ntext">${esc(n.text)}</p>
      ${n.answer ? `<p class="small"><b>Odpowiedź:</b> ${esc(n.answer)}</p>` : ""}
      <div class="row tight">${admin ? `<select data-ns="${id}">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${n.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          <button class="btn small" data-na="${id}">Odpowiedz</button>` : `<span class="badge">${STATUSES[n.status] || n.status}</span>`}
        ${admin || (n.by === S.user.email && n.status === "nowa") ? `<button class="ib" data-nd="${id}" aria-label="Usuń">🗑</button>` : ""}</div></div>`).join("")
      || `<div class="card muted">Brak uwag w tym widoku.</div>`}`;
  const save = (p) => p.catch(e => A.toast("Błąd zapisu: " + (e.code || e.message), "err"));
  A.$("#nAdd").onclick = () => openNoteForm(A, null);
  m.querySelectorAll("[data-nf]").forEach(b => b.onclick = () => { S.notesFilter = b.dataset.nf; vNotes(m, A); });
  m.querySelectorAll("[data-ns]").forEach(sel => sel.onchange = () => { S.notes[sel.dataset.ns].status = sel.value; save(A.be.updateNote(sel.dataset.ns, { status: sel.value })); vNotes(m, A); });
  m.querySelectorAll("[data-na]").forEach(b => b.onclick = () => { const id = b.dataset.na; const t = prompt("Odpowiedź (widoczna dla autora):", S.notes[id].answer || "");
    if (t === null) return; S.notes[id].answer = t.trim(); save(A.be.updateNote(id, { answer: t.trim() })); vNotes(m, A); });
  m.querySelectorAll("[data-nd]").forEach(b => b.onclick = () => { if (!confirm("Usunąć tę uwagę?")) return; delete S.notes[b.dataset.nd]; save(A.be.deleteNote(b.dataset.nd)); vNotes(m, A); });
  if (A.$("#nCopy")) A.$("#nCopy").onclick = async () => {
    const txt = notesText(S.notes); if (!txt) return A.toast("Brak otwartych uwag", "err");
    const d = A.sheet(`<h3>Otwarte uwagi</h3><p class="small muted">Skopiuj i wklej w rozmowie z Claude.</p><textarea id="nt" rows="12" style="width:100%" readonly>${esc(txt)}</textarea>
      <div class="row"><button class="btn primary" id="ntCopy">📋 Kopiuj</button><button class="btn" id="shClose">Zamknij</button></div>`);
    d.querySelector("#shClose").onclick = A.closeSheet;
    d.querySelector("#ntCopy").onclick = async () => { try { await navigator.clipboard.writeText(txt); A.toast("Skopiowano", "ok"); A.closeSheet(); }
      catch { const t = d.querySelector("#nt"); t.focus(); t.select(); A.toast("Zaznaczono tekst – skopiuj ręcznie", "err"); } };
  };
}
