import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sampleComment } from "@maple-kit/core/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  currentBranch,
  decideSessionStop,
  fileBlockCounter,
  parseStopHookPayload,
} from "../src/stop-hook-session.js";
import { MAX_BLOCKS } from "../src/stop-hook.js";
import { stopStdin } from "./claude-code-stop.js";

import type { BlockCounter } from "../src/stop-hook-session.js";
import type { Comment } from "@maple-kit/core";

const OPEN: Comment[] = [{ id: "c_1", status: "open", ...sampleComment() }];

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "maple-stop-hook-test-"));
  dirs.push(dir);
  return dir;
}

async function counter(): Promise<{ counter: BlockCounter; dir: string }> {
  const dir = await scratch();
  return { counter: fileBlockCounter(dir), dir };
}

/** One stop as Claude Code sends it: the recorded payload, through the parser. */
function stop(active: boolean, session?: string) {
  return parseStopHookPayload(
    stopStdin({
      stop_hook_active: active,
      ...(session === undefined ? {} : { session_id: session }),
    }),
  );
}

describe("parseStopHookPayload", () => {
  it("reads the fields the hook needs off a recorded Claude Code payload", () => {
    expect(parseStopHookPayload(stopStdin())).toEqual({
      cwd: "/home/user/project",
      session_id: "00000000-0000-4000-8000-000000000001",
      stop_hook_active: false,
    });
  });

  it.each<[string, string]>([
    ["empty stdin", ""],
    ["not JSON", "not json"],
    ["not an object", "[1]"],
    ["fields of the wrong type", '{"session_id": 7, "stop_hook_active": "yes"}'],
  ])("reads nothing from %s", (_case, text) => {
    expect(parseStopHookPayload(text)).toEqual({});
  });
});

describe("decideSessionStop", () => {
  it(`blocks ${String(MAX_BLOCKS)} stops in a row, then lets the session end`, async () => {
    const { counter: blocks } = await counter();
    const decisions = [stop(false), ...Array.from({ length: MAX_BLOCKS }, () => stop(true))].map(
      (payload) => decideSessionStop(OPEN, payload, blocks),
    );

    expect(decisions.slice(0, MAX_BLOCKS).every((d) => d.decision === "block")).toBe(true);
    expect(decisions[MAX_BLOCKS]?.decision).toBeUndefined();
    expect(decisions[MAX_BLOCKS]?.reason).toContain("Letting the session end");
  });

  it("starts counting again on a stop that no block caused", async () => {
    const { counter: blocks } = await counter();
    for (let i = 0; i <= MAX_BLOCKS; i++) decideSessionStop(OPEN, stop(i > 0), blocks);

    expect(decideSessionStop(OPEN, stop(false), blocks).decision).toBe("block");
  });

  it("counts each session on its own", async () => {
    const { counter: blocks } = await counter();
    for (let i = 0; i < MAX_BLOCKS; i++) decideSessionStop(OPEN, stop(i > 0, "a"), blocks);

    expect(decideSessionStop(OPEN, stop(true, "a"), blocks).decision).toBeUndefined();
    expect(decideSessionStop(OPEN, stop(true, "b"), blocks).decision).toBe("block");
  });

  it("forgets a session once nothing is open", async () => {
    const { counter: blocks, dir } = await counter();
    decideSessionStop(OPEN, stop(false), blocks);
    expect(await readdir(dir)).toHaveLength(1);

    expect(decideSessionStop([], stop(true), blocks)).toEqual({});
    expect(await readdir(dir)).toHaveLength(0);
  });

  it("blocks once, then gives up, when there is no session id to count by", async () => {
    const { counter: blocks, dir } = await counter();

    expect(decideSessionStop(OPEN, parseStopHookPayload("{}"), blocks).decision).toBe("block");
    const repeat = parseStopHookPayload('{"stop_hook_active": true}');
    expect(decideSessionStop(OPEN, repeat, blocks).decision).toBeUndefined();
    expect(await readdir(dir)).toHaveLength(0);
  });
});

describe("fileBlockCounter", () => {
  it("keeps a session id that looks like a path inside its directory", async () => {
    const { counter: blocks, dir } = await counter();
    blocks.write("../../escape", 3);

    expect(await readdir(dir)).toHaveLength(1);
    expect(blocks.read("../../escape")).toBe(3);
  });

  it("reads a missing or garbled count as none", async () => {
    const { counter: blocks, dir } = await counter();
    expect(blocks.read("s")).toBe(0);

    blocks.write("s", 2);
    const [file] = await readdir(dir);
    await writeFile(join(dir, file!), "garbage");
    expect(blocks.read("s")).toBe(0);
  });
});

describe("currentBranch", () => {
  async function repository(head: string): Promise<string> {
    const root = await scratch();
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "HEAD"), head);
    return root;
  }

  it("reads the branch from the checkout's HEAD, from any directory in it", async () => {
    const root = await repository("ref: refs/heads/feature/web-482\n");
    await mkdir(join(root, "src", "app"), { recursive: true });

    expect(currentBranch(root)).toBe("feature/web-482");
    expect(currentBranch(join(root, "src", "app"))).toBe("feature/web-482");
  });

  it("follows a worktree's .git file to its own HEAD", async () => {
    const root = await scratch();
    await mkdir(join(root, "main", ".git", "worktrees", "wt"), { recursive: true });
    await writeFile(join(root, "main", ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/wt\n");
    await mkdir(join(root, "wt"));
    await writeFile(join(root, "wt", ".git"), "gitdir: ../main/.git/worktrees/wt\n");

    expect(currentBranch(join(root, "wt"))).toBe("wt");
  });

  it("is undefined on a detached HEAD", async () => {
    const root = await repository("0123456789abcdef0123456789abcdef01234567\n");
    expect(currentBranch(root)).toBeUndefined();
  });
});
