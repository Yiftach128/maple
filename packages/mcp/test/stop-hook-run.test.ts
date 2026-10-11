import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCommentStore } from "@maple-kit/core";
import { fileStore } from "@maple-kit/core/local";
import { sampleComment } from "@maple-kit/core/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { git, initRepo, scratch } from "../../core/test/local-repo.js";
import { createGitHubFake } from "../../core/test/msw/github.js";
import { createTestServer, useTestServer } from "../../core/test/msw/server.js";
import { runStopHook } from "../src/stop-hook-run.js";
import { fileBlockCounter } from "../src/stop-hook-session.js";

import type { StopHookPayload } from "../src/stop-hook-session.js";

const github = createGitHubFake("acme", "web");
const server = createTestServer(...github.handlers);
useTestServer(server, { beforeAll, afterEach, afterAll });
beforeEach(() => github.reset());

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const remove of cleanups.splice(0)) remove();
});

/** A repository on `feat/x`, in a directory removed after the test. */
function repo(): string {
  const made = scratch();
  cleanups.push(made.remove);
  const path = initRepo(made.dir);
  git(path, "checkout", "-q", "-b", "feat/x");
  return path;
}

/** A directory that is not a repository. */
function plainDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "maple-stop-run-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function comment(cwd: string, status: "open" | "resolved", branch = "feat/x") {
  const store = createCommentStore(fileStore({ cwd }));
  const stored = await store.append(sampleComment({ branch }));
  if (status === "resolved") await store.setStatus(stored.id, "resolved");
}

function stop(cwd: string, extra: StopHookPayload = {}): StopHookPayload {
  return { cwd, session_id: "session-1", ...extra };
}

const FORGE = { MAPLE_GITHUB_OWNER: "acme", MAPLE_GITHUB_REPO: "web", GITHUB_TOKEN: "t" };

async function run(payload: StopHookPayload, env: Record<string, string> = {}) {
  const counter = fileBlockCounter(plainDir());
  return runStopHook(payload, env, counter);
}

describe("the Stop hook with no forge configured", () => {
  it.each<[string, "open" | "resolved" | "none", boolean]>([
    ["open comments on the branch", "open", true],
    ["only resolved comments", "resolved", false],
    ["a `.maple/` with no comments file", "none", false],
  ])("%s: blocks is %s", async (_name, kind, blocks) => {
    const cwd = repo();
    if (kind === "none") mkdirSync(join(cwd, ".maple", "feat-x"), { recursive: true });
    else await comment(cwd, kind);

    const decision = await run(stop(cwd));

    expect(decision.decision === "block").toBe(blocks);
    if (blocks) expect(decision.reason).toContain("still open");
  });

  it("ignores another branch's open comments", async () => {
    const cwd = repo();
    await comment(cwd, "open", "feat/other");
    expect(await run(stop(cwd))).toEqual({});
  });

  it("reads the main checkout's folder from a worktree of it", async () => {
    const cwd = repo();
    await comment(cwd, "open");
    git(cwd, "checkout", "-q", "main");
    git(cwd, "worktree", "add", "-q", join(cwd, "..", "wt"), "feat/x");

    const decision = await run(stop(join(cwd, "..", "wt")));

    expect(decision.decision).toBe("block");
  });

  it("does nothing, and creates nothing, with no `.maple/` folder", async () => {
    const cwd = repo();
    expect(await run(stop(cwd))).toEqual({});
    expect(existsSync(join(cwd, ".maple"))).toBe(false);
  });

  it("does nothing outside a git repository", async () => {
    const cwd = plainDir();
    mkdirSync(join(cwd, ".maple", "default"), { recursive: true });
    writeFileSync(join(cwd, ".maple", "default", "comments.json"), "not even json");

    expect(await run(stop(cwd))).toEqual({});
  });

  it("does nothing for a stray GITHUB_TOKEN or a `github` store with no repository", async () => {
    const cwd = repo();
    await comment(cwd, "open");
    expect(await run(stop(cwd), { GITHUB_TOKEN: "t", MAPLE_STORE: "github" })).toEqual({});
  });

  it("gives up after the block cap, as it does for a forge", async () => {
    const cwd = repo();
    await comment(cwd, "open");
    const counter = fileBlockCounter(plainDir());

    const decisions = [];
    for (let stops = 0; stops < 9; stops += 1) {
      decisions.push(await runStopHook(stop(cwd, { stop_hook_active: stops > 0 }), {}, counter));
    }

    expect(decisions.filter((decision) => decision.decision === "block")).toHaveLength(8);
    expect(decisions[8]).not.toHaveProperty("decision");
  });
});

describe("the Stop hook with a forge configured", () => {
  it("asks the forge, and does not read `.maple/`", async () => {
    const cwd = repo();
    await comment(cwd, "open");

    const decision = await run(stop(cwd), FORGE);

    expect(decision).toEqual({});
    expect(github.lookups()).toBeGreaterThan(0);
  });

  it("still fails naming the branch when a forge is named and none can be found", async () => {
    await expect(run(stop(plainDir()), FORGE)).rejects.toThrow(/MAPLE_BRANCH/);
  });
});

describe("advisory authors", () => {
  it("does not hold an agent on a lint pin, and still holds it on a human comment", async () => {
    const cwd = repo();
    const store = createCommentStore(fileStore({ cwd }));
    const lint = { id: "maple-lint", name: "Maple lint", provenance: "server" } as const;
    await store.append(sampleComment({ branch: "feat/x", author: lint }));

    expect((await run(stop(cwd))).decision).not.toBe("block");

    await store.append(sampleComment({ branch: "feat/x" }));
    expect((await run(stop(cwd))).decision).toBe("block");
  });
});
