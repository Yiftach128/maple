/**
 * What a paragraph claims beyond the names it quotes, and what a hunk changes
 * beyond its words: a version, a count, a flag, an id's shape, a package's old
 * name, a list's members, a status such as "not built yet", a removed phrase.
 * Each signal ties a paragraph to a hunk on its own and names what tied it.
 * Each was kept for what it reached on the doc-drift cases against what it
 * cost on the repository's own history; the cases' README has both.
 */

import { posix } from "node:path";

import type { Paragraph } from "../doc-references/check.ts";
import type { Hunk } from "./diff.ts";

/** What one code hunk changes, read once. */
export interface HunkFacts {
  /** Nouns a changed line counts in prose: "five kinds", "how many times". */
  readonly counted: ReadonlySet<string>;
  /** Names a removed line declares: a function or member rewritten or gone. */
  readonly declared: ReadonlySet<string>;
  /** Four-word runs of removed lines, for prose a paragraph repeats. */
  readonly grams: ReadonlySet<string>;
  /** Names declared on unchanged lines of a hunk that changes a declaration. */
  readonly neighbours: ReadonlySet<string>;
  /** `@scope/name` on a removed line and no added one. */
  readonly packages: readonly string[];
  /** Words of a new file's path, or of a subpath export the hunk adds. */
  readonly segments: ReadonlySet<string>;
  /** Template literals as shapes: `gh_${pull}` as `gh_*`. */
  readonly templates: readonly string[];
  /** The changed lines, joined. */
  readonly text: string;
  /** `x.y.z` versions on changed lines. */
  readonly versions: readonly string[];
  readonly words: ReadonlySet<string>;
}

/** What one paragraph states, read once. */
export interface ParagraphFacts {
  readonly counted: ReadonlySet<string>;
  /** Its document's name without the extension: `gate` for `docs/gate.md`. */
  readonly doc: string;
  readonly grams: ReadonlySet<string>;
  /** Every inline code span. */
  readonly spans: readonly string[];
  /** Whether it says something does not exist yet. */
  readonly status: boolean;
  readonly versions: readonly string[];
  /** Its words, lowercase. */
  readonly words: ReadonlySet<string>;
}

type Signal = (paragraph: ParagraphFacts, hunk: HunkFacts) => string[];

const NUMBER_WORDS = new Set([
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
]);

/** Words a four-word run says nothing by: it needs three others to be distinctive. */
const SMALL = new Set([
  "all",
  "and",
  "any",
  "are",
  "but",
  "can",
  "for",
  "from",
  "has",
  "its",
  "not",
  "one",
  "rather",
  "than",
  "that",
  "the",
  "this",
  "was",
  "with",
]);

/** Names too generic to say which document a path is about. */
const GENERIC = new Set(["index", "lib", "main", "package", "readme", "src", "types", "utils"]);

/** Words so many paths carry that a new file's name says nothing by them. */
const LAYOUT = new Set(["maple"]);

const STATUS = /\bnot (?:\w+ )?yet\b|\bnot built\b|\bnot implemented\b|\bdo(?:es)? not exist\b/i;
const SEMVER = /^\d+\.\d+\.\d+$/;
const DECLARATION = /\b(?:class|enum|export const|function|interface|type)\s+([A-Za-z_$][\w$]*)/g;
const METHOD = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\??\s*\([^()]*\)\s*[:{]/;
const KEYWORDS = new Set(["catch", "for", "if", "switch", "while"]);

/** Nouns a count says nothing about the code by. */
const VAGUE = new Set(["things", "ways"]);
const IMPORT = /^\s*(?:import|export)\b.*\bfrom\b/;
const PACKAGE = /@[a-z][\w-]*\/[a-z][\w-]*/g;

/** Lowercase words of `text`, digits kept. */
function proseWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Every run of four words, three of them neither small nor under three letters. */
export function gramsIn(text: string): Set<string> {
  const words = proseWords(text);
  const found = new Set<string>();
  for (let at = 0; at + 4 <= words.length; at++) {
    const run = words.slice(at, at + 4);
    const content = run.filter((word) => word.length >= 3 && !SMALL.has(word));
    if (content.length >= 3 && !run.includes("maple")) {
      found.add(run.join(" "));
    }
  }
  return found;
}

/** `22.13` and `0.12.0`: a dotted number, as written. */
export function versionsIn(text: string): string[] {
  return [...text.matchAll(/(?<![\w.])\d+\.\d+(?:\.\d+)?(?!\w|\.\w)/g)].map((match) => match[0]);
}

/**
 * The noun after a count, singular. A paragraph counts in words or digits
 * ("eight times"); code only in prose ("five kinds", "how many times"), so a
 * number in an expression counts nothing.
 */
export function countedIn(text: string, code: boolean): Set<string> {
  const found = new Set<string>();
  const words = proseWords(text);
  words.forEach((word, at) => {
    const counts = NUMBER_WORDS.has(word) || (code ? word === "many" : /^\d+$/.test(word));
    const noun = words[at + 1] ?? "";
    if (counts && /^[a-z]{3,}s$/.test(noun) && !VAGUE.has(noun)) found.add(noun);
  });
  return found;
}

/** `gh_${String(pull)}_${id}` and `gh_<pull>_<id>` both as `gh_*_*`. */
export function skeleton(text: string): string {
  return text.replaceAll(/\$\{[^}]*\}|<[^<>]*>/g, "*");
}

/** Names a line declares: a function, a type, an exported binding, or a method. */
export function declaredIn(line: string): string[] {
  const named = [...line.matchAll(DECLARATION)].map((match) => match[1] ?? "");
  const method = METHOD.exec(line)?.[1];
  return method === undefined || KEYWORDS.has(method) ? named : [...named, method];
}

/** Reads what `hunk` changes. */
export function hunkFacts(hunk: Hunk): HunkFacts {
  const changed = [...hunk.added, ...hunk.removed];
  const text = changed.join("\n");
  const redeclares = changed.some((line) => declaredIn(line).length > 0);
  const context = hunk.lines.filter((line) => line.startsWith(" ")).map((line) => line.slice(1));
  return {
    counted: countedIn(text, true),
    declared: new Set(hunk.removed.flatMap(declaredIn)),
    grams: gramsIn(hunk.removed.filter((line) => !IMPORT.test(line)).join("\n")),
    neighbours: new Set(redeclares ? context.flatMap(declaredIn) : []),
    packages: gone(hunk, PACKAGE),
    segments: segmentsOf(hunk),
    templates: [...text.matchAll(/`([^`]*\$\{[^`]*)`/g)].map((match) => skeleton(match[1] ?? "")),
    text,
    versions: versionsIn(text).filter((version) => SEMVER.test(version)),
    words: new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []),
  };
}

/** What `pattern` matches on a removed line and on no added one: a rename's old name. */
function gone(hunk: Hunk, pattern: RegExp): string[] {
  const added = hunk.added.join("\n");
  const removed = [...hunk.removed.join("\n").matchAll(pattern)].map((match) => match[0]);
  return [...new Set(removed)].filter((name) => !added.includes(name));
}

/** The words a new file's path or a new subpath export brings: `"./vite":` gives `vite`. */
function segmentsOf(hunk: Hunk): Set<string> {
  const found = new Set<string>();
  if (hunk.header.startsWith("@@ -0,0 ")) {
    const stem = stemOf(hunk.file);
    const named = GENERIC.has(stem) ? posix.basename(posix.dirname(hunk.file)) : stem;
    for (const word of proseWords(named).filter((one) => !LAYOUT.has(one))) found.add(word);
  }
  for (const line of hunk.added) {
    for (const match of line.matchAll(/"\.\/([a-z][\w-]*)"\s*:/g)) found.add(match[1] ?? "");
  }
  for (const word of GENERIC) found.delete(word);
  return found;
}

/** `docs/gate.md` as `gate`, `src/app.test.ts` as `app`. */
function stemOf(file: string): string {
  return posix.basename(file).split(".")[0] ?? "";
}

/** Reads what `paragraph` states. */
export function paragraphFacts(paragraph: Paragraph): ParagraphFacts {
  const { text } = paragraph;
  return {
    counted: countedIn(text, false),
    doc: stemOf(paragraph.file).toLowerCase(),
    grams: gramsIn(text),
    spans: [...text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map((match) => match[1] ?? ""),
    status: STATUS.test(text),
    versions: versionsIn(text),
    words: new Set(proseWords(text)),
  };
}

/** A version the paragraph states, on a changed line as it is or as its prefix. */
const versions: Signal = (paragraph, hunk) =>
  paragraph.versions.filter((stated) =>
    hunk.versions.some((changed) => changed === stated || changed.startsWith(`${stated}.`)),
  );

/** A flag with its value, or an assignment, quoted on a changed line as the paragraph quotes it. */
const flags: Signal = (paragraph, hunk) =>
  paragraph.spans.filter((span) => /\w=\S/.test(span) && hunk.text.includes(span));

/** An id's shape: `gh_<pull>_<commentId>` against `gh_${pull}_${id}`. */
const shapes: Signal = (paragraph, hunk) =>
  paragraph.spans.filter((span) => {
    const shape = skeleton(span);
    return (
      shape !== span && shape.replaceAll("*", "").length >= 3 && hunk.templates.includes(shape)
    );
  });

/** `@maplekit/core/testing` or `@maplekit/*` against a package name the change drops. */
const packages: Signal = (paragraph, hunk) =>
  paragraph.spans.filter((span) =>
    hunk.packages.some((name) =>
      span.endsWith("/*")
        ? name.startsWith(span.slice(0, -1))
        : span === name || span.startsWith(`${name}/`) || span.startsWith(`${name}@`),
    ),
  );

/** `StoreConnector.appendMany` when the change has both words. */
const members: Signal = (paragraph, hunk) =>
  paragraph.spans.filter((span) => {
    const [, owner, member] = /^([A-Z]\w*)\.([a-z]\w*)(?:\(\))?$/.exec(span) ?? [];
    return owner !== undefined && hunk.words.has(owner) && hunk.words.has(member ?? "");
  });

/** A lowercase name such as `list` that a removed line declared. */
const declared: Signal = (paragraph, hunk) =>
  paragraph.spans.filter((span) => hunk.declared.has(span.replace(/\(\)$/, "")));

/** Two or more members the paragraph lists beside a declaration the change makes. */
const neighbours: Signal = (paragraph, hunk) => {
  const listed = paragraph.spans.filter((span) => hunk.neighbours.has(span.replace(/\(\)$/, "")));
  return listed.length >= 2 ? listed : [];
};

/** "eight times" against "how many times": the same noun counted on both sides. */
const counts: Signal = (paragraph, hunk) =>
  [...paragraph.counted].filter((noun) => hunk.counted.has(noun));

/** Four words a removed line had and the paragraph still says. */
const phrases: Signal = (paragraph, hunk) =>
  [...paragraph.grams].filter((gram) => hunk.grams.has(gram)).slice(0, 1);

/** "Not built yet" beside a new file or export that its words, or its doc's name, name. */
const status: Signal = (paragraph, hunk) => {
  if (!paragraph.status) return [];
  return [...hunk.segments].filter((word) =>
    [word, word.replace(/s$/, "")].some((one) => said(paragraph, one)),
  );
};

function said(paragraph: ParagraphFacts, word: string): boolean {
  return paragraph.words.has(word) || paragraph.doc === word;
}

const SIGNALS: readonly Signal[] = [
  versions,
  flags,
  shapes,
  packages,
  members,
  declared,
  neighbours,
  counts,
  phrases,
  status,
];

/** What ties `paragraph` to `hunk` beyond the names it quotes; empty when nothing does. */
export function claimsTied(paragraph: ParagraphFacts, hunk: HunkFacts): string[] {
  return SIGNALS.flatMap((signal) => signal(paragraph, hunk));
}
