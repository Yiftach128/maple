/**
 * Checks that every skill in the Claude Code plugin is also loaded when
 * working in this repository. The plugin copy under plugins/maple/skills is
 * canonical, and .claude/skills/<name> must be a relative symlink to it: not
 * missing, not pointing elsewhere, not a real directory shadowing it. Any
 * other symlink in .claude/skills must resolve. Exits 1 and names each
 * problem; run it as `node tools/skill-links/check.ts`.
 */

import { lstat, readdir, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the plugin's skills live, relative to the repository root. */
export const PLUGIN_SKILLS = "plugins/maple/skills";
/** Where Claude Code loads project skills from, relative to the root. */
export const PROJECT_SKILLS = ".claude/skills";

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
  const problems = await checkSkillLinks(root);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
