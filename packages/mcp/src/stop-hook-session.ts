/**
 * What the Stop hook remembers between calls, and what it reads off the
 * payload. Claude Code starts a fresh process for every stop and tells it only
 * whether the previous stop was blocked (`stop_hook_active`), so the count of
 * blocks in a row is kept in a file per session, under the system temp dir.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { decideStop, MAX_BLOCKS } from "./stop-hook.js";

import type { StopHookDecision, StopHookInput } from "./stop-hook.js";
import type { Comment } from "@maple-kit/core";

/** The fields the hook reads, as far as the payload supplied them. */
export type StopHookPayload = Partial<
  Pick<StopHookInput, "cwd" | "session_id" | "stop_hook_active">
>;

/** Where a session's count of consecutive blocks is kept. */
export interface BlockCounter {
  read(sessionId: string): number;
  write(sessionId: string, blocks: number): void;
  clear(sessionId: string): void;
}

/** The payload's readable fields; anything malformed is left out, never thrown. */
export function parseStopHookPayload(text: string): StopHookPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text || "{}");
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const record = raw as Record<string, unknown>;
  return {
    ...(typeof record["session_id"] === "string" ? { session_id: record["session_id"] } : {}),
    ...(typeof record["cwd"] === "string" ? { cwd: record["cwd"] } : {}),
    ...(typeof record["stop_hook_active"] === "boolean"
      ? { stop_hook_active: record["stop_hook_active"] }
      : {}),
  };
}

/** A counter kept as one small file per session in `dir`. */
export function fileBlockCounter(dir: string = join(tmpdir(), "maple-stop-hook")): BlockCounter {
  // Hashed, so a session id can never name a path outside `dir`.
  const file = (sessionId: string) =>
    join(dir, `${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}.txt`);
  return {
    read(sessionId) {
      try {
        const blocks = Number.parseInt(readFileSync(file(sessionId), "utf8"), 10);
        return Number.isFinite(blocks) && blocks > 0 ? blocks : 0;
      } catch {
        return 0;
      }
    },
    write(sessionId, blocks) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(sessionId), String(blocks));
    },
    clear(sessionId) {
      rmSync(file(sessionId), { force: true });
    },
  };
}

/**
 * Decides the stop and records it. A stop that does not follow a block starts
 * the count again; one that follows a block with no session id to count by is
 * let through, since a hook that cannot count cannot promise to give up.
 */
export function decideSessionStop(
  open: readonly Comment[],
  payload: StopHookPayload,
  counter: BlockCounter,
): StopHookDecision {
  const { session_id: session, stop_hook_active: active = false } = payload;
  const blocks = blocksSoFar(active, session, counter);
  const decision = decideStop(open, blocks);
  if (session === undefined) return decision;

  if (decision.decision === "block") counter.write(session, blocks + 1);
  else counter.clear(session);
  return decision;
}

function blocksSoFar(active: boolean, session: string | undefined, counter: BlockCounter): number {
  if (!active) return 0;
  return session === undefined ? MAX_BLOCKS : counter.read(session);
}

/**
 * The branch checked out at `cwd`, read from git's HEAD rather than by running
 * git; undefined when HEAD is detached or there is no repository.
 */
export function currentBranch(cwd: string): string | undefined {
  const gitDir = findGitDir(resolve(cwd));
  if (gitDir === undefined) return undefined;
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    return /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
  } catch {
    return undefined;
  }
}

function findGitDir(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    const found = gitDirAt(dotGit);
    if (found !== undefined) return found;
    if (dirname(dir) === dir) return undefined;
  }
}

// A worktree's `.git` is a file naming the real git dir; a checkout's is the dir.
function gitDirAt(dotGit: string): string | undefined {
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    const pointer = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
    return pointer === undefined ? undefined : resolve(dirname(dotGit), pointer);
  } catch {
    return undefined;
  }
}
