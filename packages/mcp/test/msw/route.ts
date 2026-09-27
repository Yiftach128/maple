/**
 * The deployed route's `POST /gate/refresh`, as `maple-mcp` meets it.
 *
 * The answer depends on the token the way the real route's does: one that can
 * push gets a verdict, one that cannot gets 403, and a route in trouble a 5xx.
 */

import { http, HttpResponse } from "msw";

import type { RequestHandler } from "msw";

/** The mount URL tests set `MAPLE_URL` to. */
export const ROUTE = "https://preview.example.com/api/maple";

/** A token the fake route treats as able to push. */
export const PUSHER = "ghp_pusher";

/** A token the fake route treats as read-only. */
export const READER = "ghp_reader";

/** A token the fake route falls over on. */
export const BROKEN = "ghp_broken";

/** One refresh the fake route was asked for. */
export interface Asked {
  readonly authorization: string | null;
  readonly body: unknown;
}

/** The fake route, and what it was asked. */
export interface RouteFake {
  readonly handlers: RequestHandler[];
  asked(): readonly Asked[];
  reset(): void;
}

/** Creates the fake. */
export function createRouteFake(): RouteFake {
  let asked: Asked[] = [];

  const handlers: RequestHandler[] = [
    http.post(`${ROUTE}/gate/refresh`, async ({ request }) => {
      const authorization = request.headers.get("authorization");
      const body: unknown = await request.json();
      asked.push({ authorization, body });

      if (authorization === `Bearer ${BROKEN}`) {
        return HttpResponse.json({ error: "Something went wrong" }, { status: 500 });
      }
      if (authorization !== `Bearer ${PUSHER}`) {
        return HttpResponse.json(
          { error: "This token cannot push to the repository" },
          { status: 403 },
        );
      }
      return HttpResponse.json({
        branch: (body as { branch: string }).branch,
        sha: "9ab1c2d",
        verdict: { conclusion: "clear", reason: "all-resolved", open: 0, total: 1 },
      });
    }),
  ];

  return {
    handlers,
    asked: () => asked,
    reset: () => {
      asked = [];
    },
  };
}
