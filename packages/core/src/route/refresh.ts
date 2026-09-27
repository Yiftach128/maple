/**
 * `POST /gate/refresh`: republish the merge gate for a branch, on request.
 *
 * It exists so an agent resolving comments outside a browser can move the
 * check without ever holding a gate credential. The caller names a branch and
 * proves push access with its own GitHub token; the verdict is decided here,
 * from the store, and published with the route's own gate. `docs/gate.md`.
 */

import { publishVerdict } from "../gate/publish.js";
import { json } from "./budget.js";
import { createPushAccess } from "./push-access.js";

import type { GateConnector } from "../connectors/types.js";
import type { Logger } from "../logger/types.js";
import type { CommentStore } from "../store.js";
import type { PushAccess } from "./push-access.js";

/** Turns the refresh action on, for one repository. */
export interface GateRefreshOptions {
  /** The repository a caller must be able to push to. */
  readonly owner: string;
  readonly repo: string;
  /**
   * Builds the store the verdict is read from, on the caller's own token. Absent,
   * the route's `store` is used, and a resolver is handed the request as it came.
   */
  readonly store?: (token: string) => CommentStore | Promise<CommentStore>;
  /** Defaults to `https://api.github.com`. Set this for Enterprise Server. */
  readonly baseUrl?: string;
  /** How long a push-access answer is kept. Defaults to a minute. */
  readonly cacheMs?: number;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Injected in tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** What one refresh needs, gathered by the dispatcher. */
export interface RefreshContext {
  readonly access: PushAccess;
  readonly options: GateRefreshOptions;
  gate(): Promise<GateConnector | null>;
  /** The route's own store, for a refresh with no `store` of its own. */
  fallbackStore(): Promise<CommentStore | null>;
  readonly requireApproval?: boolean;
  readonly logger?: Logger;
}

/** Built once per handler, so the push-access cache outlives a request. */
export function createRefreshAccess(options: GateRefreshOptions): PushAccess {
  return createPushAccess({
    owner: options.owner,
    repo: options.repo,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.cacheMs === undefined ? {} : { cacheMs: options.cacheMs }),
  });
}

/** Answers the request. The token is read, checked and never logged. */
export async function handleRefresh(context: RefreshContext, request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = bearer(request.headers.get("authorization"));
  if (token === undefined) return json({ error: "A GitHub token is required" }, 401);

  const branch = await branchIn(request);
  if (branch === undefined) return json({ error: "A branch is required" }, 400);

  const answer = await context.access(token);
  if (answer === "bad-token") return json({ error: "GitHub did not accept this token" }, 401);
  if (answer === "denied") return json({ error: "This token cannot push to the repository" }, 403);

  const gate = await context.gate();
  if (!gate) return json({ error: "This deployment publishes no gate" }, 404);

  const store = await storeFor(context, token);
  if (!store) return json({ error: "There is no store to read the verdict from" }, 401);

  return await publish(context, { store, gate }, branch, new URL(request.url).origin);
}

async function publish(
  context: RefreshContext,
  chosen: { store: CommentStore; gate: GateConnector },
  branch: string,
  reviewUrl: string,
): Promise<Response> {
  const gateContext = {
    ...chosen,
    ...(context.logger === undefined ? {} : { logger: context.logger }),
    ...(context.requireApproval === undefined ? {} : { requireApproval: context.requireApproval }),
  };

  const published = await publishVerdict(gateContext, branch, reviewUrl);
  if (!published) return json({ error: `No head commit for "${branch}"` }, 409);

  const { verdict } = published;
  return json(
    {
      branch,
      sha: published.sha,
      verdict: {
        conclusion: verdict.conclusion,
        reason: verdict.reason,
        open: verdict.open,
        total: verdict.total,
      },
    },
    200,
  );
}

async function storeFor(context: RefreshContext, token: string): Promise<CommentStore | null> {
  const build = context.options.store;
  return build === undefined ? await context.fallbackStore() : await build(token);
}

function bearer(header: string | null): string | undefined {
  const match = header === null ? null : /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

async function branchIn(request: Request): Promise<string | undefined> {
  const body = (await request.json().catch(() => undefined)) as { branch?: unknown } | undefined;
  const branch = body?.branch;
  return typeof branch === "string" && branch.length > 0 ? branch : undefined;
}
