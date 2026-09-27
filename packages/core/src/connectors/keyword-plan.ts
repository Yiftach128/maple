/**
 * The keyword planner: state words pick the state, shared words pick the
 * calls. No network, no model, and the floor the plan eval measures against.
 * `docs/mock.md` says what it reads and where it stops.
 */

import { MOCK_STATES } from "../mock/recipe.js";
import { planFlags, planRole, withoutLayers } from "./keyword-layers.js";
import { plannedCall, stateFromWeights } from "./plan.js";

import type { MockState } from "../mock/recipe.js";
import type { MockPlan, MockPlanCall, MockPlanRequest, PlannedCall } from "./types.js";

/**
 * A field a record may lack, which "no avatar" means is missing rather than
 * that a list is empty.
 */
const FIELD =
  "(?:avatar|description|photo|image|picture|bio|logo|icon|thumbnail|note|tag|email|phone|address|title|subtitle|summary|owner|assignee|reviewer|due date)";

/** Phrases per state. Presence counts, not repetition. */
const STATE_PATTERNS: Readonly<Record<MockState, readonly RegExp[]>> = {
  empty: [
    /\bempty\b/,
    /\bnothing\b/,
    /\bzero\b/,
    /\bblank\b/,
    /\bnone\b/,
    /\bwithout any\b/,
    new RegExp(String.raw`\bno (?!access|permission|rights|(?:[a-z]+ )?${FIELD})[a-z]+`),
    /\bfirst[- ]?(time|run)\b/,
  ],
  error: [
    /\berror/,
    /\bfail/,
    /\bbroken\b/,
    /\bcrash/,
    /\b5\d\d\b/,
    /\bdown\b/,
    /\bouta/,
    /\bunavailable\b/,
    /\bgoes wrong\b/,
  ],
  forbidden: [
    /\bforbidden\b/,
    /\bpermission/,
    /\bunauthori[sz]ed\b/,
    /\b40[13]\b/,
    /\bdenied\b/,
    /\bno (access|rights)\b/,
    /\bnot allowed\b/,
    /\bcan'?t (see|access|view)\b/,
  ],
  loading: [
    /\bload/,
    /\bspinner/,
    /\bskeleton/,
    /\bslow/,
    /\bpending\b/,
    /\bwaiting\b/,
    /\bhangs?\b/,
    /\bin progress\b/,
  ],
  one: [/\bone\b/, /\bsingle\b/, /\bjust 1\b/, /\bonly 1\b/, /\b1 [a-z]+[^s\s]\b/, /\blone\b/],
  many: [
    /\bmany\b/,
    /\blots? of\b/,
    /\bhundreds?\b/,
    /\bthousands?\b/,
    /\blong (?:list|table|page|feed|queue|history)/,
    /\blong enough to (?:scroll|paginate)\b/,
    /\bfull\b/,
    /\boverflows? with\b/,
    /\bhuge\b(?! numbers?)/,
    /\bpaginat/,
    /\b\d{2,} [a-z]+/,
  ],
  long: [
    /\blong\b/,
    /\blong (?:name|text|title|description|label|word|string|value|url|email)/,
    /\boverflow/,
    /\btruncat/,
    /\bwrap/,
    /\bellips/,
    /\blengthy\b/,
    /\b(?:widest|longest)\b/,
    /\b(?:doesn'?t|don'?t|won'?t) fit\b/,
    /\b(?:big|large|wide|huge) numbers?\b/,
  ],
  sparse: [
    /\bmissing\b/,
    /\bnulls?\b/,
    /\bincomplete\b/,
    /\boptional\b/,
    /\bsparse/,
    /\bhalf[- ](?:empty|filled)\b/,
    /\b(?:not|un)[- ]?filled\b/,
    /\bbare[- ]?bones\b/,
    /\bhalf (?:of )?the fields\b/,
    new RegExp(String.raw`\b(?:no|without an?|without) (?:[a-z]+ )?${FIELD}`),
  ],
  mixed: [
    /\bmix(?:ed)?\b/,
    /\bvariety\b/,
    /\bvaried\b/,
    /\bdiverse\b/,
    /\bheterogen/,
    /\bedge cases\b/,
    /\bside by side\b/,
    /\bevery (?:[a-z]+ )?(?:status|state|kind|type|variant|combination|case|option|colou?r|badge|tier|role)/,
    /\ball (?:the )?(?:different )?(?:statuses|states|kinds|types|variants|combinations|options|badges|tiers|roles)\b/,
    /\bdifferent (?:[a-z]+ )?[a-z]+s\b/,
    /\b([a-z]+) and (?:dis|un|non-?)\1\b/,
  ],
};

/**
 * Words that say nothing about which call is meant: the sentence's frame and
 * the grammar of a key. A state word is left out as well, in `contentWords`.
 */
const STOP = new Set([
  "a",
  "all",
  "an",
  "and",
  "any",
  "api",
  "are",
  "as",
  "at",
  "be",
  "by",
  "call",
  "can",
  "data",
  "delete",
  "for",
  "get",
  "give",
  "have",
  "i",
  "if",
  "in",
  "is",
  "it",
  "item",
  "just",
  "let",
  "list",
  "make",
  "me",
  "mock",
  "my",
  "no",
  "not",
  "of",
  "on",
  "only",
  "or",
  "our",
  "page",
  "patch",
  "post",
  "put",
  "query",
  "rest",
  "screen",
  "see",
  "should",
  "show",
  "some",
  "state",
  "that",
  "the",
  "there",
  "this",
  "to",
  "trpc",
  "view",
  "want",
  "we",
  "what",
  "when",
  "where",
  "with",
  "would",
  "you",
  "your",
]);

/** A call that writes, which a sentence about "the page" does not mean. */
const WRITE = /^rest:(DELETE|PATCH|POST|PUT) /;
const MUTATION = /\bmutation\b/i;

/** Probabilities for a call, by what the sentence said about it. */
const NAMED = 0.9;
const UNNAMED = 0.1;
const PAGE_WIDE = 0.6;

/** Plans one sentence. Pure: the same request always gets the same plan. */
export function keywordPlan(request: MockPlanRequest): MockPlan {
  const text = request.request.toLowerCase();
  const weights: Partial<Record<MockState, number>> = {};
  for (const state of MOCK_STATES) weights[state] = hits(text, STATE_PATTERNS[state]);

  const role = request.roles === undefined ? undefined : planRole(text, request.roles);
  return {
    ...stateFromWeights(weights),
    calls: concerns(contentWords(dataPart(text, request)), request.calls),
    ...(request.flags === undefined ? {} : { flags: planFlags(text, request.flags) }),
    ...(role === undefined ? {} : { role }),
  };
}

/** What the sentence asks of the data: the role it names and the flags it switches pick no call. */
function dataPart(text: string, request: MockPlanRequest): string {
  return withoutLayers(text, request.flags ?? [], request.roles ?? []);
}

/**
 * The calls sharing the most words with the sentence are the ones it names.
 * A sentence naming none of them is about the whole page, writes aside.
 */
function concerns(words: ReadonlySet<string>, calls: readonly MockPlanCall[]): PlannedCall[] {
  const overlaps = calls.map((call) => overlap(words, callWords(call)));
  const best = Math.max(0, ...overlaps);

  return calls.map((call, index) => {
    if (best === 0) return plannedCall(call.key, writes(call) ? UNNAMED : PAGE_WIDE);
    const share = (overlaps[index] ?? 0) / best;
    return plannedCall(call.key, share === 0 ? UNNAMED : UNNAMED + (NAMED - UNNAMED) * share);
  });
}

function writes(call: MockPlanCall): boolean {
  return WRITE.test(call.key) || MUTATION.test(call.summary);
}

function overlap(words: ReadonlySet<string>, against: ReadonlySet<string>): number {
  let shared = 0;
  for (const word of words) if (against.has(word)) shared += 1;
  return shared;
}

/** The sentence's words, less its frame and every word that named a state. */
function contentWords(text: string): Set<string> {
  const stated = (word: string): boolean =>
    MOCK_STATES.some((state) => hits(word, STATE_PATTERNS[state]) > 0);
  return new Set(tokens(text).filter((word) => !stated(word)));
}

/** A key's words and its summary's: `trpc:bean.listByRoast` is bean, roast. */
function callWords(call: MockPlanCall): Set<string> {
  const key = call.key.replace(/^[a-z]+:/, "").replaceAll(/([a-z])([A-Z])/g, "$1 $2");
  return new Set([...tokens(key.toLowerCase()), ...tokens(call.summary.toLowerCase())]);
}

/** Lowercase words, stop words dropped, a plural folded to its singular. */
function tokens(text: string): string[] {
  return (text.match(/[a-z]+/g) ?? []).filter((word) => !STOP.has(word)).map(singular);
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function hits(text: string, patterns: readonly RegExp[]): number {
  return patterns.filter((pattern) => pattern.test(text)).length;
}
