import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { extractParagraphs } from "../doc-references/check.ts";
import { findCandidates, literalsIn, spansIn } from "./candidates.ts";
import { isFlagged, MARKER, renderComment } from "./comment.ts";
import { isCode, parseDiff } from "./diff.ts";
import { createJudge, DriftRequestError, stateFor, verdictFrom } from "./judge.ts";
import { judgeAll } from "./run.ts";
import { createSystemOneFake } from "./systemone.msw.ts";

import type { Candidate } from "./candidates.ts";

const DIFF = [
  "diff --git a/packages/mcp/src/config.ts b/packages/mcp/src/config.ts",
  "index 1111111..2222222 100644",
  "--- a/packages/mcp/src/config.ts",
  "+++ b/packages/mcp/src/config.ts",
  "@@ -1,4 +1,4 @@",
  " export function storeFromEnvironment(env) {",
  '-  const token = required(env, "MAPLE_GITHUB_TOKEN");',
  '+  const token = required(env, "GITHUB_TOKEN");',
  "   return token;",
  "diff --git a/docs/old.md b/docs/old.md",
  "deleted file mode 100644",
  "--- a/docs/old.md",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-Gone.",
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
].join("\n");

const ROOTS = new Set(["docs", "packages"]);

describe("parseDiff", () => {
  it("reads each hunk's file, header and changed lines, and skips binaries", () => {
    const hunks = parseDiff(DIFF);
    expect(hunks.map((hunk) => hunk.file)).toEqual(["packages/mcp/src/config.ts", "docs/old.md"]);
    expect(hunks[0]?.header).toBe("@@ -1,4 +1,4 @@");
    expect(hunks[0]?.removed).toEqual(['  const token = required(env, "MAPLE_GITHUB_TOKEN");']);
    expect(hunks[0]?.added).toEqual(['  const token = required(env, "GITHUB_TOKEN");']);
    expect(hunks[0]?.lines).toHaveLength(4);
  });

  it.each([
    ["packages/mcp/src/config.ts", true],
    [".github/workflows/ci.yml", true],
    ["docs/gate.md", false],
    ["pnpm-lock.yaml", false],
    [".changeset/x.md", false],
    ["packages/mcp/test/handlers.test.ts", false],
    ["tools/doc-drift/drift.test.ts", false],
    ["evals/cases/doc-drift/cases.json", false],
  ])("isCode(%s) → %s", (file, expected) => {
    expect(isCode(file)).toBe(expected);
  });
});

describe("findCandidates", () => {
  const hunks = parseDiff(DIFF);
  const candidates = (text: string, file = "docs/configuration.md", touched: string[] = []) =>
    findCandidates(extractParagraphs(file, text, ROOTS), hunks, new Set(touched));

  it.each<[string, string, string[]]>([
    ["an env var on a removed line", "Set `MAPLE_GITHUB_TOKEN`.", ["MAPLE_GITHUB_TOKEN"]],
    ["an env var on an added line", "Set `GITHUB_TOKEN`.", ["GITHUB_TOKEN"]],
    ["a changed file by path", "See `packages/mcp/src/config.ts`.", ["packages/mcp/src/config.ts"]],
    ["an option feeding a variable", "`githubToken` is required.", ["githubToken"]],
    ["a snake_case name the change lacks", "Call `required_env` once.", []],
    ["an untouched name", "Set `MAPLE_BRANCH`.", []],
    ["a directory", "Everything in `packages/mcp/`.", []],
  ])("%s", (_case, text, via) => {
    expect(candidates(text).flatMap((candidate) => candidate.via)).toEqual(via);
  });

  it("ignores a paragraph in a doc the change touches, and a hunk that is prose", () => {
    expect(candidates("Set `MAPLE_GITHUB_TOKEN`.", "docs/x.md", ["docs/x.md"])).toEqual([]);
    expect(candidates("See `docs/old.md`.")).toEqual([]);
  });

  it("ties a quoted state to a string literal, and a common word to nothing", () => {
    expect(spansIn("States: `empty`, `list_comments`, `a`.")).toEqual(["empty", "list_comments"]);
    expect(literalsIn('["empty", "true", `many`]')).toEqual(new Set(["empty"]));
  });
});

describe("verdictFrom", () => {
  it("clamps the probability and names the reason", () => {
    expect(
      verdictFrom({ answers: { reason: { choice: "behaviour" }, stale: { noul: 1.2 } } }),
    ).toEqual({ reason: "behaviour", stale: 1 });
  });

  it.each([
    ["no probability", { answers: { reason: { choice: "renamed" } } }],
    ["an unknown reason", { answers: { reason: { choice: "maybe" }, stale: { noul: 0.4 } } }],
  ])("refuses %s", (_case, response) => {
    expect(() => verdictFrom(response)).toThrow(/System One returned/);
  });
});

const fake = createSystemOneFake();
const server = setupServer(...fake.handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  fake.reset();
});
afterAll(() => server.close());

const STATE = stateFor("docs/x.md", "Set `MAPLE_GITHUB_TOKEN`.", parseDiff(DIFF).slice(0, 1));

describe("createJudge", () => {
  it("sends both questions over one state, with the key as a bearer token", async () => {
    fake.answer(0.8, "renamed");
    const verdict = await createJudge({ apiKey: "test-key" })(STATE);
    expect(verdict).toEqual({ reason: "renamed", stale: 0.8 });
    expect(fake.asked).toHaveLength(1);
    const [asked] = fake.asked;
    expect(asked?.authorization).toBe("Bearer test-key");
    expect(asked?.body.model).toBe("jev-latest");
    expect(Object.keys(asked?.body.questions ?? {})).toEqual(["stale", "reason"]);
    expect(asked?.body.state).toEqual(STATE);
  });

  it("retries an overloaded endpoint, then answers", async () => {
    fake.failNext(529, 2);
    const verdict = await createJudge({ apiKey: "k", retryMs: 1 })(STATE);
    expect(verdict.stale).toBeCloseTo(0.9);
    expect(fake.asked).toHaveLength(3);
  });

  it("gives up on a rejected key at once", async () => {
    fake.failNext(401);
    const judged = createJudge({ apiKey: "bad", retryMs: 1 })(STATE);
    await expect(judged).rejects.toBeInstanceOf(DriftRequestError);
    await expect(judged).rejects.toThrow(/401/);
    expect(fake.asked).toHaveLength(1);
  });
});

describe("judgeAll and renderComment", () => {
  const [paragraph] = extractParagraphs("docs/x.md", "Set `MAPLE_GITHUB_TOKEN`.", ROOTS);
  const candidate: Candidate = {
    hunks: parseDiff(DIFF),
    paragraph: paragraph!,
    via: ["MAPLE_GITHUB_TOKEN"],
  };
  const context = { flagAt: 0.5, repository: "acme/web", sha: "0123456789abcdef", unjudged: 2 };

  it("keeps a failure as an outcome rather than a thrown run", async () => {
    fake.failNext(401);
    const judged = await judgeAll([candidate, candidate], createJudge({ apiKey: "k" }));
    expect(judged.filter((one) => one.error !== undefined)).toHaveLength(1);
    expect(judged.filter((one) => isFlagged(one, 0.5))).toHaveLength(1);
  });

  it("lists what is flagged, linked at the head commit, and says it is advisory", () => {
    const body = renderComment(
      [
        { candidate, verdict: { reason: "renamed", stale: 0.91 } },
        { candidate, verdict: { reason: "consistent", stale: 0.1 } },
        { candidate, error: "System One answered 401" },
      ],
      context,
    );
    expect(body.startsWith(`${MARKER}\n`)).toBe(true);
    expect(body).toContain(
      "| [docs/x.md:1](https://github.com/acme/web/blob/0123456789abcdef/docs/x.md#L1-L1) | 0.91 | names something the change removed or renamed | `MAPLE_GITHUB_TOKEN` |",
    );
    expect(body).not.toContain("0.10");
    expect(body).toContain("1 paragraph could not be judged.");
    expect(body).toContain("2 more paragraphs matched and were not sent.");
    expect(body).toContain("Advisory: this comment blocks nothing.");
  });

  it("says so when nothing is flagged", () => {
    const body = renderComment(
      [{ candidate, verdict: { reason: "unrelated", stale: 0.2 } }],
      context,
    );
    expect(body).toContain("None looks stale.");
  });
});
