/**
 * Reading the store out of the environment.
 *
 * An MCP server is started by a client with no arguments, so the environment
 * is the only channel there is. A missing value fails loudly at startup rather
 * than on the first tool call, where a client would show it as a tool error.
 */

import { createCommentStore } from "@maple-kit/core";
import { githubGate, githubStore } from "@maple-kit/core/connectors";

import { describeVariable } from "./environment.js";

import type { CommentStore, GateConnector } from "@maple-kit/core";

/** Builds the store named by `MAPLE_STORE`, or the default, wrapped for use. */
export function storeFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): CommentStore {
  const kind = env["MAPLE_STORE"] ?? "github";
  if (kind !== "github") throw new Error(`Unknown MAPLE_STORE ${kind}; only "github" exists yet.`);

  return createCommentStore(
    githubStore({
      owner: required(env, "MAPLE_GITHUB_OWNER"),
      repo: required(env, "MAPLE_GITHUB_REPO"),
      token: required(env, "GITHUB_TOKEN"),
      ...(env["MAPLE_GITHUB_API"] === undefined ? {} : { baseUrl: env["MAPLE_GITHUB_API"] }),
    }),
  );
}

/**
 * The gate to publish to after a resolve, or undefined where none is
 * configured. The token is the gate App's own, never the store's: the store's
 * is a reviewer's and `docs/github-auth.md` argues at length for keeping the
 * two apart.
 */
export function gateFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): GateConnector | undefined {
  const token = env["MAPLE_GATE_TOKEN"];
  if (!token) return undefined;

  const appId = env["MAPLE_GATE_APP_ID"];
  return githubGate({
    owner: required(env, "MAPLE_GITHUB_OWNER"),
    repo: required(env, "MAPLE_GITHUB_REPO"),
    token,
    ...(appId === undefined ? {} : { appId }),
    ...(env["MAPLE_GITHUB_API"] === undefined ? {} : { baseUrl: env["MAPLE_GITHUB_API"] }),
  });
}

/** Whether the gate is held until somebody approves the preview. */
export function requireApprovalFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env["MAPLE_REQUIRE_APPROVAL"] === "true";
}

/** The branch the agent is reviewing. */
export function branchFromEnvironment(env: Readonly<Record<string, string | undefined>>): string {
  return required(env, "MAPLE_BRANCH");
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value) return value;
  const what = describeVariable(name);
  const detail = what === undefined ? "" : ` It is: ${what}`;
  throw new Error(`${name} is not set; Maple's MCP server cannot start without it.${detail}`);
}
