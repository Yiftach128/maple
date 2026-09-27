import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkChangesets, checkRepository, isDocs, parseChangeset } from "./check.js";

const PACKAGES = { "@maple-kit/cli": "packages/cli", "@maple-kit/core": "packages/core" };

const changeset = (bumps: Record<string, string>): string =>
  `---\n${Object.entries(bumps)
    .map(([name, bump]) => `"${name}": ${bump}`)
    .join("\n")}\n---\n\nWhy.\n`;

const modified = (...paths: string[]) => paths.map((path) => ({ path, status: "M" }));

describe("isDocs", () => {
  it.each([
    ["README.md", true],
    ["packages/core/README.md", true],
    ["docs/assets/logo.svg", true],
    [".claude/skills/contribute-connector/SKILL.md", true],
    [".claude/skills/maple-review", true],
    ["plugins/maple/skills/maple-review/SKILL.md", true],
    ["plugins/maple/.mcp.json", false],
    ["plugins/maple/.claude-plugin/plugin.json", false],
    [".changeset/foo.md", false],
    ["packages/core/src/index.ts", false],
  ])("%s → %s", (path, expected) => {
    expect(isDocs(path)).toBe(expected);
  });
});

describe("parseChangeset", () => {
  it.each<[string, string, Record<string, string>]>([
    ["double quotes", changeset({ "@maple-kit/core": "minor" }), { "@maple-kit/core": "minor" }],
    ["single quotes", "---\n'@maple-kit/cli': patch\n---\n", { "@maple-kit/cli": "patch" }],
    ["two packages", changeset(PACKAGES), PACKAGES],
    ["empty front matter", "---\n---\n\nNothing.\n", {}],
    ["no front matter", "Just prose.\n", {}],
  ])("%s", (_case, text, expected) => {
    expect(Object.fromEntries(parseChangeset(text))).toEqual(expected);
  });
});

describe("checkChangesets", () => {
  it.each<{
    case: string;
    changesets: Record<string, string>;
    files: string[];
    problems: RegExp[];
  }>([
    {
      case: "a docs-only change with no changeset",
      changesets: {},
      files: ["README.md", "docs/gate.md", "plugins/maple/skills/maple-review/SKILL.md"],
      problems: [],
    },
    {
      case: "a code change with a minor changeset",
      changesets: { ".changeset/a.md": changeset({ "@maple-kit/core": "minor" }) },
      files: ["packages/core/src/index.ts", "packages/core/README.md", ".changeset/a.md"],
      problems: [],
    },
    {
      case: "a changeset and nothing else",
      changesets: { ".changeset/a.md": changeset({ "@maple-kit/core": "patch" }) },
      files: [".changeset/a.md"],
      problems: [],
    },
    {
      case: "a docs-only change with a patch changeset",
      changesets: { ".changeset/a.md": changeset({ "@maple-kit/core": "patch" }) },
      files: ["packages/core/README.md", ".changeset/a.md"],
      problems: [/^\.changeset\/a\.md: every other changed file is documentation/],
    },
    {
      case: "a skill-only change with a changeset",
      changesets: { ".changeset/a.md": changeset({ "@maple-kit/mcp": "minor" }) },
      files: ["plugins/maple/skills/maple-review/SKILL.md", ".changeset/a.md"],
      problems: [/docs-only change ships no changeset/],
    },
    {
      case: "a minor bump on a package whose only change is its README",
      changesets: {
        ".changeset/a.md": changeset({ "@maple-kit/cli": "minor", "@maple-kit/core": "minor" }),
      },
      files: ["packages/core/src/index.ts", "packages/cli/README.md", ".changeset/a.md"],
      problems: [
        /^\.changeset\/a\.md: bumps @maple-kit\/cli minor, but every file changed in packages\/cli\//,
      ],
    },
    {
      case: "a major bump on a package whose only change is docs",
      changesets: { ".changeset/b.md": changeset({ "@maple-kit/cli": "major" }) },
      files: ["packages/core/src/x.ts", "packages/cli/README.md", ".changeset/b.md"],
      problems: [/bumps @maple-kit\/cli major/],
    },
    {
      case: "a patch bump on a package whose only change is docs",
      changesets: { ".changeset/a.md": changeset({ "@maple-kit/cli": "patch" }) },
      files: ["packages/core/src/x.ts", "packages/cli/README.md", ".changeset/a.md"],
      problems: [],
    },
    {
      case: "a minor bump on a package the diff does not touch",
      changesets: { ".changeset/a.md": changeset({ "@maple-kit/cli": "minor" }) },
      files: ["packages/core/src/x.ts", ".changeset/a.md"],
      problems: [],
    },
  ])("$case", ({ changesets, files, problems }) => {
    const found = checkChangesets({ changesets, files: modified(...files), packageDirs: PACKAGES });
    expect(found).toHaveLength(problems.length);
    problems.forEach((pattern, index) => {
      expect(found[index]).toMatch(pattern);
    });
  });
});

describe("checkRepository", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function repository(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maple-changeset-level-"));
    roots.push(root);
    const git = (...args: string[]) =>
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- the test drives the same git.
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
    const commit = async (tree: Record<string, string>, message: string) => {
      for (const [path, text] of Object.entries(tree)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }
      git("add", "-A");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", message);
    };
    git("init", "-q", "-b", "main");
    await commit({ "packages/core/package.json": '{"name":"@maple-kit/core"}' }, "base");
    git("switch", "-qc", "topic");
    await commit(files, "topic");
    return root;
  }

  it("fails a docs-only branch that adds a changeset", async () => {
    const root = await repository({
      ".changeset/a.md": changeset({ "@maple-kit/core": "patch" }),
      "packages/core/README.md": "# core\n",
    });
    expect(checkRepository(root, "main")).toEqual([
      expect.stringMatching(/^\.changeset\/a\.md: every other changed file is documentation/),
    ]);
  });

  it("passes a code branch that adds a changeset", async () => {
    const root = await repository({
      ".changeset/a.md": changeset({ "@maple-kit/core": "minor" }),
      "packages/core/src/index.ts": "export {};\n",
    });
    expect(checkRepository(root, "main")).toEqual([]);
  });
});
