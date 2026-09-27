import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkReferences,
  checkRepository,
  classify,
  extractReferences,
  importsOf,
  isChecked,
} from "./check.js";

import type { Kind, ReferenceIndex } from "./check.js";

const ROOTS = new Set(["docs", "packages", "src", "tools"]);

const INDEX: ReferenceIndex = {
  dirs: new Set(["docs", "packages", "packages/core", "packages/core/src"]),
  files: new Set([
    "README.md",
    "docs/gate.md",
    "packages/core/src/index.ts",
    "packages/core/README.md",
  ]),
  imports: new Set(["@maple-kit/core", "@maple-kit/core/logger"]),
  words: new Set(["MAPLE_PREVIEW", "MOCK_STATES", "createLogger", "CommentStore"]),
};

describe("classify", () => {
  it.each<[string, Kind | undefined]>([
    ["MAPLE_PREVIEW", "env"],
    ["MOCK_STATES", "env"],
    ["CI", undefined],
    ["@maple-kit/core", "import"],
    ["@maple-kit/core/logger", "import"],
    ["@maple-kit/mcp@0.12.0", "import"],
    ["createLogger", "identifier"],
    ["createLogger()", "identifier"],
    ["CommentStore", "identifier"],
    ["list", undefined],
    ["docs/gate.md", "path"],
    ["./docs/gate.md", "path"],
    ["src/index.ts:12", "path"],
    ["CONTRIBUTING.md", "path"],
    [".mcp.json", "path"],
    ["server/router.ts", undefined],
    ["/api/maple", undefined],
    ["docs/<name>.md", undefined],
    ["pnpm lint", undefined],
    ["rest:GET /api/reviews", undefined],
  ])("%s → %s", (span, kind) => {
    expect(classify(span, ROOTS)).toBe(kind);
  });
});

describe("extractReferences", () => {
  it("finds inline code and relative links with their line numbers", () => {
    const text = "# T\n\nSee `MAPLE_PREVIEW` and [gate](docs/gate.md#top).\n[ref]: ./README.md\n";
    expect(extractReferences("x.md", text, ROOTS)).toEqual([
      { file: "x.md", kind: "env", line: 3, text: "MAPLE_PREVIEW" },
      { file: "x.md", kind: "link", line: 3, text: "docs/gate.md#top" },
      { file: "x.md", kind: "link", line: 4, text: "./README.md" },
    ]);
  });

  it.each([
    ["a fenced block", "```sh\n`MAPLE_X`\n```\n"],
    ["a tilde fence", "~~~\n`MAPLE_X`\n~~~\n"],
    ["an external link", "[a](https://example.com/x.md)"],
    ["an anchor", "[a](#section)"],
    ["a mailto", "[a](mailto:x@example.com)"],
    ["a site-absolute link", "[a](/docs/x)"],
    ["a code span in a triple-backtick run", "```ts```"],
  ])("skips %s", (_case, text) => {
    expect(extractReferences("x.md", text, ROOTS)).toEqual([]);
  });
});

describe("checkReferences", () => {
  const check = (text: string, allow: string[] = []) =>
    checkReferences(extractReferences("docs/x.md", text, ROOTS), INDEX, new Set(allow));

  it.each<[string, string, RegExp[]]>([
    ["a known env var", "`MAPLE_PREVIEW`", []],
    [
      "an unknown env var",
      "`MAPLE_PREVEIW`",
      [/^docs\/x\.md:1: unknown environment variable .* `MAPLE_PREVEIW`$/],
    ],
    ["a known import", "`@maple-kit/core/logger`", []],
    ["a versioned import", "`@maple-kit/core@0.12.0`", []],
    [
      "an unknown subpath",
      "`@maple-kit/core/nope`",
      [/unknown import path `@maple-kit\/core\/nope`/],
    ],
    ["a root-relative path", "`packages/core/src/index.ts`", []],
    ["a path with a line", "`packages/core/src/index.ts:3`", []],
    ["a package-relative path", "`src/index.ts`", []],
    ["a directory", "`packages/core/`", []],
    ["a bare file", "`README.md`", []],
    [
      "a missing path",
      "`packages/core/src/gone.ts`",
      [/unknown file path `packages\/core\/src\/gone\.ts`/],
    ],
    ["a missing bare file", "`GONE.md`", [/unknown file path `GONE\.md`/]],
    ["a relative link", "[g](gate.md)", []],
    ["a parent link", "[r](../README.md)", []],
    ["a link to a directory", "[c](../packages/core/)", []],
    ["a broken link", "[g](gaet.md)", [/^docs\/x\.md:1: unknown link target `gaet\.md`$/]],
  ])("%s", (_case, text, errors) => {
    const result = check(text);
    expect(result.errors).toHaveLength(errors.length);
    errors.forEach((pattern, index) => {
      expect(result.errors[index]).toMatch(pattern);
    });
  });

  it("warns, rather than fails, on an unknown identifier", () => {
    expect(check("`createLoger`")).toEqual({
      errors: [],
      warnings: ["docs/x.md:1: unknown identifier `createLoger`"],
    });
  });

  it("lets the allowlist through, and fails an entry nothing uses", () => {
    expect(check("`MAPLE_OTHER`", ["MAPLE_OTHER", "UNUSED_ENTRY"]).errors).toEqual([
      "allowlist.json: `UNUSED_ENTRY` is in no doc; remove it.",
    ]);
  });
});

describe("importsOf", () => {
  it.each<[unknown, string[]]>([
    [undefined, ["@maple-kit/x"]],
    [{ ".": "./dist/index.js" }, ["@maple-kit/x"]],
    [
      { ".": {}, "./logger": {}, "./package.json": "./package.json" },
      ["@maple-kit/x", "@maple-kit/x/logger", "@maple-kit/x/package.json"],
    ],
  ])("%j", (exports, expected) => {
    expect(importsOf({ exports, name: "@maple-kit/x" })).toEqual(expected);
  });
});

describe("isChecked", () => {
  it.each([
    ["docs/gate.md", true],
    ["packages/core/CHANGELOG.md", false],
    [".agents/skills/typesafe-ai/SKILL.md", false],
    ["packages/core/src/index.ts", false],
  ])("%s → %s", (file, expected) => {
    expect(isChecked(file)).toBe(expected);
  });
});

describe("this repository", () => {
  it("has no unknown reference and no stale allowlist entry", () => {
    expect(checkRepository(join(import.meta.dirname, "../..")).errors).toEqual([]);
  });
});
