/**
 * A fake of `GET /repos/{owner}/{repo}` as it answers different tokens.
 *
 * It is what `POST /gate/refresh` asks before republishing, and a counter is
 * how a test says the answer was cached rather than asked again.
 */

import { http, HttpResponse } from "msw";

import type { RequestHandler } from "msw";

const API = "https://api.github.com";

/** What GitHub makes of one token on this repository. */
export type TokenStanding = "push" | "read" | "hidden" | "forbidden" | "down";

/** A fake repository, and who has asked about it. */
export interface RepoFake {
  readonly handlers: RequestHandler[];
  /** How many times GitHub was asked. */
  calls(): number;
  /** Forgets every call. */
  reset(): void;
}

/**
 * Creates the fake. A token absent from `tokens` gets GitHub's 401, which is
 * what an expired or revoked token meets.
 */
export function createRepoFake(
  tokens: Readonly<Record<string, TokenStanding>>,
  owner = "maple-kit",
  repo = "app",
): RepoFake {
  let calls = 0;

  const handlers: RequestHandler[] = [
    http.get(`${API}/repos/${owner}/${repo}`, ({ request }) => {
      calls += 1;
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /u, "");
      return answer(tokens[token], owner, repo);
    }),
  ];

  return {
    handlers,
    calls: () => calls,
    reset: () => {
      calls = 0;
    },
  };
}

function answer(standing: TokenStanding | undefined, owner: string, repo: string): Response {
  switch (standing) {
    case undefined:
      return HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
    case "hidden":
      return HttpResponse.json({ message: "Not Found" }, { status: 404 });
    case "forbidden":
      return HttpResponse.json({ message: "Resource not accessible" }, { status: 403 });
    case "down":
      return HttpResponse.json({ message: "Server Error" }, { status: 502 });
    default:
      return HttpResponse.json({
        full_name: `${owner}/${repo}`,
        permissions: { admin: false, push: standing === "push", pull: true },
      });
  }
}
