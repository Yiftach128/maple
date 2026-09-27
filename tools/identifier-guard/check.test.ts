import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type AddedLine,
  allowedUsers,
  containsHomePath,
  containsTerm,
  findIdentifiers,
  formatFinding,
  parseAddedLines,
  parseDenylist,
  REDACTED_PATH,
  report,
} from "./check.js";

// Assembled at runtime, so this file does not add the paths it tests for.
const home = (...parts: string[]): string => ["", ...parts].join("/");
const TERM = "acme-internal";
const USERS = allowedUsers();

describe("parseDenylist", () => {
  it.each<[string, string | undefined, string[]]>([
    ["unset", undefined, []],
    ["empty", "", []],
    ["trims and lowercases", "  Acme-Internal \r\nWidgetCo\n", ["acme-internal", "widgetco"]],
    ["drops blanks and comments", "\n# a comment\nacme-internal\n\n", ["acme-internal"]],
  ])("%s", (_case, text, expected) => {
    expect(parseDenylist(text)).toEqual(expected);
  });
});

describe("containsTerm", () => {
  it.each([
    ["exact", "acme-internal", true],
    ["any case", "See ACME-Internal.example for it", true],
    ["in an email address", "ops@acme-internal.example", true],
    ["in a path", "src/acme-internal/index.ts", true],
    ["inside a longer word", "notacme-internals", false],
    ["absent", "nothing to see", false],
    ["second occurrence bounded", "acme-internalx acme-internal", true],
  ])("%s", (_case, text, expected) => {
    expect(containsTerm(text, TERM)).toBe(expected);
  });
});

describe("containsHomePath", () => {
  it.each([
    ["a macOS home", `cd ${home("Users", "jane", "repo")}`, true],
    ["a Linux home", `"cwd": "${home("home", "jane")}"`, true],
    ["a Windows home", ["C:", "Users", "jane", "repo"].join("\\"), true],
    ["the GitHub runner", home("home", "runner", "work"), false],
    ["a placeholder user", home("home", "user", "project"), false],
    ["a placeholder you", home("Users", "you", "repo"), false],
    ["an angle-bracket placeholder", `${home("Users")}/<name>/repo`, false],
    ["a variable", `${home("home")}/$USER`, false],
    ["a URL path", `https://example.com${home("home", "jane")}`, false],
    ["a relative path", "src/home/jane.ts", false],
    ["a placeholder then a real one", `${home("home", "user")} ${home("home", "jane")}`, true],
  ])("%s", (_case, text, expected) => {
    expect(containsHomePath(text, USERS)).toBe(expected);
  });
});

describe("parseAddedLines", () => {
  it("numbers added lines in the new file and skips removals", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -3 +3,2 @@",
      "-old",
      "+new three",
      "+new four",
      "@@ -10,0 +12 @@",
      "+new twelve",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { file: "a.ts", line: 3, text: "new three" },
      { file: "a.ts", line: 4, text: "new four" },
      { file: "a.ts", line: 12, text: "new twelve" },
    ]);
  });

  it("reads an added line starting with ++ as content, not a header", () => {
    const diff = ["diff --git a/a.md b/a.md", "+++ b/a.md", "@@ -0,0 +1 @@", "+++ b/elsewhere"];
    expect(parseAddedLines(diff.join("\n"))).toEqual([
      { file: "a.md", line: 1, text: "++ b/elsewhere" },
    ]);
  });

  it.each([
    ["the lockfile", ["diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml", "+++ b/pnpm-lock.yaml"]],
    ["a deletion", ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ /dev/null"]],
    ["a binary", ["diff --git a/a.png b/a.png", "Binary files /dev/null and b/a.png differ"]],
  ])("skips %s", (_case, header) => {
    const diff = [...header, "@@ -0,0 +1 @@", `+${TERM}`].join("\n");
    expect(parseAddedLines(diff)).toEqual([]);
  });
});

describe("findIdentifiers", () => {
  const line = (text: string, file = "a.ts"): AddedLine => ({ file, line: 7, text });

  const termPath = `docs/${TERM}.md`;

  it.each<[string, AddedLine[], string[], unknown[]]>([
    ["a clean line", [line("const x = 1;")], ["a.ts"], []],
    [
      "a term",
      [line(`host: ${TERM}.example`)],
      ["a.ts"],
      [{ file: "a.ts", line: 7, rule: "denylisted term" }],
    ],
    [
      "a home path",
      [line(home("Users", "jane", "x"))],
      ["a.ts"],
      [{ file: "a.ts", line: 7, rule: "absolute home path" }],
    ],
    [
      "a term in the path, reported once and redacted",
      [line(TERM, termPath), line(home("home", "jane"), termPath)],
      [termPath],
      [{ file: REDACTED_PATH, line: 0, rule: "denylisted term" }],
    ],
    [
      "a term in a binary's path",
      [],
      [`${TERM}.png`],
      [{ file: REDACTED_PATH, line: 0, rule: "denylisted term" }],
    ],
  ])("%s", (_case, lines, paths, expected) => {
    expect(findIdentifiers({ lines, paths }, [TERM], USERS)).toEqual(expected);
  });

  it("checks only home paths without a denylist", () => {
    const lines = [line(TERM, termPath), line(home("home", "jane"), termPath)];
    expect(findIdentifiers({ lines, paths: [termPath] }, [], USERS)).toEqual([
      { file: termPath, line: 7, rule: "absolute home path" },
    ]);
  });
});

describe("formatFinding", () => {
  it.each([
    [
      { file: "a,b.ts", line: 3, rule: "denylisted term" as const },
      "::error file=a%2Cb.ts,line=3::a,b.ts:3: denylisted term",
    ],
    [
      { file: REDACTED_PATH, line: 0, rule: "denylisted term" as const },
      `::error::${REDACTED_PATH}: denylisted term`,
    ],
  ])("%j", (finding, expected) => {
    expect(formatFinding(finding)).toBe(expected);
  });
});

describe("report", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function repository(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maple-identifier-guard-"));
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
    await commit({ "README.md": `# base\n\nMentions ${TERM} before the branch.\n` }, "base");
    git("switch", "-qc", "topic");
    await commit(files, "topic");
    return root;
  }

  it("never prints the term, the matched text or the line", async () => {
    const secretLine = `Deploy to build.${TERM}.example from ${home("Users", "jane")}`;
    const root = await repository({
      "notes.md": `ok\n${secretLine}\n`,
      "pnpm-lock.yaml": `${TERM}\n`,
      [`docs/${TERM}/page.md`]: "fine\n",
    });
    const result = report(root, "main", "HEAD", `# terms\nACME-INTERNAL\n`);
    const output = result.stdout + result.stderr;
    expect(result.exitCode).toBe(1);
    expect(output.toLowerCase()).not.toContain(TERM);
    expect(output).not.toContain("jane");
    expect(result.stderr.split("\n").filter(Boolean)).toEqual([
      `::error::${REDACTED_PATH}: denylisted term`,
      "::error file=notes.md,line=2::notes.md:2: denylisted term",
      "::error file=notes.md,line=2::notes.md:2: absolute home path",
    ]);
  });

  it("ignores terms already on the base, and notes a missing denylist", async () => {
    const root = await repository({ "a.ts": "export const a = 1;\n" });
    expect(report(root, "main", "HEAD", TERM)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "No denylisted identifiers or home paths added.\n",
    });
    expect(report(root, "main", "HEAD").stdout).toMatch(/^::notice::MAPLE_IDENTIFIER_DENYLIST/);
  });

  it("still checks home paths without a denylist", async () => {
    const root = await repository({ "a.ts": `const p = "${home("home", "jane")}";\n` });
    expect(report(root, "main", "HEAD").exitCode).toBe(1);
  });

  it("scans the whole tree when the base is all zeros", async () => {
    const root = await repository({ "a.ts": "export const a = 1;\n" });
    expect(report(root, "0".repeat(40), "HEAD", TERM).stderr).toContain(
      "README.md:3: denylisted term",
    );
  });
});
