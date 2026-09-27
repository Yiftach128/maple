/**
 * Checks that what the docs name exists. Every tracked Markdown file's inline
 * code and relative links are read, and each reference that looks like code
 * is resolved against an index built from the repository: env var names and
 * identifiers against every word in the non-Markdown files, `@maple-kit/*`
 * imports against each package's exports, paths and links against the files
 * git tracks. Unknown env vars, imports, paths and links fail; unknown
 * identifiers only warn. allowlist.json holds intentional prose, with reasons.
 * Run it as `node tools/doc-references/check.ts`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/** What a reference is taken to be; only `identifier` never blocks. */
export type Kind = "env" | "identifier" | "import" | "link" | "path";

/** One reference in one document. */
export interface Reference {
  file: string;
  kind: Kind;
  line: number;
  text: string;
}

/** What references resolve against. */
export interface ReferenceIndex {
  /** Every tracked directory, relative to the root, no trailing slash. */
  dirs: ReadonlySet<string>;
  /** Every tracked file, relative to the root. */
  files: ReadonlySet<string>;
  /** Every `@maple-kit/<name>[/<subpath>]` a package's exports allow. */
  imports: ReadonlySet<string>;
  /** Every word in every tracked file that is not Markdown. */
  words: ReadonlySet<string>;
}

const EXTENSIONS =
  "(?:ts|tsx|js|mjs|cjs|json|md|yml|yaml|css|html|sh|svg|png|gif|webm|mp4|toml|txt)";
const BARE_FILE = new RegExp(String.raw`^\.?[\w-]+(?:\.[\w-]+)*\.${EXTENSIONS}$`);
const ENV = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const IMPORT = /^@maple-kit\/[a-z-]+(?:\/[a-z-]+)*(?:@[\w.-]+)?$/;
const IDENTIFIER = /^(?:[a-z][a-z0-9]*|[A-Z][a-z0-9]+)[A-Z][A-Za-z0-9]*(?:\(\))?$/;
const PATH = /^\.{0,2}\/?[\w.@-]+(?:\/[\w.@-]+)+\/?(?::\d+)?$/;

/** The kind of an inline code span, or undefined when it is not checked. */
export function classify(span: string, roots: ReadonlySet<string>): Kind | undefined {
  if (ENV.test(span)) return "env";
  if (IMPORT.test(span)) return "import";
  if (IDENTIFIER.test(span)) return "identifier";
  if (BARE_FILE.test(span)) return "path";
  if (PATH.test(span) && roots.has(span.replace(/^\.\//, "").split("/")[0] ?? "")) return "path";
  return undefined;
}

/** Every checked reference in one document, skipping fenced code. */
export function extractReferences(
  file: string,
  text: string,
  roots: ReadonlySet<string>,
): Reference[] {
  const found: Reference[] = [];
  let fence: string | undefined;
  text.split("\n").forEach((content, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(content)?.[1];
    if (marker !== undefined && (fence === undefined || marker.startsWith(fence))) {
      fence = fence === undefined ? marker : undefined;
      return;
    }
    if (fence !== undefined) return;
    const line = index + 1;
    for (const span of inlineCode(content)) {
      const kind = classify(span, roots);
      if (kind !== undefined) found.push({ file, kind, line, text: span });
    }
    for (const target of linkTargets(content))
      found.push({ file, kind: "link", line, text: target });
  });
  return found;
}

/** One block of prose: consecutive non-blank lines outside fenced code and headings. */
export interface Paragraph {
  end: number;
  file: string;
  references: Reference[];
  start: number;
  text: string;
}

/** Every paragraph in one document, each with the references on its lines. */
export function extractParagraphs(
  file: string,
  text: string,
  roots: ReadonlySet<string>,
): Paragraph[] {
  const references = extractReferences(file, text, roots);
  const found: Paragraph[] = [];
  let lines: string[] = [];
  let start = 0;
  const close = (end: number) => {
    if (lines.length > 0) {
      const own = references.filter((one) => one.line >= start && one.line <= end);
      found.push({ end, file, references: own, start, text: lines.join("\n") });
    }
    lines = [];
  };
  let fence: string | undefined;
  text.split("\n").forEach((content, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(content)?.[1];
    const opens = marker !== undefined && (fence === undefined || marker.startsWith(fence));
    if (opens) fence = fence === undefined ? marker : undefined;
    if (opens || fence !== undefined || content.trim() === "" || /^#{1,6}\s/.test(content)) {
      close(index);
      return;
    }
    if (lines.length === 0) start = index + 1;
    lines.push(content);
  });
  close(text.split("\n").length);
  return found;
}

/** The word an env or identifier reference stands for, as the index tokenises code. */
export function nameOf(reference: Reference): string | undefined {
  if (reference.kind === "env") return reference.text;
  return reference.kind === "identifier" ? reference.text.replace(/\(\)$/, "") : undefined;
}

/** Every word in `text`, split the way the index splits code. */
export function wordsIn(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/**
 * Whether a path or link reference names `file` itself, or an import names the
 * package entry or subpath source that holds it. A directory names nothing:
 * `packages/core` reaches every change in it, which says nothing about a paragraph.
 */
export function pointsAt(reference: Reference, file: string): boolean {
  const from = posix.dirname(reference.file);
  switch (reference.kind) {
    case "import":
      return importHolds(reference.text.replace(/(?<=.)@[\w.-]+$/, ""), file);
    case "link": {
      const target = decodeURI(reference.text.split("#")[0] ?? "");
      return target !== "" && posix.normalize(posix.join(from, target)) === file;
    }
    case "path": {
      const path = reference.text.replace(/:\d+$/, "").replace(/\/$/, "").replace(/^\.\//, "");
      const local = posix.normalize(posix.join(from, path));
      return path === file || local === file || file.endsWith(`/${path}`);
    }
    default:
      return false;
  }
}

function holds(target: string, file: string): boolean {
  const dir = target.replace(/\/$/, "");
  return dir !== "" && dir !== "." && (file === dir || file.startsWith(`${dir}/`));
}

/** A bare package holds its manifest and entry; a subpath holds its own source. */
function importHolds(specifier: string, file: string): boolean {
  const match = /^@maple-kit\/([a-z-]+)(?:\/(.+))?$/.exec(specifier);
  if (match === null) return false;
  const root = `packages/${match[1] ?? ""}`;
  const sub = match[2];
  if (sub === undefined) return file === `${root}/package.json` || file === `${root}/src/index.ts`;
  const source = `${root}/src/${sub}`;
  return holds(source, file) || file === `${source}.ts` || file === `${source}.tsx`;
}

/** The contents of each single-backtick code span on a line. */
function inlineCode(line: string): string[] {
  return [...line.matchAll(/(?<!`)`([^`]+)`(?!`)/g)].map((match) => (match[1] ?? "").trim());
}

/** Relative targets of inline and reference-style Markdown links on a line. */
function linkTargets(line: string): string[] {
  const inline = [...line.matchAll(/\]\(([^()\s]+)\)/g)].map((match) => match[1] ?? "");
  const reference = /^\s*\[[^\]]+\]:\s+(\S+)/.exec(line)?.[1];
  const all = reference === undefined ? inline : [...inline, reference];
  return all.filter((target) => !/^(?:[a-z]+:|#|\/)/i.test(target) && target !== "");
}

/** Whether `reference` names something in `index`. */
export function resolves(reference: Reference, index: ReferenceIndex): boolean {
  switch (reference.kind) {
    case "env":
      return index.words.has(reference.text);
    case "identifier":
      return index.words.has(reference.text.replace(/\(\)$/, ""));
    case "import":
      return index.imports.has(reference.text.replace(/(?<=.)@[\w.-]+$/, ""));
    case "link":
      return linkResolves(reference, index);
    case "path":
      return pathResolves(reference, index);
  }
}

function linkResolves(reference: Reference, index: ReferenceIndex): boolean {
  const target = decodeURI(reference.text.split("#")[0] ?? "");
  if (target === "") return true;
  const path = posix
    .normalize(posix.join(posix.dirname(reference.file), target))
    .replace(/\/$/, "");
  return index.files.has(path) || index.dirs.has(path);
}

function pathResolves(reference: Reference, index: ReferenceIndex): boolean {
  const path = reference.text.replace(/:\d+$/, "").replace(/\/$/, "").replace(/^\.\//, "");
  const local = posix.normalize(posix.join(posix.dirname(reference.file), path));
  if ([path, local].some((candidate) => index.files.has(candidate) || index.dirs.has(candidate))) {
    return true;
  }
  const suffix = `/${path}`;
  const within = (entries: ReadonlySet<string>) =>
    [...entries].some((entry) => entry.endsWith(suffix));
  return within(index.files) || within(index.dirs);
}

/** The outcome of a run: blocking errors and advisory warnings, as lines. */
export interface CheckResult {
  errors: string[];
  warnings: string[];
}

/** Resolves every reference, dropping those `allow` names. */
export function checkReferences(
  references: readonly Reference[],
  index: ReferenceIndex,
  allow: ReadonlySet<string>,
): CheckResult {
  const result: CheckResult = { errors: [], warnings: [] };
  const used = new Set<string>();
  for (const reference of references) {
    if (allow.has(reference.text)) used.add(reference.text);
    if (allow.has(reference.text) || resolves(reference, index)) continue;
    const line = `${reference.file}:${reference.line}: unknown ${LABELS[reference.kind]} \`${reference.text}\``;
    (reference.kind === "identifier" ? result.warnings : result.errors).push(line);
  }
  for (const entry of allow) {
    if (!used.has(entry))
      result.errors.push(`allowlist.json: \`${entry}\` is in no doc; remove it.`);
  }
  return result;
}

const LABELS: Record<Kind, string> = {
  env: "environment variable or constant",
  identifier: "identifier",
  import: "import path",
  link: "link target",
  path: "file path",
};

/** `@maple-kit/<name>` and each subpath, from one package.json's exports. */
export function importsOf(manifest: { exports?: unknown; name: string }): string[] {
  const exports = manifest.exports;
  if (typeof exports !== "object" || exports === null) return [manifest.name];
  return Object.keys(exports).map((key) =>
    key === "." ? manifest.name : `${manifest.name}/${key.replace(/^\.\//, "")}`,
  );
}

function git(root: string, ...args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one the hook or CI runs.
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const TEXT = new Set([
  "ts",
  "tsx",
  "js",
  "mjs",
  "cjs",
  "json",
  "yml",
  "yaml",
  "sh",
  "css",
  "html",
  "toml",
  "example",
]);

/** Whether `file` is text worth indexing: source, config or a dotfile. */
function isIndexed(file: string): boolean {
  if (file.endsWith("pnpm-lock.yaml")) return false;
  const base = posix.basename(file);
  return TEXT.has(base.slice(base.lastIndexOf(".") + 1)) || /^\.[\w-]+$/.test(base);
}

/** Builds the index from what git tracks under `root`. */
export function buildIndex(root: string, files: readonly string[]): ReferenceIndex {
  const dirs = new Set<string>();
  for (const file of files) {
    for (let dir = posix.dirname(file); dir !== "."; dir = posix.dirname(dir)) dirs.add(dir);
  }
  const words = new Set<string>();
  const imports = new Set<string>();
  for (const file of files) {
    if (!isIndexed(file)) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (const word of wordsIn(text)) words.add(word);
    if (/^packages\/[^/]+\/package\.json$/.test(file)) {
      for (const name of importsOf(JSON.parse(text) as { name: string })) imports.add(name);
    }
  }
  return { dirs, files: new Set(files), imports, words };
}

/** Markdown this check reads: all of it except changelogs and vendored skills. */
export function isChecked(file: string): boolean {
  return file.endsWith(".md") && !file.endsWith("CHANGELOG.md") && !file.startsWith(".agents/");
}

/** Files git knows under `root`: tracked, or new and not ignored, and present. */
export function repositoryFiles(root: string): string[] {
  return git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(root, file)));
}

/** Runs the whole check on `root`, with the allowlist beside this file. */
export function checkRepository(root: string): CheckResult & { references: number } {
  const files = repositoryFiles(root);
  const roots = new Set([...files.map((file) => file.split("/")[0] ?? ""), "src", "test"]);
  const allowlist = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "allowlist.json"), "utf8"),
  ) as Record<string, string>;
  const references = files
    .filter(isChecked)
    .flatMap((file) => extractReferences(file, readFileSync(join(root, file), "utf8"), roots));
  const result = checkReferences(
    references,
    buildIndex(root, files),
    new Set(Object.keys(allowlist)),
  );
  return { ...result, references: references.length };
}

function main(): void {
  const { errors, references, warnings } = checkRepository(
    fileURLToPath(new URL("../..", import.meta.url)),
  );
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.stderr.write(
    `${references} references, ${errors.length} unknown, ${warnings.length} unknown identifiers (warnings).\n`,
  );
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
