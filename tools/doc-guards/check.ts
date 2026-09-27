/**
 * Two small guards on the prose in every tracked Markdown file. A `0.x.y`
 * next to an `@maple-kit/*` name that is older than that package's
 * package.json version is stale, and so is a plugin MCP pin that is not the
 * current @maple-kit/mcp. A paragraph of 40 words or more that repeats another
 * in the same file is one edit that landed twice. IGNORE on a line exempts its
 * versions; on the line above a paragraph, the paragraph. sync-versions.ts is
 * what the version pull request runs to move them all.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The marker that exempts a line, or the paragraph below it, on purpose. */
export const IGNORE = "<!-- doc-guards: ignore -->";
/** How far, in characters, a version may sit from the package it is about. */
export const NEAR = 60;
/** The shortest paragraph compared, in words. */
export const MIN_WORDS = 40;
/** Shared word-trigram fraction at or above which two paragraphs match. */
export const OVERLAP = 0.8;

/** Compares two `0.x.y` strings; negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) {
    const difference = (left?.[index] ?? 0) - (right?.[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** A version in prose, with the package it sits next to. */
export interface VersionMention {
  /** Where the version starts on its line, from 0. */
  column: number;
  line: number;
  name: string;
  version: string;
}

/** Each `0.x.y` within NEAR characters of an `@maple-kit/<name>` on its line. */
export function versionMentions(text: string): VersionMention[] {
  const found: VersionMention[] = [];
  forEachProseLine(text, (content, line) => {
    const names = [...content.matchAll(/@maple-kit\/([a-z-]+)/g)].map((match) => ({
      end: match.index + match[0].length,
      name: `@maple-kit/${match[1] ?? ""}`,
      start: match.index,
    }));
    if (names.length === 0 || content.includes(IGNORE)) return;
    for (const match of content.matchAll(/(?<![\d.])0\.\d+\.\d+(?!\.?\d)/g)) {
      const at = match.index;
      const distance = (name: { end: number; start: number }) =>
        at >= name.end ? at - name.end : name.start - (at + match[0].length);
      const nearest = names.toSorted((a, b) => distance(a) - distance(b))[0];
      if (nearest !== undefined && distance(nearest) <= NEAR) {
        found.push({ column: at, line, name: nearest.name, version: match[0] });
      }
    }
  });
  return found;
}

/** Calls `visit` with each line outside fenced code, numbered from 1. */
function forEachProseLine(text: string, visit: (content: string, line: number) => void): void {
  let fence: string | undefined;
  text.split("\n").forEach((content, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(content)?.[1];
    if (marker !== undefined && (fence === undefined || marker.startsWith(fence))) {
      fence = fence === undefined ? marker : undefined;
      return;
    }
    if (fence === undefined) visit(content, index + 1);
  });
}

/** A version mention older than its package's current version, as lines. */
export function staleVersions(
  file: string,
  text: string,
  current: ReadonlyMap<string, string>,
): string[] {
  return versionMentions(text).flatMap(({ line, name, version }) => {
    const latest = current.get(name);
    if (latest === undefined || compareVersions(version, latest) >= 0) return [];
    return [`${file}:${line}: ${version} is older than ${name}'s current ${latest}.`];
  });
}

/** A paragraph, normalised for comparison, with the line it starts on. */
export interface Paragraph {
  line: number;
  words: string[];
}

/** Every paragraph outside fenced code, lower-cased with Markdown stripped. */
export function paragraphs(text: string): Paragraph[] {
  const found: Paragraph[] = [];
  let current: Paragraph | undefined;
  let ignored = false;
  const flush = () => {
    if (current !== undefined && current.words.length > 0 && !ignored) found.push(current);
    current = undefined;
  };
  forEachProseLine(text, (content, line) => {
    if (content.trim() === "" || /^\s*(?:#|\||<!--)/.test(content)) {
      flush();
      ignored = content.trim() === IGNORE;
      return;
    }
    const words = content.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [];
    current ??= { line, words: [] };
    current.words.push(...words);
  });
  flush();
  return found;
}

/** The fraction of the smaller paragraph's word trigrams the other shares. */
export function overlap(a: readonly string[], b: readonly string[]): number {
  const grams = (words: readonly string[]) =>
    new Set(words.slice(2).map((word, index) => `${words[index]} ${words[index + 1]} ${word}`));
  const [left, right] = [grams(a), grams(b)];
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const gram of smaller) if (larger.has(gram)) shared++;
  return shared / smaller.size;
}

/** Each later paragraph that repeats an earlier one in the same file. */
export function duplicateParagraphs(file: string, text: string): string[] {
  const long = paragraphs(text).filter((paragraph) => paragraph.words.length >= MIN_WORDS);
  const problems: string[] = [];
  long.forEach((paragraph, index) => {
    const earlier = long
      .slice(0, index)
      .find((other) => overlap(other.words, paragraph.words) >= OVERLAP);
    if (earlier !== undefined) {
      problems.push(`${file}:${paragraph.line}: repeats the paragraph at line ${earlier.line}.`);
    }
  });
  return problems;
}

function git(root: string, ...args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one the hook or CI runs.
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

/**
 * Each package's version from its package.json. The version pull request
 * carries the new versions and the docs sync-versions.ts rewrote together, so
 * between releases this is the newest published version.
 */
export function packageVersions(root: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const dir of readdirSync(join(root, "packages"))) {
    const manifest = join(root, "packages", dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, version } = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, string>;
    if (name !== undefined && version !== undefined) versions.set(name, version);
  }
  return versions;
}

/** Where the plugin's MCP server config lives, relative to the root. */
export const MCP_CONFIG = "plugins/maple/.mcp.json";

/** Every `@maple-kit/mcp@x.y.z` pin in `text`, as `{ index, version }`. */
export function mcpPins(text: string): { index: number; version: string }[] {
  return [...text.matchAll(/@maple-kit\/mcp@(\d+\.\d+\.\d+)/g)].map((match) => ({
    index: match.index + match[0].length - (match[1] ?? "").length,
    version: match[1] ?? "",
  }));
}

/** A problem for each MCP pin in the plugin config that is not `current`. */
export function stalePins(text: string, current: string | undefined): string[] {
  if (current === undefined) return [];
  return mcpPins(text)
    .filter((pin) => pin.version !== current)
    .map((pin) => `${MCP_CONFIG}: pins @maple-kit/mcp@${pin.version}, not ${current}.`);
}

/** Markdown this check reads: all of it except changelogs and vendored skills. */
export function isChecked(file: string): boolean {
  return file.endsWith(".md") && !file.endsWith("CHANGELOG.md") && !file.startsWith(".agents/");
}

/** Every Markdown file git knows under `root` that this check reads. */
export function markdownFiles(root: string): string[] {
  return git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter((file) => isChecked(file) && existsSync(join(root, file)));
}

/** Runs every guard on `root`. */
export function checkRepository(root: string): string[] {
  const current = packageVersions(root);
  const config = join(root, MCP_CONFIG);
  const pins = existsSync(config)
    ? stalePins(readFileSync(config, "utf8"), current.get("@maple-kit/mcp"))
    : [];
  return [
    ...pins,
    ...markdownFiles(root).flatMap((file) => {
      const text = readFileSync(join(root, file), "utf8");
      return [...staleVersions(file, text, current), ...duplicateParagraphs(file, text)];
    }),
  ];
}

function main(): void {
  const problems = checkRepository(fileURLToPath(new URL("../..", import.meta.url)));
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.some((problem) => / is older than |pins @maple-kit/.test(problem))) {
    process.stderr.write("pnpm docs:sync-versions moves every pin to the current version.\n");
  }
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
