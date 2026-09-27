import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { IGNORE } from "./check.js";
import { bumpManifest, bumpPatch, syncPins, syncProse, syncRepository } from "./sync-versions.js";

const CURRENT = new Map([
  ["@maple-kit/cli", "0.13.0"],
  ["@maple-kit/mcp", "0.13.0"],
]);

describe("syncProse", () => {
  it.each<[string, string, string]>([
    ["an attached pin", "`npx @maple-kit/cli@0.12.0 setup`", "`npx @maple-kit/cli@0.13.0 setup`"],
    ["a version beside the name", "@maple-kit/mcp since 0.9.1.", "@maple-kit/mcp since 0.13.0."],
    [
      "two pins on one line, one current",
      "@maple-kit/cli@0.12.0 and @maple-kit/mcp@0.13.0",
      "@maple-kit/cli@0.13.0 and @maple-kit/mcp@0.13.0",
    ],
    ["a newer version, left alone", "@maple-kit/cli@0.14.0", "@maple-kit/cli@0.14.0"],
    ["no package near it", "released in 0.9.0", "released in 0.9.0"],
    ["an ignored line", `@maple-kit/cli@0.1.0 ${IGNORE}`, `@maple-kit/cli@0.1.0 ${IGNORE}`],
    ["a fenced block", "```\n@maple-kit/cli@0.1.0\n```", "```\n@maple-kit/cli@0.1.0\n```"],
    ["a later line", "intro\n\n@maple-kit/cli@0.9.0", "intro\n\n@maple-kit/cli@0.13.0"],
  ])("%s", (_case, text, expected) => {
    expect(syncProse(text, CURRENT)).toBe(expected);
  });
});

describe("syncPins", () => {
  it.each<[string, string]>([
    ['"@maple-kit/mcp@0.12.0"', '"@maple-kit/mcp@0.13.0"'],
    [
      '"@maple-kit/mcp@0.9.0", "@maple-kit/mcp@0.9.0"',
      '"@maple-kit/mcp@0.13.0", "@maple-kit/mcp@0.13.0"',
    ],
    ['"@maple-kit/mcp"', '"@maple-kit/mcp"'],
  ])("%s", (text, expected) => {
    expect(syncPins(text, "0.13.0")).toBe(expected);
  });
});

describe("bumpPatch", () => {
  it.each([
    ["0.12.0", "0.12.1"],
    ["0.12.9", "0.12.10"],
    ["1.0.0", "1.0.1"],
  ])("%s → %s", (version, expected) => {
    expect(bumpPatch(version)).toBe(expected);
  });

  it("bumps only the manifest's version field", () => {
    expect(bumpManifest('{\n  "name": "maple",\n  "version": "0.12.1"\n}\n')).toBe(
      '{\n  "name": "maple",\n  "version": "0.12.2"\n}\n',
    );
  });
});

describe("syncRepository", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function repository(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maple-sync-versions-"));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the test drives the same git.
    execFileSync("git", ["init", "-q"], { cwd: root });
    return root;
  }

  const base = {
    "packages/cli/package.json": '{ "name": "@maple-kit/cli", "version": "0.13.0" }',
    "packages/mcp/package.json": '{ "name": "@maple-kit/mcp", "version": "0.13.0" }',
    "plugins/maple/.claude-plugin/plugin.json": '{\n  "name": "maple",\n  "version": "0.12.1"\n}\n',
    "plugins/maple/.mcp.json": '{ "args": ["-p", "@maple-kit/mcp@0.12.0"] }\n',
    "plugins/maple/hooks/hooks.json": '{ "command": "npx -y -p @maple-kit/mcp@0.12.0 hook" }\n',
  };

  it("moves the docs, the MCP pins and the plugin version together", async () => {
    const root = await repository({
      ...base,
      "docs/a.md": "Run `npx @maple-kit/cli@0.12.0`.\n",
      "plugins/maple/skills/s/SKILL.md": "Use `@maple-kit/cli@0.12.0`.\n",
    });
    const written = await syncRepository(root);
    expect(written.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "docs/a.md",
      "plugins/maple/.claude-plugin/plugin.json",
      "plugins/maple/.mcp.json",
      "plugins/maple/hooks/hooks.json",
      "plugins/maple/skills/s/SKILL.md",
    ]);
    expect(await readFile(join(root, "docs/a.md"), "utf8")).toBe(
      "Run `npx @maple-kit/cli@0.13.0`.\n",
    );
    expect(await readFile(join(root, "plugins/maple/.mcp.json"), "utf8")).toContain(
      "@maple-kit/mcp@0.13.0",
    );
    expect(await readFile(join(root, "plugins/maple/hooks/hooks.json"), "utf8")).toContain(
      "@maple-kit/mcp@0.13.0",
    );
    expect(
      await readFile(join(root, "plugins/maple/.claude-plugin/plugin.json"), "utf8"),
    ).toContain('"version": "0.12.2"');
  });

  const pinnedCurrent = {
    "plugins/maple/.mcp.json": '{ "args": ["-p", "@maple-kit/mcp@0.13.0"] }\n',
    "plugins/maple/hooks/hooks.json": '{ "command": "npx -y -p @maple-kit/mcp@0.13.0 hook" }\n',
  };

  it("leaves the plugin version alone when nothing in the plugin moved", async () => {
    const root = await repository({
      ...base,
      "docs/a.md": "Run `npx @maple-kit/cli@0.12.0`.\n",
      ...pinnedCurrent,
    });
    expect(await syncRepository(root)).toEqual(["docs/a.md"]);
  });

  it("writes nothing when everything is current", async () => {
    const root = await repository({ ...base, ...pinnedCurrent });
    expect(await syncRepository(root)).toEqual([]);
  });
});
