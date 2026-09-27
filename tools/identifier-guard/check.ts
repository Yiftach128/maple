/**
 * Fails when a diff's added lines introduce an identifier that should not be
 * public: an absolute home path, or a term from the denylist in the
 * MAPLE_IDENTIFIER_DENYLIST environment variable (newline-separated, `#` for
 * comments, case-insensitive). A finding prints as `file:line: <rule>` and
 * never includes the term, the matched text or the line. Without the variable
 * only the path rule runs. allowlist.json names placeholder home directories.
 * Run it as `node tools/identifier-guard/check.ts --base origin/main`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One line the diff adds, with its number in the new file. */
export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** Why a line failed; the only detail a finding carries. */
export type Rule = "absolute home path" | "denylisted term";

/** One failing line. `file` is redacted when the path itself matched. */
export interface Finding {
  file: string;
  line: number;
  rule: Rule;
}

/** Printed in place of a file path that contains a denylisted term. */
export const REDACTED_PATH = "<a file whose path contains a denylisted term>";

/** The environment variable the denylist is read from, never argv. */
export const DENYLIST_ENV = "MAPLE_IDENTIFIER_DENYLIST";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const HOME_PATH = /(?<![\w.~-])(?:[A-Za-z]:)?[/\\](?:Users|home)[/\\]([\w.-]+)/g;
const SKIPPED = new Set(["pnpm-lock.yaml"]);

/** The terms in a denylist, lowercased, without blanks or `#` comments. */
export function parseDenylist(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** The new file a `+++` header names, or undefined when it is not scanned. */
function scannedFile(header: string): string | undefined {
  if (header === "+++ /dev/null") return undefined;
  const file = header.slice("+++ b/".length);
  return SKIPPED.has(file) ? undefined : file;
}

/** Every added line in unified-diff output, skipping binaries and the lockfile. */
export function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | undefined;
  let inHeader = false;
  let next = 0;
  for (const raw of diff.split("\n")) {
    // Only a header has `+++`; inside a hunk it is an added line starting `++`.
    if (raw.startsWith("diff --git ")) inHeader = true;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (inHeader) {
      if (raw.startsWith("+++ ")) file = scannedFile(raw);
      if (hunk) [inHeader, next] = [false, Number(hunk[1])];
    } else if (hunk) next = Number(hunk[1]);
    else if (raw.startsWith("+") && file !== undefined) {
      added.push({ file, line: next, text: raw.slice(1) });
      next += 1;
    } else if (raw.startsWith(" ")) next += 1;
  }
  return added;
}

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}_]/u.test(char);

/** Whether `term` occurs in `text` with no letter, digit or `_` either side. */
export function containsTerm(text: string, term: string): boolean {
  const haystack = text.toLowerCase();
  for (let at = haystack.indexOf(term); at !== -1; at = haystack.indexOf(term, at + 1)) {
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + term.length])) return true;
  }
  return false;
}

/** Whether `text` names a home directory whose user is not a placeholder. */
export function containsHomePath(text: string, allowedUsers: ReadonlySet<string>): boolean {
  for (const match of text.matchAll(HOME_PATH)) {
    if (!allowedUsers.has(match[1] ?? "")) return true;
  }
  return false;
}

/** What a diff adds: its lines, and every path it adds or modifies. */
export interface Diff {
  lines: readonly AddedLine[];
  /** Includes binaries and empty files, which have no added lines. */
  paths: readonly string[];
}

/** Every finding in `diff`: one per matching path, one per rule per line. */
export function findIdentifiers(
  { lines, paths }: Diff,
  terms: readonly string[],
  allowedUsers: ReadonlySet<string>,
): Finding[] {
  const hit = (text: string): boolean => terms.some((term) => containsTerm(text, term));
  const redacted = new Set(paths.filter((path) => hit(path)));
  const findings: Finding[] = [...redacted].map(() => ({
    file: REDACTED_PATH,
    line: 0,
    rule: "denylisted term",
  }));
  // A file whose path matched already fails, and naming its lines would name it.
  for (const { file, line, text } of lines) {
    if (redacted.has(file) || hit(file)) continue;
    if (hit(text)) findings.push({ file, line, rule: "denylisted term" });
    if (containsHomePath(text, allowedUsers))
      findings.push({ file, line, rule: "absolute home path" });
  }
  return findings;
}

/** A finding as a GitHub annotation, with nothing in it but where and which rule. */
export function formatFinding({ file, line, rule }: Finding): string {
  if (file === REDACTED_PATH) return `::error::${file}: ${rule}`;
  const property = file.replaceAll("%", "%25").replaceAll(",", "%2C").replaceAll(":", "%3A");
  return `::error file=${property},line=${String(line)}::${file}:${String(line)}: ${rule}`;
}

/** What the diff from the merge base of `base` to `head` adds, in `root`. */
export function diffSince(root: string, base: string, head: string): Diff {
  const git = (...args: string[]): string =>
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one the hook or CI runs.
    execFileSync("git", ["-c", "core.quotePath=false", ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  // A push that creates the branch reports an all-zero `before`.
  const from = /^0+$/.test(base) ? EMPTY_TREE : git("merge-base", base, head).trim();
  const range = ["--no-color", "--no-renames", "--no-ext-diff", from, head];
  return {
    lines: parseAddedLines(git("diff", "-U0", ...range)),
    paths: git("diff", "--name-only", "-z", "--diff-filter=d", ...range)
      .split("\0")
      .filter((path) => path !== ""),
  };
}

/** The placeholder home-directory users in allowlist.json. */
export function allowedUsers(): Set<string> {
  const text = readFileSync(new URL("allowlist.json", import.meta.url), "utf8");
  return new Set(Object.keys(JSON.parse(text) as Record<string, string>));
}

function argument(name: string, fallback: string): string {
  const flag = process.argv.indexOf(name);
  return (flag === -1 ? undefined : process.argv[flag + 1]) ?? fallback;
}

/** Everything a run prints, and its exit code; the only path output takes. */
export interface Report {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/** Checks the diff from `base` to `head` in `root` against `denylist`. */
export function report(root: string, base: string, head: string, denylist?: string): Report {
  const terms = parseDenylist(denylist);
  const notice =
    terms.length === 0 ? `::notice::${DENYLIST_ENV} is not set; checking home paths only.\n` : "";
  const findings = findIdentifiers(diffSince(root, base, head), terms, allowedUsers());
  if (findings.length === 0) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: `${notice}No denylisted identifiers or home paths added.\n`,
    };
  }
  const stderr = findings.map((finding) => `${formatFinding(finding)}\n`).join("");
  return { exitCode: 1, stderr, stdout: notice };
}

function main(): void {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const base = argument("--base", "origin/main");
  const result = report(root, base, argument("--head", "HEAD"), process.env[DENYLIST_ENV]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
