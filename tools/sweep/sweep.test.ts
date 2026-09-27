import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { spread, summarize } from "../doc-drift/sweep.ts";
import { applyBumps, bumpMessage } from "./bump.ts";
import { manifestVersion, parseNameStatus } from "./history.ts";
import { assess, compareExact, docPinsIn, isBumpable, manifestPins, mcpPinsIn } from "./pins.ts";
import { REGISTRY, registryHandlers } from "./registry.msw.ts";
import { latestVersions } from "./registry.ts";
import { countFindings, MARKER, renderIssue } from "./report.ts";
import { actionPins } from "./run.ts";

import type { Candidate } from "../doc-drift/candidates.ts";
import type { Judged } from "../doc-drift/comment.ts";
import type { Finding, Pin } from "./pins.ts";
import type { Sweep } from "./report.ts";

describe("compareExact", () => {
  it.each([
    ["0.13.0", "0.13.0", 0],
    ["0.12.9", "0.13.0", -1],
    ["0.13.1", "0.13.0", 1],
    ["1.0.0", "0.99.99", 1],
    ["0.10.0", "0.9.0", 1],
    ["1.0.0-beta.1", "1.0.0", -1],
    ["1.0.0", "1.0.0-beta.1", 1],
    ["1.0.0-beta.1", "1.0.0-beta.2", -1],
  ])("%s against %s", (a, b, sign) => {
    expect(Math.sign(compareExact(a, b))).toBe(sign);
  });
});

describe("assess", () => {
  const latest = new Map([
    ["@maple-kit/core", "0.13.0"],
    ["@maple-kit/mcp", "0.13.0"],
  ]);
  const pin = (version: string, name = "@maple-kit/core"): Pin => ({
    file: "README.md",
    fixable: true,
    line: 3,
    name,
    version,
  });

  it.each([
    ["at the latest", pin("0.13.0"), undefined],
    ["behind", pin("0.10.0"), "behind"],
    ["ahead of anything published", pin("0.14.0"), "ahead"],
    ["a caret range", pin("^0.13.0"), "loose"],
    ["a tag", pin("latest"), "loose"],
    ["a package the registry did not answer for", pin("1.0.0", "@maple-kit/gone"), "unknown"],
  ])("a pin %s", (_label, input, status) => {
    expect(assess([input], latest)[0]?.status).toBe(status);
  });

  it("carries the latest version on a behind finding, and bumps only fixable ones", () => {
    const [doc, manifest] = assess([pin("0.10.0"), { ...pin("0.10.0"), fixable: false }], latest);
    expect(doc).toMatchObject({ latest: "0.13.0", status: "behind" });
    expect([doc, manifest].map((finding) => finding !== undefined && isBumpable(finding))).toEqual([
      true,
      false,
    ]);
  });
});

describe("reading pins", () => {
  it("finds each MCP pin in a plugin file with its line", () => {
    const text = '{\n  "args": ["-y", "-p", "@maple-kit/mcp@0.12.0", "maple-mcp"]\n}\n';
    expect(mcpPinsIn("plugins/maple/.mcp.json", text)).toEqual([
      {
        file: "plugins/maple/.mcp.json",
        fixable: true,
        line: 2,
        name: "@maple-kit/mcp",
        version: "0.12.0",
      },
    ]);
  });

  it("finds versions next to a package name in prose, as doc-guards does", () => {
    const text =
      "# Title\n\nInstall `@maple-kit/core@0.12.0` first.\n\n```sh\n@maple-kit/core@0.1.0\n```\n";
    expect(docPinsIn("docs/a.md", text)).toEqual([
      { file: "docs/a.md", fixable: true, line: 3, name: "@maple-kit/core", version: "0.12.0" },
    ]);
  });

  it("reads a manifest's dependencies, skipping workspace links and peer ranges", () => {
    const text = JSON.stringify({
      dependencies: { "@maple-kit/core": "workspace:*", next: "16.3.5" },
      devDependencies: { vite: "^8.0.0" },
      peerDependencies: { react: ">=19" },
    });
    expect(
      manifestPins("examples/a/package.json", text).map((one) => [one.name, one.version]),
    ).toEqual([
      ["next", "16.3.5"],
      ["vite", "^8.0.0"],
    ]);
  });

  it("reads only maple-action's @maple-kit dependencies, as report-only pins", () => {
    const text = JSON.stringify({
      dependencies: { "@maple-kit/core": "0.13.0" },
      devDependencies: { eslint: "10.0.0" },
    });
    expect(actionPins(text)).toEqual([
      { file: "package.json", fixable: false, name: "@maple-kit/core", version: "0.13.0" },
    ]);
  });
});

describe("latestVersions", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it("reads each name's latest dist-tag once", async () => {
    server.use(...registryHandlers({ "@maple-kit/core": "0.13.0", next: "16.4.0" }));
    const latest = await latestVersions(["next", "@maple-kit/core", "next"], {
      registry: `${REGISTRY}/`,
    });
    expect(Object.fromEntries(latest.versions)).toEqual({
      "@maple-kit/core": "0.13.0",
      next: "16.4.0",
    });
    expect(latest.errors).toEqual([]);
  });

  it("records a missing package and a failing registry without throwing", async () => {
    server.use(...registryHandlers({ "@maple-kit/core": "0.13.0" }, ["@maple-kit/mcp"]));
    const latest = await latestVersions(["@maple-kit/core", "@maple-kit/mcp", "@maple-kit/gone"], {
      registry: REGISTRY,
    });
    expect([...latest.versions.keys()]).toEqual(["@maple-kit/core"]);
    expect(latest.errors).toEqual([
      "@maple-kit/gone: the registry answered 404.",
      "@maple-kit/mcp: the registry answered 500.",
    ]);
  });
});

const behind: Finding = {
  file: "plugins/maple/.mcp.json",
  fixable: true,
  latest: "0.13.0",
  line: 5,
  name: "@maple-kit/mcp",
  status: "behind",
  version: "0.12.0",
};

function sweepOf(overrides: Partial<Sweep> = {}): Sweep {
  return {
    action: { findings: [] },
    checks: [
      { command: "node tools/doc-guards/check.ts", name: "doc-guards", ok: true, output: "" },
    ],
    drift: { failed: 0, flagAt: 0.5, flagged: [], judged: 3, unjudged: 0 },
    history: { base: "fedcba9876543210", problems: [] },
    latest: { "@maple-kit/mcp": "0.13.0" },
    pins: [],
    registryErrors: [],
    repository: "maple-kit/maple",
    sha: "0123456789abcdef",
    since: "8 days ago",
    ...overrides,
  };
}

describe("countFindings", () => {
  it.each<[string, Partial<Sweep>, number]>([
    ["a clean run", {}, 0],
    ["a pin behind", { pins: [behind] }, 1],
    ["an unreadable maple-action manifest", { action: { error: "404" } }, 1],
    ["a maple-action pin behind", { action: { findings: [{ ...behind, fixable: false }] } }, 1],
    ["a failed check", { checks: [{ command: "x", name: "x", ok: false, output: "bad" }] }, 1],
    [
      "a pending changeset problem",
      { history: { base: "fedcba9", problems: [".changeset/x.md: delete it"] } },
      1,
    ],
    [
      "a flagged paragraph",
      {
        drift: {
          failed: 0,
          flagAt: 0.5,
          flagged: [
            { end: 3, file: "README.md", reason: "renamed", stale: 0.9, start: 1, via: ["x"] },
          ],
          judged: 1,
          unjudged: 0,
        },
      },
      1,
    ],
  ])("%s", (_label, overrides, expected) => {
    expect(countFindings(sweepOf(overrides))).toBe(expected);
  });
});

describe("renderIssue", () => {
  it("says a clean run found nothing, behind the marker", () => {
    const body = renderIssue(sweepOf());
    expect(body.startsWith(`${MARKER}\n## Weekly sweep at \`0123456\``)).toBe(true);
    expect(body).toContain("Nothing found.");
    expect(body).toContain("Every pin is the latest published version.");
    expect(body).toContain("- doc-guards passed");
  });

  it("links each finding, the bump pull request and the failing check's output", () => {
    const body = renderIssue(
      sweepOf({
        action: {
          findings: [{ ...behind, file: "package.json", fixable: false, line: undefined }],
        },
        checks: [
          {
            command: "node tools/doc-references/check.ts",
            name: "doc-references",
            ok: false,
            output: "README.md:3: gone",
          },
        ],
        drift: {
          failed: 0,
          flagAt: 0.5,
          flagged: [],
          judged: 0,
          skipped: "TYPESAFE_API_KEY is not set.",
          unjudged: 0,
        },
        pins: [behind],
      }),
      { bumpPr: "https://github.com/maple-kit/maple/pull/9", runUrl: "https://example.test/run" },
    );
    expect(body).toContain("3 findings.");
    expect(body).toContain(
      "| [plugins/maple/.mcp.json:5](https://github.com/maple-kit/maple/blob/0123456789abcdef/plugins/maple/.mcp.json#L5) | `@maple-kit/mcp` | `0.12.0` | `0.13.0` | behind |",
    );
    expect(body).toContain("Bump pull request: https://github.com/maple-kit/maple/pull/9.");
    expect(body).toContain("https://github.com/maple-kit/maple-action/blob/main/package.json) |");
    expect(body).toContain("(report only)");
    expect(body).toContain("- doc-references failed");
    expect(body).toContain("```\nREADME.md:3: gone\n```");
    expect(body).toContain("Skipped: TYPESAFE_API_KEY is not set.");
    expect(body).toContain("([this run](https://example.test/run))");
  });

  it("says when the bump job failed, and not when it was skipped", () => {
    const failed = renderIssue(sweepOf({ pins: [behind] }), { bumpResult: "failure" });
    const skipped = renderIssue(sweepOf({ pins: [behind] }), { bumpResult: "skipped" });
    expect(failed).toContain("The bump job ended `failure`");
    expect(skipped).not.toContain("The bump job ended");
  });
});

describe("bump", () => {
  it("names each move once in the commit message", () => {
    const message = bumpMessage([behind, { ...behind, file: "plugins/maple/hooks/hooks.json" }]);
    expect(message.split("\n")[0]).toBe("chore: pin the latest published versions");
    expect(message.match(/- @maple-kit\/mcp 0\.12\.0 -> 0\.13\.0/g)).toHaveLength(1);
  });

  it("moves doc and plugin pins to the latest and patch-bumps the plugin", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-sweep-"));
    try {
      mkdirSync(join(root, "plugins/maple/.claude-plugin"), { recursive: true });
      writeFileSync(
        join(root, "plugins/maple/.mcp.json"),
        '{ "args": ["@maple-kit/mcp@0.12.0"] }\n',
      );
      writeFileSync(
        join(root, "plugins/maple/.claude-plugin/plugin.json"),
        '{ "version": "0.4.1" }\n',
      );
      writeFileSync(join(root, "README.md"), "Pin `@maple-kit/mcp@0.12.0`.\n");
      const readme: Finding = { ...behind, file: "README.md", line: 1 };
      const written = await applyBumps(root, sweepOf({ pins: [behind, readme] }));
      expect(written).toEqual([
        "plugins/maple/.mcp.json",
        "README.md",
        "plugins/maple/.claude-plugin/plugin.json",
      ]);
      expect(readFileSync(join(root, "plugins/maple/.mcp.json"), "utf8")).toContain(
        "@maple-kit/mcp@0.13.0",
      );
      expect(readFileSync(join(root, "README.md"), "utf8")).toBe("Pin `@maple-kit/mcp@0.13.0`.\n");
      expect(
        manifestVersion(
          readFileSync(join(root, "plugins/maple/.claude-plugin/plugin.json"), "utf8"),
        ),
      ).toBe("0.4.2");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("history", () => {
  it("reads name-status records", () => {
    expect(parseNameStatus("M\0README.md\0A\0.changeset/x.md\0")).toEqual([
      { path: "README.md", status: "M" },
      { path: ".changeset/x.md", status: "A" },
    ]);
  });

  it.each([
    [undefined, undefined],
    ["{}", undefined],
    ['{ "version": "0.12.4" }', "0.12.4"],
  ])("manifestVersion(%s) is %s", (text, expected) => {
    expect(manifestVersion(text)).toBe(expected);
  });
});

describe("the jev pass", () => {
  const candidate = (file: string, start = 2) => ({
    hunks: [],
    paragraph: { end: start + 2, file, references: [], start, text: "x" },
    via: ["`x`"],
  });

  it.each([
    [10, ["a.md:1", "b.md:1", "c.md:1", "a.md:5", "b.md:5", "a.md:9"]],
    [4, ["a.md:1", "b.md:1", "c.md:1", "a.md:5"]],
    [0, []],
  ])("spreads a cap of %i across docs, one each in turn", (max, expected) => {
    const all = [
      candidate("a.md", 1),
      candidate("a.md", 5),
      candidate("a.md", 9),
      candidate("b.md", 1),
      candidate("b.md", 5),
      candidate("c.md", 1),
    ] as unknown as Candidate[];
    const taken = spread(all, max).map(
      ({ paragraph }) => `${paragraph.file}:${String(paragraph.start)}`,
    );
    expect(taken).toEqual(expected);
  });

  it("keeps flagged paragraphs, most likely stale first, and counts failures", () => {
    const judged = [
      { candidate: candidate("a.md"), verdict: { reason: "renamed", stale: 0.6 } },
      { candidate: candidate("b.md"), verdict: { reason: "behaviour", stale: 0.95 } },
      { candidate: candidate("c.md"), verdict: { reason: "consistent", stale: 0.1 } },
      { candidate: candidate("d.md"), error: "System One answered 500" },
    ] as unknown as Judged[];
    const summary = summarize(judged, 2, "abc");
    expect(summary.flagged.map((flag) => flag.file)).toEqual(["b.md", "a.md"]);
    expect(summary).toMatchObject({ base: "abc", failed: 1, judged: 4, unjudged: 2 });
  });
});
