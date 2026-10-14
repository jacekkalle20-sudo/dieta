// scaling.js – v0.2.1 – kcal posiłku osoby i skala porcji przepisu
import { SLOTS } from "./defaults.js";

export function slotKcal(profile, slot) {
  const pct = profile?.slots?.[slot];
  return pct ? Math.round(profile.kcalTarget * pct / 100) : null;
}

// Skala zaokrąglona do 0,05; ok = mieści się w granicach (domyślnie 0,5–2,0)
export function portionScale(recipeKcal, targetKcal, limits = { min: 0.5, max: 2.0 }) {
  if (!recipeKcal || !targetKcal) return { scale: 1, raw: 1, ok: true };
  const raw = targetKcal / recipeKcal;
  const scale = Math.max(0.05, Math.round(raw * 20) / 20);
  return { scale, raw, ok: raw >= limits.min && raw <= limits.max };
}

// Posiłek domyślny dla przepisu i osoby
export function defaultSlotFor(category, profile) {
  const has = (s) => profile?.slots?.[s];
  const prefs = { sniadanie: ["sniadanie"], ii_sniadanie: ["ii_sniadanie", "przekaska"], przekaska: ["przekaska", "ii_sniadanie"],
    obiad: ["obiad"], kolacja: ["kolacja"], deser: ["przekaska", "ii_sniadanie"] }[category] || [];
  return prefs.find(has) || SLOTS.find(has) || null;
}

// Walidacja układu posiłków: co najmniej 1 posiłek, procenty całkowite > 0, suma 100
export function validateSlots(slots) {
  const vals = Object.values(slots || {});
  if (!vals.length) return "Zaznacz co najmniej jeden posiłek.";
  if (vals.some(v => !Number.isFinite(v) || v <= 0)) return "Każdy zaznaczony posiłek musi mieć udział większy od 0%.";
  const sum = vals.reduce((a, b) => a + b, 0);
  if (Math.round(sum) !== 100) return `Suma udziałów to ${sum}% – musi wynosić 100%.`;
  return null;
}
