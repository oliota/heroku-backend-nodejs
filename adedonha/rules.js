import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { assert } from "./errors.js";

export const rules = JSON.parse(
  readFileSync(new URL("../data/adedonhaRules.json", import.meta.url), "utf8"),
);
export const locales = Object.keys(rules.languages);
export const chars = (value) => Array.from(value);
export function locale(value = "en") {
  const key = value === "pt_PT" ? "pt_pt" : value === "pt_BR" ? "pt" : value;
  assert(locales.includes(key), 400, "INVALID_LOCALE");
  return key;
}
export function normalize(text) {
  let output = "";
  for (const c of text.trim().toLowerCase()) {
    const mapped = rules.normalization.accents[c] ?? c;
    for (const ch of mapped) {
      if (" -\t".includes(ch)) {
        if (output && !output.endsWith(" ")) output += " ";
      } else if (
        /\p{Nd}/u.test(ch) ||
        ch.toLowerCase() !== ch.toUpperCase() ||
        ch.codePointAt(0) >= 0x2e80
      )
        output += ch;
    }
  }
  return output.trim();
}
export function scoreAnswers(letter, answers, categories, lang) {
  assert(
    typeof letter === "string" && chars(letter).length === 1,
    409,
    "LETTER_NOT_CONFIRMED",
  );
  const result = Object.fromEntries(
    Object.keys(answers).map((uid) => [uid, Array(categories.length).fill(0)]),
  );
  for (let i = 0; i < categories.length; i++) {
    const valid = {};
    const counts = new Map();
    for (const [uid, list] of Object.entries(answers)) {
      const key = normalize(list[i] || "");
      if (
        rules.languages[lang].checks_initial
          ? chars(key).length >= 2 && chars(key)[0] === normalize(letter)
          : key.length > 0
      ) {
        valid[uid] = key;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    for (const [uid, key] of Object.entries(valid))
      result[uid][i] = counts.get(key) > 1 ? 5 : 10;
  }
  return result;
}
export function code(length) {
  return Array.from(
    { length },
    () =>
      rules.online.code_alphabet[randomInt(rules.online.code_alphabet.length)],
  ).join("");
}
export function object(value, allowed) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "INVALID_PAYLOAD",
  );
  assert(
    Object.keys(value).every((k) => allowed.includes(k)),
    400,
    "UNKNOWN_FIELD",
  );
  return value;
}
export function text(value, max, required = true) {
  assert(
    typeof value === "string" &&
      chars(value).length <= max &&
      (!required || value.trim().length > 0) &&
      !/[\u0000-\u001f]/u.test(value),
    400,
    "INVALID_TEXT",
  );
  return value.trim();
}
export function settings(input = {}, previous) {
  object(input, ["lang", "categories", "letters", "rounds", "timer"]);
  const lang = locale(input.lang ?? previous?.lang ?? "en");
  const defaults = rules.languages[lang];
  const categories =
    input.categories ?? previous?.categories ?? defaults.default_categories;
  assert(
    Array.isArray(categories) &&
      categories.length >= 3 &&
      categories.length <= 12,
    400,
    "INVALID_CATEGORIES",
  );
  const cleaned = categories.map((c) => text(c, 24).toUpperCase());
  assert(
    new Set(cleaned.map(normalize)).size === cleaned.length,
    400,
    "DUPLICATE_CATEGORY",
  );
  const letters = input.letters ?? previous?.letters ?? defaults.letters;
  assert(
    typeof letters === "string" &&
      letters.length > 0 &&
      chars(letters).every((c) => defaults.alphabet.includes(c)) &&
      new Set(chars(letters)).size === chars(letters).length,
    400,
    "INVALID_LETTERS",
  );
  const rounds = input.rounds ?? previous?.rounds ?? 5;
  const timer = input.timer ?? previous?.timer ?? 90;
  assert(
    rules.round_options.includes(rounds) && rules.timer_options.includes(timer),
    400,
    "INVALID_SETTINGS",
  );
  return { lang, categories: cleaned, letters, rounds, timer };
}
