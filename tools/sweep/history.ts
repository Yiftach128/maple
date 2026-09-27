/**
 * The layer-1 checks that read a diff, over what is still actionable rather
 * than one pull request. Each pending changeset is checked against the commit
 * that added it, and the plugin's version against every plugin change since
 * the window's start. A push to main or an admin merge skips the PR's checks.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { checkChangesets, isChangeset, packageDirs } from "../changeset-level/check.ts";
import { checkPluginVersion, PLUGIN_MANIFEST } from "../skill-links/check.ts";

import type { Change } from "../changeset-level/check.ts";

/** `git diff-tree -z --name-status` output as one record per file. */
export function parseNameStatus(output: string): Change[] {
  const fields = output.split("\0").filter((field) => field !== "");
  const files: Change[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    files.push({ path: fields[index + 1] ?? "", status: fields[index] ?? "" });
  }
  return files;
}

/** The plugin manifest's version in a manifest's text, if it has one. */
export function manifestVersion(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return (JSON.parse(text) as { version?: string }).version;
}

/** The changeset-level problems of one pending changeset, against the commit that added it. */
export function checkPendingChangeset(
  root: string,
  path: string,
  dirs: Readonly<Record<string, string>>,
): string[] {
  const sha = git(root, "log", "-1", "--diff-filter=A", "--format=%H", "--", path).trim();
  if (sha === "") return [];
  const files = parseNameStatus(
    git(
      root,
      "diff-tree",
      "--root",
      "--no-commit-id",
      "-r",
      "--name-status",
      "--no-renames",
      "-z",
      sha,
    ),
  );
  const text = readFileSync(join(root, path), "utf8");
  const subject = git(root, "log", "-1", "--format=%h %s", sha).trim();
  return checkChangesets({ changesets: { [path]: text }, files, packageDirs: dirs }).map(
    (problem) => `${problem} (added in ${subject})`,
  );
}

/** The plugin-version problem across every change from `base` to HEAD, if there is one. */
export function checkPluginSince(root: string, base: string): string[] {
  const changed = git(root, "diff", "--name-only", "-z", base, "HEAD")
    .split("\0")
    .filter((file) => file !== "");
  return checkPluginVersion({
    baseVersion: manifestVersion(show(root, `${base}:${PLUGIN_MANIFEST}`)),
    changed,
    headVersion: manifestVersion(show(root, `HEAD:${PLUGIN_MANIFEST}`)),
  });
}

/** Every pending changeset's problems, and the plugin's since `base`. */
export function checkHistory(root: string, base: string): string[] {
  const dirs = packageDirs(root);
  const pending = readdirSync(join(root, ".changeset"))
    .map((name) => `.changeset/${name}`)
    .filter((path) => isChangeset(path))
    .toSorted((a, b) => a.localeCompare(b));
  return [
    ...pending.flatMap((path) => checkPendingChangeset(root, path, dirs)),
    ...checkPluginSince(root, base),
  ];
}

function show(root: string, spec: string): string | undefined {
  try {
    return git(root, "show", spec);
  } catch {
    return undefined;
  }
}

function git(root: string, ...args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one CI runs.
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
