// defaults.js – v0.1.2 – wartości startowe (specyfikacja v1.3, model danych v1.2)
export const SLOTS = ["sniadanie", "ii_sniadanie", "obiad", "przekaska", "kolacja"];
export const SLOT_NAMES = { sniadanie: "Śniadanie", ii_sniadanie: "II śniadanie", obiad: "Obiad", przekaska: "Przekąska", kolacja: "Kolacja", deser: "Deser" };
export const CATEGORY_NAMES = { sniadanie: "Śniadania", ii_sniadanie: "II śniadania", przekaska: "Przekąski", obiad: "Obiady", kolacja: "Kolacje", deser: "Desery" };
export const TAG_NAMES = { zelazo: "żelazo", express: "express", keto: "keto", "2-dni": "na 2 dni" };
export const FAMILY_NAMES = {
  "migdaly": "migdały", "orzechy-laskowe": "orzechy laskowe", "rodzynki": "rodzynki",
  "watrobka": "wątróbka", "natka-pietruszki": "natka pietruszki", "suszone-morele": "suszone morele"
};
export const AISLES = ["Warzywa i owoce", "Pieczywo", "Nabiał i jaja", "Mięso i wędliny", "Ryby", "Kasze, ryż, makarony, mąki",
  "Konserwy i słoiki", "Mrożonki", "Bakalie, orzechy, nasiona", "Oleje, sosy, przyprawy", "Napoje", "Słodycze i dodatki do wypieków", "Inne"];
export const DAY_NAMES = { 1: "pn", 2: "wt", 3: "śr", 4: "czw", 5: "pt", 6: "sob", 7: "nd" };

// Grupowanie produktów w dokumenty zbiorcze (mało odczytów)
export const PRODUCT_CHUNKS = {
  "p-swieze": ["Warzywa i owoce", "Pieczywo"],
  "p-chlodnia": ["Nabiał i jaja", "Mięso i wędliny", "Ryby", "Mrożonki"],
  "p-suche": ["Kasze, ryż, makarony, mąki", "Konserwy i słoiki", "Bakalie, orzechy, nasiona", "Oleje, sosy, przyprawy", "Napoje", "Słodycze i dodatki do wypieków", "Inne"]
};
export const productChunkOf = (aisle) => Object.keys(PRODUCT_CHUNKS).find(k => PRODUCT_CHUNKS[k].includes(aisle)) || "p-suche";
export const recipeChunkOf = (category) => "r-" + category;

export function defaultConfig(ownerEmail) {
  return {
    name: "Dieta dla Rodziny",
    schema: 1,
    invites: { [ownerEmail.toLowerCase()]: { role: "admin", profileId: "jacek" } },
    weekStart: 6, // sobota
    weekRules: {
      shared: { obiad: [1, 2, 3, 4, 5, 6, 7], sniadanie: [6, 7] },
      repeat: { obiad: { type: "blocks", blocks: [{ days: [6, 7] }, { days: [1, 2] }, { days: [3, 4] }, { days: [5] }] } }, // Firestore nie przyjmuje tablic w tablicach
      noRepeatDays: 7
    },
    scaleLimits: { min: 0.5, max: 2.0 },
    shoppingDefault: "week", // cały tydzień planu sob–pt
    versions: { schema: 1, products: null, recipes: null }
  };
}

const emptyPrefs = () => ({ fav: [], dislike: [], never: [], dislikedProducts: [], substitutions: {} });

export function defaultProfiles() {
  return {
    jacek: { name: "Jacek", uid: null, managers: [], kcalTarget: 2500,
      slots: { sniadanie: 25, ii_sniadanie: 15, obiad: 35, kolacja: 25 }, fixedExceptions: [],
      exclusions: { families: [], products: [] }, flags: { ironRich: false, keto: false }, ironTargetMg: null, prefs: emptyPrefs(), order: 1 },
    agata: { name: "Agata", uid: null, managers: [], kcalTarget: 1700,
      slots: { sniadanie: 30, ii_sniadanie: 20, obiad: 50 }, fixedExceptions: [],
      exclusions: { families: ["migdaly", "orzechy-laskowe"], products: [] }, flags: { ironRich: false, keto: false }, ironTargetMg: null, prefs: emptyPrefs(), order: 2 },
    lena: { name: "Lena", uid: null, managers: [], kcalTarget: 2000,
      slots: { sniadanie: 30, obiad: 40, kolacja: 30 },
      fixedExceptions: [{ days: [1, 2, 3, 4, 5], slots: ["obiad"], kcal: null, note: "szkoła" }],
      exclusions: { families: ["rodzynki", "watrobka", "natka-pietruszki", "suszone-morele"], products: [] },
      flags: { ironRich: true, keto: false }, ironTargetMg: null, prefs: emptyPrefs(), order: 3 },
    ilona: { name: "Ilona", uid: null, managers: [], kcalTarget: 2000,
      slots: { sniadanie: 30, obiad: 40, kolacja: 30 }, fixedExceptions: [],
      exclusions: { families: [], products: [] }, flags: { ironRich: false, keto: false }, ironTargetMg: null, prefs: emptyPrefs(), order: 4 },
    alina: { name: "Alina", uid: null, managers: [], managedByProfiles: ["jacek", "agata"], kcalTarget: 1500,
      slots: { sniadanie: 25, ii_sniadanie: 15, obiad: 35, kolacja: 25 },
      fixedExceptions: [{ days: [1, 2, 3, 4, 5], slots: ["sniadanie", "ii_sniadanie", "obiad"], kcal: null, note: "poza domem" }],
      exclusions: { families: [], products: [] }, flags: { ironRich: false, keto: false }, ironTargetMg: null, prefs: emptyPrefs(), order: 5 }
  };
}
