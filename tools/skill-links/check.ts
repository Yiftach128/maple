/**
 * Checks where skills live. The plugin copy under plugins/maple/skills is
 * canonical, and .claude/skills/<name> must be a relative symlink to it; any
 * other symlink there must resolve. Every SKILL.md is a plugin skill or on the
 * contributor-only list below. With `--base <ref>`, a change under
 * plugins/maple must also change the plugin's version, since installed copies
 * update only when it does. Exits 1 and names each problem; run it as
 * `node tools/skill-links/check.ts [--base origin/main]`.
 */

import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the plugin's skills live, relative to the repository root. */
export const PLUGIN_SKILLS = "plugins/maple/skills";
/** Where Claude Code loads project skills from, relative to the root. */
export const PROJECT_SKILLS = ".claude/skills";

/** The plugin's directory and manifest, relative to the repository root. */
export const PLUGIN_DIR = "plugins/maple";
export const PLUGIN_MANIFEST = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;

/**
 * Skills for working on this repository, not for a Maple user, so they stay
 * out of the plugin. typesafe-ai is vendored by the skills CLI into
 * .agents/skills and reaches Claude Code through a .claude/skills symlink.
 */
export const CONTRIBUTOR_SKILLS: Readonly<Record<string, string>> = {
  "contribute-connector": ".claude/skills/contribute-connector",
  "typesafe-ai": ".agents/skills/typesafe-ai",
};

/** The one link target a project skill named `name` may have. */
export function expectedTarget(name: string): string {
  return `../../${PLUGIN_SKILLS}/${name}`;
}

/** Every problem with the skill links under `root`, empty when there is none. */
export async function checkSkillLinks(root: string): Promise<string[]> {
  const pluginSkills = await directories(join(root, PLUGIN_SKILLS));
  const problems: string[] = [];
  for (const name of pluginSkills) {
    const problem = await checkPluginSkill(root, name);
    if (problem !== undefined) problems.push(problem);
  }
  for (const name of await dangling(join(root, PROJECT_SKILLS))) {
    problems.push(`${PROJECT_SKILLS}/${name} is a symlink that points at nothing.`);
  }
  return problems;
}

/** Every SKILL.md in `files` that is neither a plugin nor a contributor skill. */
export function checkSkillPlacement(
  files: readonly string[],
  contributors: Readonly<Record<string, string>> = CONTRIBUTOR_SKILLS,
): string[] {
  const skills = files.filter((file) => file === "SKILL.md" || file.endsWith("/SKILL.md"));
  const dirs = new Set(skills.map((file) => file.slice(0, -"/SKILL.md".length)));
  const allowed = new Set(Object.values(contributors));
  const problems: string[] = [];
  for (const dir of [...dirs].toSorted((a, b) => a.localeCompare(b))) {
    if (new RegExp(`^${PLUGIN_SKILLS}/[^/]+$`).test(dir) || allowed.has(dir)) continue;
    problems.push(
      `${dir}/SKILL.md is outside ${PLUGIN_SKILLS}/. Move a user-facing skill there and symlink it; list a contributor-only one in CONTRIBUTOR_SKILLS in tools/skill-links/check.ts.`,
    );
  }
  for (const [name, dir] of Object.entries(contributors)) {
    if (!dirs.has(dir))
      problems.push(`CONTRIBUTOR_SKILLS lists ${name} at ${dir}, which has no SKILL.md.`);
  }
  return problems;
}

/** What `checkPluginVersion` compares: the diff and the version on each side. */
export interface PluginVersionInput {
  /** The manifest's version at the base; undefined when the plugin is new. */
  baseVersion: string | undefined;
  changed: readonly string[];
  headVersion: string | undefined;
}

/** A problem when the plugin changed and its version did not, else nothing. */
export function checkPluginVersion(input: PluginVersionInput): string[] {
  const touched = input.changed.filter((path) => path.startsWith(`${PLUGIN_DIR}/`));
  if (touched.length === 0 || input.baseVersion === undefined) return [];
  if (input.headVersion === undefined) {
    return [`${PLUGIN_MANIFEST} has no version. Installed copies update when it changes; set one.`];
  }
  if (input.headVersion !== input.baseVersion) return [];
  return [
    `${touched.join(", ")} changed but ${PLUGIN_MANIFEST} is still ${input.baseVersion}. Installed copies update only when the version changes; bump it.`,
  ];
}

/** Every tracked or untracked-but-not-ignored file under `root`, from git. */
export function listFiles(root: string): string[] {
  return git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter((file) => file !== "");
}

/** Runs checkPluginVersion on `root` against the merge base with `base`. */
export async function checkPluginVersionAgainst(root: string, base: string): Promise<string[]> {
  const mergeBase = git(root, "merge-base", base, "HEAD").trim();
  const changed = git(root, "diff", "--name-only", "-z", mergeBase)
    .split("\0")
    .filter((file) => file !== "");
  let baseManifest: string | undefined;
  try {
    baseManifest = git(root, "show", `${mergeBase}:${PLUGIN_MANIFEST}`);
  } catch {
    baseManifest = undefined;
  }
  const headManifest = await readFile(join(root, PLUGIN_MANIFEST), "utf8").catch(
    ifMissing(undefined),
  );
  return checkPluginVersion({
    baseVersion: versionOf(baseManifest),
    changed,
    headVersion: versionOf(headManifest),
  });
}

function versionOf(manifest: string | undefined): string | undefined {
  if (manifest === undefined) return undefined;
  return (JSON.parse(manifest) as { version?: string }).version;
}

function git(root: string, ...args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one the hook or CI runs.
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function checkPluginSkill(root: string, name: string): Promise<string | undefined> {
  const path = join(root, PROJECT_SKILLS, name);
  const fix = `ln -s ${expectedTarget(name)} ${PROJECT_SKILLS}/${name}`;
  const entry = await lstat(path).catch(ifMissing(undefined));
  if (entry === undefined) {
    return `${PROJECT_SKILLS}/${name} is missing. Plugin skills are symlinked: ${fix}`;
  }
  if (!entry.isSymbolicLink()) {
    return `${PROJECT_SKILLS}/${name} is a real ${entry.isDirectory() ? "directory" : "file"} and shadows the plugin skill. Remove it, then: ${fix}`;
  }
  const target = await readlink(path);
  if (target !== expectedTarget(name)) {
    return `${PROJECT_SKILLS}/${name} points at ${target}, not ${expectedTarget(name)}.`;
  }
  return undefined;
}

/** Names of the subdirectories of `dir`, sorted; none when it does not exist. */
async function directories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(ifMissing([]));
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((a, b) => a.localeCompare(b));
}

/** Names of the symlinks directly in `dir` whose target does not exist. */
async function dangling(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(ifMissing([]));
  const links = entries.filter((entry) => entry.isSymbolicLink()).map((entry) => entry.name);
  const broken: string[] = [];
  for (const name of links.toSorted((a, b) => a.localeCompare(b))) {
    const resolved = await stat(join(dir, name)).catch(ifMissing(undefined));
    if (resolved === undefined) broken.push(name);
  }
  return broken;
}

/** A catch handler that turns ENOENT into `fallback` and rethrows anything else. */
function ifMissing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  };
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const flag = process.argv.indexOf("--base");
  const base = flag === -1 ? undefined : process.argv[flag + 1];
  const problems = [
    ...(await checkSkillLinks(root)),
    ...checkSkillPlacement(listFiles(root)),
    ...(base === undefined ? [] : await checkPluginVersionAgainst(root, base)),
  ];
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
