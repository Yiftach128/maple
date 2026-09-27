import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkSkillLinks, expectedTarget, PLUGIN_SKILLS, PROJECT_SKILLS } from "./check.js";

/** One entry in a fixture tree: a plugin skill, a project directory or a link. */
type Entry =
  | { kind: "link"; name: string; target: string }
  | { kind: "plugin"; name: string }
  | { kind: "project-dir"; name: string }
  | { kind: "project-file"; name: string };

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(entries: readonly Entry[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "maple-skill-links-"));
  roots.push(root);
  await mkdir(join(root, PROJECT_SKILLS), { recursive: true });
  for (const entry of entries) await create(root, entry);
  return root;
}

async function create(root: string, entry: Entry): Promise<void> {
  const project = join(root, PROJECT_SKILLS, entry.name);
  if (entry.kind === "plugin") {
    await mkdir(join(root, PLUGIN_SKILLS, entry.name), { recursive: true });
    await writeFile(join(root, PLUGIN_SKILLS, entry.name, "SKILL.md"), "---\nname: x\n---\n");
  } else if (entry.kind === "link") {
    await symlink(entry.target, project);
  } else if (entry.kind === "project-dir") {
    await mkdir(project, { recursive: true });
  } else {
    await writeFile(project, "");
  }
}

const plugin = (name: string): Entry => ({ kind: "plugin", name });
const link = (name: string, target = expectedTarget(name)): Entry => ({
  kind: "link",
  name,
  target,
});

describe("checkSkillLinks", () => {
  it.each<{ case: string; entries: Entry[]; problems: RegExp[] }>([
    {
      case: "every plugin skill linked",
      entries: [plugin("a"), plugin("b"), link("a"), link("b")],
      problems: [],
    },
    {
      case: "no plugin skills and no project skills",
      entries: [],
      problems: [],
    },
    {
      case: "a contributor skill as a real directory beside the links",
      entries: [plugin("a"), link("a"), { kind: "project-dir", name: "contributor" }],
      problems: [],
    },
    {
      case: "a working link to somewhere other than the plugin",
      entries: [
        { kind: "project-dir", name: "vendored" },
        { kind: "link", name: "other", target: "vendored" },
      ],
      problems: [],
    },
    {
      case: "(a) a plugin skill with no link",
      entries: [plugin("a"), plugin("b"), link("a")],
      problems: [/^\.claude\/skills\/b is missing\..*ln -s \.\.\/\.\.\/plugins\/maple\/skills\/b/],
    },
    {
      case: "(b) a link pointing at another directory",
      entries: [plugin("a"), { kind: "project-dir", name: "x" }, link("a", "x")],
      problems: [/^\.claude\/skills\/a points at x, not \.\.\/\.\.\/plugins\/maple\/skills\/a\.$/],
    },
    {
      case: "(b) an absolute link, which resolves on one machine only",
      entries: [plugin("a"), { kind: "link", name: "a", target: "/abs/plugins/maple/skills/a" }],
      problems: [
        /points at \/abs\/plugins\/maple\/skills\/a, not/,
        /a is a symlink that points at nothing/,
      ],
    },
    {
      case: "(c) a real directory shadowing a plugin skill",
      entries: [plugin("a"), { kind: "project-dir", name: "a" }],
      problems: [/^\.claude\/skills\/a is a real directory and shadows the plugin skill\./],
    },
    {
      case: "(c) a real file shadowing a plugin skill",
      entries: [plugin("a"), { kind: "project-file", name: "a" }],
      problems: [/^\.claude\/skills\/a is a real file and shadows/],
    },
    {
      case: "(d) a dangling link that is not a plugin skill",
      entries: [{ kind: "link", name: "gone", target: "../../nowhere" }],
      problems: [/^\.claude\/skills\/gone is a symlink that points at nothing\.$/],
    },
    {
      case: "(d) a link left behind after its plugin skill was removed",
      entries: [link("removed")],
      problems: [/^\.claude\/skills\/removed is a symlink that points at nothing\.$/],
    },
    {
      case: "every failure at once",
      entries: [
        plugin("missing"),
        plugin("elsewhere"),
        plugin("shadowed"),
        { kind: "project-dir", name: "shadowed" },
        { kind: "project-dir", name: "x" },
        link("elsewhere", "x"),
        { kind: "link", name: "gone", target: "nowhere" },
      ],
      problems: [
        /elsewhere points at x/,
        /missing is missing/,
        /shadowed is a real directory/,
        /gone is a symlink/,
      ],
    },
  ])("$case", async ({ entries, problems }) => {
    const found = await checkSkillLinks(await fixture(entries));
    expect(found).toHaveLength(problems.length);
    problems.forEach((pattern, index) => {
      expect(found[index]).toMatch(pattern);
    });
  });

  it("reports nothing when neither directory exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "maple-skill-links-"));
    roots.push(root);
    await expect(checkSkillLinks(root)).resolves.toEqual([]);
  });

  it("passes on this repository", async () => {
    const root = join(import.meta.dirname, "../..");
    await expect(checkSkillLinks(root)).resolves.toEqual([]);
  });
});
