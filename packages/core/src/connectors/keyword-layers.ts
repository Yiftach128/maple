/**
 * The keyword planner's flags and role. It sets only a flag the page listed,
 * to one of its listed values, and picks only a listed role: a key is never
 * read out of the sentence. `docs/mock.md` says what it reads.
 */

import { flagValues, plannedFlag } from "./plan.js";

import type { FlagValue } from "../mock/recipe.js";
import type { MockPlanFlag, PlannedFlag, PlannedRole } from "./types.js";

/** Probabilities for a flag or a role, by whether the sentence named it. */
const NAMED = 0.9;
const UNNAMED = 0.1;

/** Words a flag key carries that say nothing about which flag it is. */
const GENERIC = new Set(["enable", "enabled", "feature", "flag", "frontend", "temporary"]);

/** Words just before a boolean flag's name that turn it off, and just after it. */
const OFF_BEFORE = new Set(["no", "without", "off", "disable", "disabled", "hide", "remove"]);
const OFF_AFTER = new Set(["off", "disabled", "hidden", "removed", "gone"]);

/** How many words either side of a flag's name are read for on or off. */
const REACH = 2;

/**
 * One verdict per flag: named when every word of its key is in the sentence,
 * set to the value the words around it say.
 */
export function planFlags(text: string, flags: readonly MockPlanFlag[]): PlannedFlag[] {
  const words = (text.match(/[a-z0-9]+/g) ?? []).map(singular);
  return flags.map((flag) => {
    const values = flagValues(flag);
    const fallback = values[0] ?? null;
    const key = keyWords(flag.key);
    const at = mention(words, key);
    if (at === undefined) return plannedFlag(flag.key, fallback, 0);
    const value =
      flag.type === "boolean" ? !turnedOff(words, at, key.length) : named(words, values);
    return value === undefined
      ? plannedFlag(flag.key, fallback, UNNAMED)
      : plannedFlag(flag.key, value, NAMED);
  });
}

/** The listed role the sentence asks to be shown as, earliest in the sentence. */
export function planRole(text: string, roles: readonly string[]): PlannedRole | undefined {
  const found = roles
    .map((role) => ({ role, at: text.search(asRole(role)) }))
    .filter((one) => one.at !== -1)
    .toSorted((a, b) => a.at - b.at);
  const first = found[0];
  return first === undefined ? undefined : { role: first.role, p: NAMED };
}

/**
 * Words either side of a flag's name that say which way it is switched. "No"
 * is not one: it is a state word, and "no comments" asks for an empty list.
 */
const SWITCHED_BEFORE = String.raw`(?:turn(?:ed)? (?:on|off)|switch(?:ed)? (?:on|off)|enable|disable|hide|remove) `;
const SWITCHED_AFTER = String.raw` (?:(?:turned|switched) )?(?:on|off|enabled|disabled|hidden|removed|gone)`;
const ARTICLE = String.raw`(?:the |an? )?`;
const LEAD = String.raw`(?:(?:with|without|in|on) )?${ARTICLE}`;

/** What a stripped phrase leaves at either end: a comma, or an "and" or "with" joining nothing. */
const JOINERS: ReadonlySet<string> = new Set([",", ";", "and", "with", "but"]);
const PUNCTUATION: ReadonlySet<string> = new Set([",", ";"]);

/**
 * The sentence less every listed role it asks to be shown as and every listed
 * flag it names by its key's words, as the matchers above find them: what is
 * left is what it asks of the data. A one-word key is taken only beside a
 * word that switches it or one of its values, since alone it may be data.
 */
export function withoutLayers(
  text: string,
  flags: readonly MockPlanFlag[],
  roles: readonly string[],
): string {
  let left = text;
  for (const role of roles) left = left.replaceAll(new RegExp(asRole(role).source, "gi"), " ");
  for (const flag of flags) left = left.replaceAll(flagPhrase(flag), " ");
  return tidy(left);
}

/** The words left, with a joiner at either end and a doubled comma dropped. */
function tidy(text: string): string {
  const words = text.replaceAll(",", " , ").replaceAll(";", " ; ").split(" ").filter(Boolean);
  const kept = words.filter(
    (word, i) => !(PUNCTUATION.has(word) && PUNCTUATION.has(words[i + 1] ?? "")),
  );
  const joins = (word: string | undefined) => word !== undefined && JOINERS.has(word.toLowerCase());
  while (joins(kept[0])) kept.shift();
  while (joins(kept.at(-1))) kept.pop();
  return kept.join(" ").replaceAll(" ,", ",").replaceAll(" ;", ";");
}

/** A flag's name with the words that switch it, which a one-word name must have. */
function flagPhrase(flag: MockPlanFlag): RegExp {
  const words = keyWords(flag.key);
  if (words.length === 0) return /(?!)/g;
  const name = words.map((word) => `${escape(word)}(?:e?s)?`).join("[-_ ]+");
  const values = flagValues(flag)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map((value) => escape(String(value)));
  const value = values.length === 0 ? "(?!)" : `(?:${values.join("|")})`;
  const set = `(?:${SWITCHED_BEFORE}|${value} )`;
  const after = `(?:${SWITCHED_AFTER}| (?:at |to |set to )?${value})`;
  const phrase =
    words.length > 1
      ? `${LEAD}${set}?${ARTICLE}${name}${after}?`
      : `${LEAD}${set}${ARTICLE}${name}${after}?|${LEAD}${name}${after}`;
  return new RegExp(String.raw`\b(?:${phrase})\b`, "gi");
}

/**
 * A key's words: `new-roaster`, `newRoaster` and `new_roaster` are new, roaster.
 * A ticket prefix, `ROAST-2210-`, names the work rather than the flag.
 */
function keyWords(key: string): string[] {
  const bare = key.replace(/^[A-Z]+-\d+-/, "");
  const spaced = bare.replaceAll(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return (spaced.match(/[a-z0-9]+/g) ?? []).map(singular).filter((word) => !GENERIC.has(word));
}

/** Where the key's words sit together in the sentence, or undefined when any is missing. */
function mention(words: readonly string[], key: readonly string[]): number | undefined {
  if (key.length === 0 || !key.every((word) => words.includes(word))) return undefined;
  return Math.min(...key.map((word) => words.indexOf(word)));
}

/** Whether the words just before the flag's name, or just after it, turn it off. */
function turnedOff(words: readonly string[], at: number, length: number): boolean {
  const before = words.slice(Math.max(0, at - REACH), at);
  const after = words.slice(at + length, at + length + REACH);
  return before.some((word) => OFF_BEFORE.has(word)) || after.some((word) => OFF_AFTER.has(word));
}

/** The one listed string or number the sentence names, if exactly one is. */
function named(words: readonly string[], values: readonly FlagValue[]): FlagValue | undefined {
  const text = ` ${words.join(" ")} `;
  const hits = values.filter(
    (value) =>
      (typeof value === "string" || typeof value === "number") &&
      text.includes(` ${String(value).toLowerCase()} `),
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/** "as a barista", "for an owner", "a guest's view", "signed in as roaster". */
function asRole(role: string): RegExp {
  const escaped = escape(role.toLowerCase());
  const word = escaped.replaceAll(/[-_ ]/g, "[-_ ]");
  return new RegExp(
    `\\b(?:as|for) (?:an? |the )?${word}s?\\b|\\b${word}(?:'s|s')? (?:view|sees?|user|role)\\b`,
  );
}

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}
