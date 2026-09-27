/**
 * Which paragraphs a change could have made false. A paragraph is a candidate
 * when a reference in it, as layer 1 reads references, names a changed file,
 * the package entry or subpath holding one, or a word the change adds or
 * removes; when a lowercase word in its inline code is a string literal on a
 * changed line; or when a claim it makes ties to the hunk, as `claims.ts`
 * reads claims. Its document must not be part of the change. Nothing judges.
 */

import { nameOf, pointsAt, wordsIn } from "../doc-references/check.ts";
import { claimsTied, hunkFacts, paragraphFacts } from "./claims.ts";
import { isCode } from "./diff.ts";

import type { Paragraph, Reference } from "../doc-references/check.ts";
import type { HunkFacts, ParagraphFacts } from "./claims.ts";
import type { Hunk } from "./diff.ts";

/** One paragraph, the hunks that touch what it names or claims, and what tied them. */
export interface Candidate {
  readonly hunks: readonly Hunk[];
  readonly paragraph: Paragraph;
  /** The references, then the claims, that matched, deduplicated. */
  readonly via: readonly string[];
}

/** Every paragraph outside `touched` that a code hunk reaches, in the order given. */
export function findCandidates(
  paragraphs: readonly Paragraph[],
  hunks: readonly Hunk[],
  touched: ReadonlySet<string>,
): Candidate[] {
  const code = hunks
    .filter((hunk) => isCode(hunk.file))
    .map((hunk) => {
      const changed = [...hunk.added, ...hunk.removed].join("\n");
      return {
        facts: hunkFacts(hunk),
        hunk,
        literals: literalsIn(changed),
        words: wordsIn(changed),
      };
    });
  const found: Candidate[] = [];
  for (const paragraph of paragraphs) {
    if (touched.has(paragraph.file)) continue;
    const via = new Set<string>();
    const reached: Hunk[] = [];
    const read = { claims: paragraphFacts(paragraph), paragraph, spans: spansIn(paragraph.text) };
    for (const entry of code) {
      const matched = matchesIn(read, entry);
      if (matched.length === 0) continue;
      reached.push(entry.hunk);
      for (const text of matched) via.add(text);
    }
    if (reached.length > 0) found.push({ hunks: reached, paragraph, via: [...via] });
  }
  return found;
}

interface Changed {
  readonly facts: HunkFacts;
  readonly hunk: Hunk;
  readonly literals: ReadonlySet<string>;
  readonly words: ReadonlySet<string>;
}

interface Read {
  readonly claims: ParagraphFacts;
  readonly paragraph: Paragraph;
  readonly spans: readonly string[];
}

/** The texts in a paragraph that tie it to one code hunk. */
function matchesIn({ claims, paragraph, spans }: Read, changed: Changed): string[] {
  const { facts, hunk, literals, words } = changed;
  return [
    ...paragraph.references
      .filter((reference) => ties(reference, hunk, words))
      .map((reference) => reference.text),
    ...spans.filter((span) => literals.has(span) || (span.includes("_") && words.has(span))),
    ...claimsTied(claims, facts),
  ];
}

/**
 * Lowercase words a paragraph quotes as code: a state or a mode such as
 * `sparse`, which ties to a string literal, or a snake_case name such as
 * `list_comments`, distinctive enough to tie to any word.
 */
export function spansIn(text: string): string[] {
  return [...text.matchAll(/(?<!`)`([a-z][a-z0-9_-]{2,})`(?!`)/g)].map((match) => match[1] ?? "");
}

/** Words too common as literals to say which paragraph a change reaches. */
const COMMON = new Set([
  "boolean",
  "const",
  "false",
  "node",
  "null",
  "number",
  "object",
  "string",
  "true",
  "undefined",
]);

/** Every quoted lowercase word in code, such as `"sparse"` in a list of states. */
export function literalsIn(text: string): Set<string> {
  const quoted = [...text.matchAll(/(["'])([a-z][a-z0-9-]{2,})\1/g)].map((match) => match[2] ?? "");
  return new Set(quoted.filter((word) => !COMMON.has(word)));
}

function ties(reference: Reference, hunk: Hunk, words: ReadonlySet<string>): boolean {
  const name = nameOf(reference);
  if (name === undefined) return pointsAt(reference, hunk.file);
  if (words.has(name)) return true;
  const variable = reference.kind === "identifier" ? screaming(name) : undefined;
  return variable !== undefined && [...words].some((word) => word.endsWith(`_${variable}`));
}

/** `requireApproval` as `REQUIRE_APPROVAL`, the tail of the variable that feeds an option. */
function screaming(name: string): string | undefined {
  if (!/[a-z][A-Z]/.test(name)) return undefined;
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}
