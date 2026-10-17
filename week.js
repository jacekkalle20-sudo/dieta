// week.js – v0.6.0 – tydzień planu (sobota–piątek), generator i operacje na posiłkach (bez zależności od Firebase)
import { SLOTS } from "./defaults.js";
import { slotKcal } from "./scaling.js";

// ---------- daty ----------
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const dayNum = (s) => { const g = parseYmd(s).getDay(); return g === 0 ? 7 : g; }; // 1 = pn … 7 = nd
export const saturdayOf = (s) => addDays(s, -((dayNum(s) + 1) % 7));
export const weekDates = (sat) => [0, 1, 2, 3, 4, 5, 6].map(i => addDays(sat, i));
export const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const weekOrder = (dn) => (dn + 1) % 7; // sob = 0 … pt = 6

export const SLOT_POOLS = { sniadanie: ["sniadanie"], ii_sniadanie: ["ii_sniadanie", "przekaska"], przekaska: ["przekaska", "ii_sniadanie"], obiad: ["obiad"], kolacja: ["kolacja"] };

// ---------- reguły ----------
export function isSharedByRule(config, slot, dn) { return (config.weekRules?.shared?.[slot] || []).includes(dn); }

// Bloki dni (numery 1–7) w kolejności tygodnia sob→pt; bez reguły – każdy dzień osobno
export function blocksFor(config, slot) {
  const rule = config.weekRules?.repeat?.[slot];
  const all = [6, 7, 1, 2, 3, 4, 5];
  if (!rule || rule.type !== "blocks") return all.map(d => [d]);
  const blocks = (rule.blocks || []).map(b => [...(b.days || [])].sort((a, b2) => weekOrder(a) - weekOrder(b2)));
  const covered = new Set(blocks.flat());
  for (const d of all) if (!covered.has(d)) blocks.push([d]);
  return blocks.sort((a, b) => weekOrder(a[0]) - weekOrder(b[0]));
}
export function blockDates(config, slot, sat, date) {
  const dn = dayNum(date);
  const blk = blocksFor(config, slot).find(b => b.includes(dn)) || [dn];
  return blk.map(d => addDays(sat, weekOrder(d)));
}

// Stały wyjątek profilu dla dnia i posiłku
export function fixedException(profile, dn, slot) {
  return (profile.fixedExceptions || []).find(e => e.days.includes(dn) && e.slots.includes(slot)) || null;
}

export const participants = (meal) => Object.entries(meal?.per || {}).filter(([, p]) => !p.outside).map(([pid]) => pid);
// Przepis, który je dana osoba w posiłku
export const recipeOf = (meal, pid) => meal?.mode === "shared" ? meal.recipeId : meal?.per?.[pid]?.recipeId;

// ---------- kontekst ----------
// ctx = { sat, profiles, config, recipes, kcalOf: {rid: kcal}, history: [{date, slot, recipeId, pids}], rng }
export function buildKcalIndex(recipes, totalsFn) {
  const out = {}; for (const [id, r] of Object.entries(recipes)) out[id] = totalsFn(r).kcal; return out;
}
function familiesOf(recipe, products) {
  const s = new Set(); for (const x of recipe.ingredients) for (const f of (products[x.p]?.families || [])) s.add(f); return s;
}
export function buildFamilyIndex(recipes, products) {
  const out = {}; for (const [id, r] of Object.entries(recipes)) out[id] = familiesOf(r, products); return out;
}
const scaleOf = (ctx, pid, slot, rid) => {
  const k = ctx.kcalOf[rid]; const t = slotKcal(ctx.profiles[pid], slot);
  if (!k || !t) return 1; return Math.max(0.05, Math.round(t / k * 20) / 20);
};

// ---------- wybór przepisu dla „jednostki” (dni × osoby, ten sam przepis) ----------
// unit = { slot, days: [date], pids: [pid] }
export function candidates(ctx, unit, { noRepeat = true, limits = null, exclude = [] } = {}) {
  const lim = limits || ctx.config.scaleLimits || { min: 0.5, max: 2.0 };
  const pool = SLOT_POOLS[unit.slot] || [unit.slot];
  const banned = new Set(unit.pids.flatMap(pid => ctx.profiles[pid]?.exclusions?.families || []));
  const ironPids = unit.pids.filter(pid => ctx.profiles[pid]?.flags?.ironRich);
  const out = [];
  for (const [rid, r] of Object.entries(ctx.recipes)) {
    if (!pool.includes(r.category) || (r.status && r.status !== "aktywny") || exclude.includes(rid)) continue;
    if ([...ctx.famOf[rid]].some(f => banned.has(f))) continue;
    const k = ctx.kcalOf[rid]; if (!k) continue;
    const ok = unit.pids.every(pid => { const t = slotKcal(ctx.profiles[pid], unit.slot); if (!t) return true; const s = t / k; return s >= lim.min && s <= lim.max; });
    if (!ok) continue;
    if (noRepeat && ctx.history.some(h => h.slot === unit.slot && h.recipeId === rid && h.pids.some(p => unit.pids.includes(p))
        && unit.days.some(d => Math.abs(daysBetween(h.date, d)) < (ctx.config.weekRules?.noRepeatDays || 7)))) continue;
    out.push({ rid, w: ironPids.length && (r.tags || []).includes("zelazo") ? 3 : 1 });
  }
  return out;
}
export function pickRecipe(ctx, unit, exclude = []) {
  const tries = [{ noRepeat: true }, { noRepeat: false }, { noRepeat: false, limits: { min: 0.4, max: 2.5 } }];
  for (const t of tries) {
    const c = candidates(ctx, unit, { ...t, exclude });
    if (c.length) {
      const total = c.reduce((a, b) => a + b.w, 0); let x = ctx.rng() * total;
      for (const e of c) { x -= e.w; if (x <= 0) return e.rid; }
      return c[c.length - 1].rid;
    }
  }
  return null;
}
const remember = (ctx, unit, rid) => { if (rid) for (const d of unit.days) ctx.history.push({ date: d, slot: unit.slot, recipeId: rid, pids: [...unit.pids] }); };

// ---------- szkielet posiłku ----------
function skeleton(ctx, date, slot, old) {
  const dn = dayNum(date); const per = {};
  for (const [pid, p] of Object.entries(ctx.profiles)) {
    if (p.slots?.[slot] == null) continue;
    const fx = fixedException(p, dn, slot); const o = old?.per?.[pid];
    const e = { outside: !!fx, fixed: !!fx, kcal: fx?.kcal ?? null, note: fx?.note || "" };
    if (o?.manual) Object.assign(e, { outside: o.outside, kcal: o.kcal ?? null, manual: true, fixedOff: !!o.fixedOff });
    if (o?.with && !e.outside) e.with = o.with;
    per[pid] = e;
  }
  // osoby dołączone dodatkowo (nie mają tego posiłku w swoim układzie)
  for (const [pid, o] of Object.entries(old?.per || {})) if (o.extra && !per[pid] && ctx.profiles[pid]) {
    per[pid] = { outside: false, fixed: false, kcal: null, note: "", extra: true, manual: true }; if (o.with) per[pid].with = o.with;
  }
  const meal = { per };
  const n = participants(meal).length;
  if (old?.modeOverride) { meal.mode = old.mode; meal.modeOverride = true; }
  else meal.mode = isSharedByRule(ctx.config, slot, dn) && n >= 2 ? "shared" : "individual";
  return meal;
}

// ---------- generowanie tygodnia ----------
export function generateWeek(ctx, existing) {
  const dates = weekDates(ctx.sat); const days = {};
  for (const d of dates) { days[d] = {}; for (const sl of SLOTS) { const m = skeleton(ctx, d, sl, existing?.days?.[d]?.[sl]); if (Object.keys(m.per).length) days[d][sl] = m; }
    if (existing?.days?.[d]?.deser?.items?.length) days[d].deser = structuredClone(existing.days[d].deser); } // desery zaplanowane ręcznie zostają
  // zachowanie zablokowanych (ręcznie wybranych) posiłków
  for (const d of dates) for (const sl of SLOTS) {
    const old = existing?.days?.[d]?.[sl]; const m = days[d][sl]; if (!old || !m) continue;
    if (old.locked && m.mode === "shared" && old.mode === "shared") { m.recipeId = old.recipeId; m.locked = true; }
    for (const [pid, o] of Object.entries(old.per || {})) if (o.locked && m.per[pid] && m.mode === "individual") { m.per[pid].recipeId = o.recipeId; m.per[pid].locked = true; }
  }
  for (const d of dates) for (const sl of SLOTS) { const m = days[d][sl]; if (!m) continue;
    if (m.mode === "shared" && m.recipeId) remember(ctx, { slot: sl, days: [d], pids: participants(m) }, m.recipeId);
    for (const [pid, p] of Object.entries(m.per)) if (p.recipeId && p.locked) remember(ctx, { slot: sl, days: [d], pids: [pid] }, p.recipeId); }
  // jednostki: bloki × (wspólne | osoba)
  for (const sl of SLOTS) for (const blk of blocksFor(ctx.config, sl)) {
    const bd = blk.map(dn => addDays(ctx.sat, weekOrder(dn))).filter(d => days[d][sl]);
    const sharedDays = bd.filter(d => days[d][sl].mode === "shared" && !days[d][sl].locked);
    if (sharedDays.length) {
      const unit = { slot: sl, days: sharedDays, pids: [...new Set(sharedDays.flatMap(d => participants(days[d][sl])))] };
      const rid = pickRecipe(ctx, unit); remember(ctx, unit, rid);
      for (const d of sharedDays) days[d][sl].recipeId = rid;
    }
    const pids = [...new Set(bd.flatMap(d => days[d][sl].mode === "individual" ? participants(days[d][sl]) : []))];
    for (const pid of pids) {
      const pd = bd.filter(d => days[d][sl].mode === "individual" && !days[d][sl].per[pid]?.outside && !days[d][sl].per[pid]?.locked && !days[d][sl].per[pid]?.with);
      if (!pd.length) continue;
      const unit = { slot: sl, days: pd, pids: [pid] }; const rid = pickRecipe(ctx, unit); remember(ctx, unit, rid);
      for (const d of pd) days[d][sl].per[pid].recipeId = rid;
    }
  }
  const week = { start: ctx.sat, days };
  for (const sl of SLOTS) normalize(ctx, week, sl);
  return week;
}

// ---------- porządkowanie: skale i „gotuj / z wczoraj” ----------
export function normalize(ctx, week, slot) {
  const dates = weekDates(week.start);
  const blockOf = (d) => blockDates(ctx.config, slot, week.start, d);
  for (const d of dates) {
    const m = week.days[d]?.[slot]; if (!m) continue;
    const prevInBlock = blockOf(d).filter(x => x < d).pop();
    const pm = prevInBlock ? week.days[prevInBlock]?.[slot] : null;
    if (m.mode === "shared") {
      m.cook = !(pm && pm.mode === "shared" && pm.recipeId && pm.recipeId === m.recipeId);
      m.leftoverFrom = m.cook ? null : (pm.leftoverFrom || prevInBlock);
      for (const [pid, p] of Object.entries(m.per)) { delete p.recipeId; delete p.cook; delete p.leftoverFrom; delete p.with; p.scale = !p.outside && m.recipeId ? scaleOf(ctx, pid, slot, m.recipeId) : null; }
    } else {
      delete m.recipeId; m.cook = null; m.leftoverFrom = null; m.locked = false;
      // dołączeni domownicy jedzą to samo co gospodarz posiłku
      for (const [pid, p] of Object.entries(m.per)) if (p.with) {
        const h = m.per[p.with];
        if (!h || h.outside || h.with || !h.recipeId || p.outside) delete p.with;
        else { p.recipeId = h.recipeId; p.locked = false; }
      }
      for (const [pid, p] of Object.entries(m.per)) {
        if (p.outside) { p.scale = null; continue; }
        const pp = pm?.per?.[pid]; const prevRid = pm ? (pm.mode === "shared" ? pm.recipeId : pp?.recipeId) : null;
        p.cook = !(prevRid && p.recipeId && prevRid === p.recipeId && !pp?.outside);
        p.leftoverFrom = p.cook ? null : prevInBlock;
        p.scale = p.recipeId ? scaleOf(ctx, pid, slot, p.recipeId) : null;
      }
    }
  }
  return week;
}

// ---------- operacje edycji (zwracają listę zmienionych dat) ----------
function sharedUnit(week, ctx, date, slot) {
  const cur = week.days[date][slot].recipeId;
  const days = blockDates(ctx.config, slot, week.start, date).filter(d => { const m = week.days[d]?.[slot];
    return m && m.mode === "shared" && (d === date || (cur && m.recipeId === cur)); });
  return { slot, days, pids: [...new Set(days.flatMap(d => participants(week.days[d][slot])))] };
}
function personUnit(week, ctx, date, slot, pid) {
  const cur = week.days[date][slot].per[pid]?.recipeId;
  const days = blockDates(ctx.config, slot, week.start, date).filter(d => { const m = week.days[d]?.[slot];
    return m && m.mode === "individual" && !m.per[pid]?.outside && (d === date || (cur && m.per[pid]?.recipeId === cur)); });
  return { slot, days, pids: [pid] };
}
export function unitFor(week, ctx, date, slot, pid = null) {
  return week.days[date][slot].mode === "shared" ? sharedUnit(week, ctx, date, slot) : personUnit(week, ctx, date, slot, pid);
}
function historyExcept(week, unit) {
  const h = [];
  for (const [d, slots] of Object.entries(week.days)) for (const [sl, m] of Object.entries(slots)) {
    if (sl !== unit.slot) continue;
    if (m.mode === "shared" && m.recipeId && !unit.days.includes(d)) h.push({ date: d, slot: sl, recipeId: m.recipeId, pids: participants(m) });
    for (const [pid, p] of Object.entries(m.per || {})) if (p.recipeId && !(unit.days.includes(d) && unit.pids.includes(pid))) h.push({ date: d, slot: sl, recipeId: p.recipeId, pids: [pid] });
  }
  return h;
}
function apply(week, unit, rid, locked) {
  for (const d of unit.days) { const m = week.days[d][unit.slot];
    if (m.mode === "shared") { m.recipeId = rid; m.locked = !!locked; }
    else { m.per[unit.pids[0]].recipeId = rid; m.per[unit.pids[0]].locked = !!locked; } }
}
export function reroll(week, ctx, date, slot, pid = null) {
  const unit = unitFor(week, ctx, date, slot, pid);
  const cur = week.days[date][slot].mode === "shared" ? week.days[date][slot].recipeId : week.days[date][slot].per[pid]?.recipeId;
  const c2 = { ...ctx, history: [...ctx.history, ...historyExcept(week, unit)] };
  const rid = pickRecipe(c2, unit, cur ? [cur] : []) || cur;
  apply(week, unit, rid, false); normalize(ctx, week, slot); return unit.days;
}
export function replace(week, ctx, date, slot, rid, pid = null) {
  const unit = unitFor(week, ctx, date, slot, pid);
  apply(week, unit, rid, true); normalize(ctx, week, slot); return unit.days;
}
export function replaceOptions(week, ctx, date, slot, pid = null) {
  const unit = unitFor(week, ctx, date, slot, pid);
  return { unit, list: candidates({ ...ctx, history: [] }, unit, { noRepeat: false, limits: { min: 0.4, max: 2.5 } }).map(c => c.rid) };
}
export function setMode(week, ctx, date, slot, mode) {
  const m = week.days[date][slot]; if (m.mode === mode) return [date];
  const cur = m.recipeId;
  const prevPer = Object.fromEntries(Object.entries(m.per).map(([pid, p]) => [pid, p.recipeId]));
  m.mode = mode; m.modeOverride = true; m.locked = false;
  if (mode === "individual") { for (const pid of participants(m)) { m.per[pid].recipeId = cur || null; m.per[pid].locked = false; } }
  else {
    const ids = [...new Set(participants(m).map(pid => prevPer[pid]).filter(Boolean))];
    const unit = { slot, days: [date], pids: participants(m) };
    const ok = ids.length === 1 && candidates({ ...ctx, history: [] }, unit, { noRepeat: false }).some(c => c.rid === ids[0]);
    m.recipeId = ok ? ids[0] : pickRecipe({ ...ctx, history: [...ctx.history, ...historyExcept(week, unit)] }, unit);
  }
  normalize(ctx, week, slot); return blockDates(ctx.config, slot, week.start, date);
}
// Poza domem / powrót (także wyłączenie stałego wyjątku). Zwraca { dates, warning }
export function setOutside(week, ctx, date, slot, pid, outside, kcal = null) {
  const m = week.days[date][slot]; const p = m.per[pid]; let warning = null;
  if (outside) delete p.with;
  p.outside = outside; p.manual = true; p.kcal = outside ? (kcal || null) : null; p.fixedOff = !outside && p.fixed;
  if (!outside) {
    if (m.mode === "shared" && m.recipeId && [...ctx.famOf[m.recipeId]].some(f => (ctx.profiles[pid].exclusions?.families || []).includes(f)))
      warning = `${ctx.profiles[pid].name}: wspólne danie zawiera wykluczony składnik – podmień danie albo przełącz posiłek na indywidualny.`;
    if (m.mode === "individual" && !p.recipeId) {
      const unit = { slot, days: [date], pids: [pid] };
      p.recipeId = pickRecipe({ ...ctx, history: [...ctx.history, ...historyExcept(week, unit)] }, unit);
    }
  }
  normalize(ctx, week, slot); return { dates: blockDates(ctx.config, slot, week.start, date), warning };
}

// Dołączenie domownika do posiłku (indywidualny: je to samo co gospodarz; wspólny: dodatkowy uczestnik)
export function joinOptions(week, ctx, date, slot, hostPid = null) {
  const m = week.days[date][slot]; const rid = recipeOf(m, hostPid);
  const out = [];
  for (const pid of Object.keys(ctx.profiles)) {
    const e = m.per[pid];
    if (m.mode === "shared") { if (e) continue; }
    else { if (pid === hostPid || (e && !e.outside && e.with === hostPid)) continue; }
    const bad = rid ? [...(ctx.famOf[rid] || [])].filter(f => (ctx.profiles[pid].exclusions?.families || []).includes(f)) : [];
    out.push({ pid, extra: !e, outside: !!e?.outside, bad });
  }
  return out;
}
export function joinMeal(week, ctx, date, slot, hostPid, guestPid) {
  const m = week.days[date][slot]; let g = m.per[guestPid];
  if (!g) g = m.per[guestPid] = { outside: false, fixed: false, kcal: null, note: "", extra: true, manual: true };
  else if (g.outside) { g.outside = false; g.manual = true; g.kcal = null; g.fixedOff = !!g.fixed; }
  if (m.mode === "individual" && hostPid) {
    g.with = hostPid; g.locked = false;
    for (const p of Object.values(m.per)) if (p.with === guestPid) p.with = hostPid; // bez łańcuchów
  }
  normalize(ctx, week, slot); return [date];
}
export function leaveMeal(week, ctx, date, slot, pid) {
  const m = week.days[date][slot]; const p = m.per[pid]; if (!p) return [date];
  for (const [o, x] of Object.entries(m.per)) if (x.with === pid) delete x.with; // goście gospodarza zostają przy daniu
  if (p.extra) delete m.per[pid];
  else if (p.with) {
    delete p.with;
    if (m.mode === "individual") { const unit = { slot, days: [date], pids: [pid] };
      p.recipeId = pickRecipe({ ...ctx, history: [...ctx.history, ...historyExcept(week, unit)] }, unit, p.recipeId ? [p.recipeId] : []) || p.recipeId; }
  }
  normalize(ctx, week, slot); return [date];
}

// Ilości do gotowania: suma skal osób jedzących to samo danie.
// scope: "day" – ten dzień; "block" – dni bloku gotowane razem (od dnia gotowania, także gdy otwarto dzień „z wczoraj”)
// who: "all" – wszyscy przy stole; "me" – tylko osoba pid
export function cookingScales(week, ctx, date, slot, scope, pid = null, who = "all") {
  const m = week.days[date][slot]; const rid = recipeOf(m, pid) ?? m.recipeId; const rows = [];
  const eaters = (x) => participants(x).filter(p => recipeOf(x, p) === rid && (who !== "me" || p === pid));
  const isLeft = (x, p) => x.mode === "shared" ? x.cook === false : x.per[p].cook === false;
  const run = (x) => x && participants(x).some(p => recipeOf(x, p) === rid);
  let dates = [date];
  if (scope === "block") {
    const blk = blockDates(ctx.config, slot, week.start, date); let i = blk.indexOf(date);
    // cofnij do dnia gotowania
    while (i > 0) { const x = week.days[blk[i]]?.[slot]; const prev = week.days[blk[i - 1]]?.[slot];
      if (!run(x) || !run(prev) || !participants(x).some(p => recipeOf(x, p) === rid && isLeft(x, p))) break; i--; }
    dates = [blk[i]];
    for (const d of blk.slice(i + 1)) { const x = week.days[d]?.[slot];
      if (!run(x) || !participants(x).some(p => recipeOf(x, p) === rid && isLeft(x, p))) break; dates.push(d); }
  }
  for (const d of dates) for (const p of eaters(week.days[d][slot])) rows.push({ date: d, pid: p, scale: week.days[d][slot].per[p].scale || 0 });
  return { rows, total: rows.reduce((a, b) => a + b.scale, 0), dates };
}

// Podpowiedzi dla diety Fe+ przy wspólnym daniu bez tagu „żelazo”
export const IRON_HINTS = [
  { txt: "pestki dyni 15 g (posyp danie)", fam: null },
  { txt: "surówka z papryki – witamina C pomaga wchłaniać żelazo", fam: null },
  { txt: "garść szpinaku lub rukoli do talerza", fam: null },
  { txt: "kasza gryczana zamiast ryżu/ziemniaków", fam: null },
  { txt: "posyp natką pietruszki", fam: "natka-pietruszki" },
  { txt: "sezam 10 g", fam: null }
];
export function ironHints(profile) {
  const ex = new Set(profile?.exclusions?.families || []);
  return IRON_HINTS.filter(h => !h.fam || !ex.has(h.fam)).map(h => h.txt);
}

// Historia z poprzedniego tygodnia (do blokady powtórek)
export function historyFromWeek(week) {
  const h = []; if (!week?.days) return h;
  for (const [d, slots] of Object.entries(week.days)) for (const [sl, m] of Object.entries(slots)) {
    if (m.mode === "shared" && m.recipeId) h.push({ date: d, slot: sl, recipeId: m.recipeId, pids: participants(m) });
    for (const [pid, p] of Object.entries(m.per || {})) if (p.recipeId && !p.outside) h.push({ date: d, slot: sl, recipeId: p.recipeId, pids: [pid] });
  }
  return h;
}

// ---------- desery w planie dnia (poza bilansem kcal) ----------
// days[d].deser = { items: [{ rid, mult, by, at }] }; mult = wielokrotność całości (½, 1, 2)
export function addDessert(week, date, rid, mult, by, at = new Date().toISOString()) {
  const day = week.days[date] ||= {}; const de = day.deser ||= { items: [] };
  de.items.push({ rid, mult, by, at }); return de;
}
export function removeDessert(week, date, idx) {
  const de = week.days[date]?.deser; if (!de) return null; de.items.splice(idx, 1); return de;
}
