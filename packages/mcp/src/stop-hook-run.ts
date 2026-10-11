/**
 * One Stop hook invocation, from payload and environment to decision.
 *
 * Installed with the plugin, the hook runs in every session of every project,
 * so most of what is here is the ways to do nothing: no forge and no `.maple/`
 * folder, no branch, no comments. Reading never creates `.maple/`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { isAdvisory } from "@maple-kit/core";
import { resolveLocalPlace } from "@maple-kit/core/local";

import { branchFromEnvironment, storeFromEnvironment } from "./config.js";
import { createToolHandlers } from "./handlers.js";
import { currentBranch, decideSessionStop } from "./stop-hook-session.js";

import type { BlockCounter, StopHookPayload } from "./stop-hook-session.js";
import type { StopHookDecision } from "./stop-hook.js";
import type { Comment, CommentStore } from "@maple-kit/core";

type Environment = Readonly<Record<string, string | undefined>>;

/** Decides one stop, and records it in `counter`. */
export async function runStopHook(
  payload: StopHookPayload,
  env: Environment,
  counter: BlockCounter,
): Promise<StopHookDecision> {
  const cwd = payload.cwd ?? process.cwd();
  const branch = env["MAPLE_BRANCH"] || currentBranch(cwd);
  const forge = Boolean(env["MAPLE_GITHUB_OWNER"] || env["MAPLE_GITHUB_REPO"]);

  const open = forge
    ? await openOn(
        storeFromEnvironment(env, cwd),
        branchFromEnvironment({ ...env, MAPLE_BRANCH: branch }),
      )
    : await openLocally(env, cwd, branch);
  return decideSessionStop(open, payload, counter);
}

/** Comments in the working directory's `.maple/`, where there is a folder to read. */
async function openLocally(
  env: Environment,
  cwd: string,
  branch: string | undefined,
): Promise<readonly Comment[]> {
  // A store named `github` with no forge configured is a half-written setup, not a local one.
  if (branch === undefined || env["MAPLE_STORE"] === "github") return [];
  const place = await resolveLocalPlace({ cwd });
  if (!existsSync(join(place.dir, "comments.json"))) return [];
  return openOn(storeFromEnvironment({ ...env, MAPLE_STORE: "file" }, cwd), branch);
}

/** Lint pins are advisory, as in the gate, so they never hold an agent. */
async function openOn(store: CommentStore, branch: string): Promise<readonly Comment[]> {
  const open = await createToolHandlers({ store }).listComments({
    branch,
    statuses: ["open", "needs_reverify"],
  });
  return open.filter((comment) => !isAdvisory(comment));
}
