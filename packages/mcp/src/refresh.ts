/**
 * Asking the deployed route to republish the gate, instead of publishing it.
 *
 * `maple-mcp` holds no gate credential in this mode. It sends the branch and
 * its own `GITHUB_TOKEN`; the route checks push access, decides the verdict
 * from the store and publishes with the App's installation auth.
 */

import type { Logger } from "@maple-kit/core";

/** Where the route is and who is asking. */
export interface RouteRefreshOptions {
  /** The route's mount URL, as `MAPLE_URL` gives it: `https://…/api/maple`. */
  readonly url: string;
  /** The caller's own GitHub token, which must be able to push. */
  readonly token: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Republishes the gate for one branch. Never throws; a failure is logged. */
export type GateRefresh = (branch: string, logger?: Logger) => Promise<void>;

/** Creates the caller. */
export function routeRefresh(options: RouteRefreshOptions): GateRefresh {
  const endpoint = `${withoutTrailingSlash(options.url)}/gate/refresh`;
  const call = options.fetch ?? globalThis.fetch;

  return async (branch, logger) => {
    try {
      const response = await call(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ branch }),
      });
      if (!response.ok) throw new Error(await refused(response, endpoint));
    } catch (error) {
      logger?.error(
        "Maple could not refresh the merge gate through the route; the comment's status was saved.",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };
}

/** The route's own sentence where it sent one, plus what to check for the common two. */
async function refused(response: Response, endpoint: string): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  const said = typeof body?.error === "string" ? body.error : response.statusText;
  const hint = HINTS[response.status];
  const sentence = `${endpoint} answered ${String(response.status)}: ${said}.`;
  return hint === undefined ? sentence : `${sentence} ${hint}`;
}

function withoutTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

const HINTS: Readonly<Partial<Record<number, string>>> = {
  401: "GitHub did not accept GITHUB_TOKEN.",
  403: "GITHUB_TOKEN needs push access to the repository.",
  404: "MAPLE_URL must be the route's mount URL, on a deployment whose route has gateRefresh.",
};
