/**
 * Keeps documentation-only changes out of releases. A pull request whose every
 * changed file is documentation carries no changeset at all, and a changeset
 * bumping a package minor or major fails when every file it covers in that
 * package is documentation. Compares HEAD with its merge base against the
 * base ref: `node tools/changeset-level/check.ts --base origin/main`.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** One file in the diff, with git's single-letter status (A, M, D, T). */
export interface Change {
  path: string;
  status: string;
}

/** What `checkChangesets` reads: the diff, changeset bodies and package dirs. */
export interface ChangesetInput {
  /** Changeset path to its text, for every changeset the diff adds or edits. */
  changesets: Readonly<Record<string, string>>;
  files: readonly Change[];
  /** Package name to its directory, relative to the root, without a slash. */
  packageDirs: Readonly<Record<string, string>>;
}

/** Whether `path` is a changeset rather than a document. */
export function isChangeset(path: string): boolean {
  return /^\.changeset\/[^/]+\.md$/.test(path) && path !== ".changeset/README.md";
}

/** Whether `path` is documentation: Markdown, docs/, or a skill. */
export function isDocs(path: string): boolean {
  if (isChangeset(path)) return false;
  return (
    path.endsWith(".md") ||
    path.startsWith("docs/") ||
    path.startsWith(".claude/skills/") ||
    /^plugins\/[^/]+\/skills\//.test(path)
  );
}

/** The package-to-bump map in a changeset's front matter. */
export function parseChangeset(text: string): Map<string, string> {
  const bumps = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return bumps;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const colon = line.lastIndexOf(":");
    if (colon === -1) continue;
    const name = line
      .slice(0, colon)
      .trim()
      .replaceAll(/^["']|["']$/g, "");
    bumps.set(name, line.slice(colon + 1).trim());
  }
  return bumps;
}

/** Every problem with the changesets in `input`, empty when there is none. */
export function checkChangesets(input: ChangesetInput): string[] {
  const changed = input.files.filter((file) => !isChangeset(file.path));
  const added = Object.keys(input.changesets).toSorted((a, b) => a.localeCompare(b));
  if (added.length === 0) return [];
  if (changed.length > 0 && changed.every((file) => isDocs(file.path))) {
    return added.map(
      (path) =>
        `${path}: every other changed file is documentation, and a docs-only change ships no changeset. Delete it.`,
    );
  }
  return added.flatMap((path) =>
    releasesOnDocs(input.changesets[path] ?? "", changed, input.packageDirs).map(
      ({ bump, dir, name }) =>
        `${path}: bumps ${name} ${bump}, but every file changed in ${dir}/ is documentation. Remove the entry.`,
    ),
  );
}

/** The minor and major bumps in `text` whose package changed only in docs. */
function releasesOnDocs(
  text: string,
  changed: readonly Change[],
  dirs: Readonly<Record<string, string>>,
): { bump: string; dir: string; name: string }[] {
  const found: { bump: string; dir: string; name: string }[] = [];
  for (const [name, bump] of parseChangeset(text)) {
    const dir = dirs[name];
    if ((bump !== "minor" && bump !== "major") || dir === undefined) continue;
    const covered = changed.filter((file) => file.path.startsWith(`${dir}/`));
    if (covered.length > 0 && covered.every((file) => isDocs(file.path))) {
      found.push({ bump, dir, name });
    }
  }
  return found;
}

/** Files changed between the merge base of `base` and HEAD, in `root`. */
export function changedFiles(root: string, base: string): Change[] {
  const git = (...args: string[]): string =>
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one the hook or CI runs.
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  const fields = git("diff", "--name-status", "--no-renames", "-z", mergeBase, "HEAD")
    .split("\0")
    .filter((field) => field !== "");
  const files: Change[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    files.push({ path: fields[index + 1] ?? "", status: fields[index] ?? "" });
  }
  return files;
}

/** Package name to directory for every packages/<dir>/package.json. */
export function packageDirs(root: string): Record<string, string> {
  const dirs: Record<string, string> = {};
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readFileSync(join(root, "packages", entry.name, "package.json"), "utf8");
    dirs[(JSON.parse(manifest) as { name: string }).name] = `packages/${entry.name}`;
  }
  return dirs;
}

/** Runs the check on `root` against `base`, reading changesets from disk. */
export function checkRepository(root: string, base: string): string[] {
  const files = changedFiles(root, base);
  const changesets: Record<string, string> = {};
  for (const file of files) {
    if (file.status !== "D" && isChangeset(file.path)) {
      changesets[file.path] = readFileSync(join(root, file.path), "utf8");
    }
  }
  return checkChangesets({ changesets, files, packageDirs: packageDirs(root) });
}

function main(): void {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const flag = process.argv.indexOf("--base");
  const base = (flag === -1 ? undefined : process.argv[flag + 1]) ?? "origin/main";
  const problems = checkRepository(root, base);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
