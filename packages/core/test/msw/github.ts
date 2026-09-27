/**
 * A small fake of the three GitHub endpoints the store connector uses.
 *
 * It is a fake rather than a set of fixed responses because the contract suite
 * appends and then reads back: a handler that always returns the same page
 * cannot express read-your-writes, which is the property this connector
 * claims.
 */

import { http, HttpResponse } from "msw";

import type { RequestHandler } from "msw";

const API = "https://api.github.com";
const LOGIN = "https://github.com";

interface StoredComment {
  id: number;
  body: string;
}

/** One pull request on a head branch, as `head()` records it. */
export interface HeadPull {
  readonly number: number;
  readonly state: "open" | "closed";
  /** ISO timestamp, compared when a lookup asks for `sort=updated`. */
  readonly updated: string;
}

/** A fake repository, with its pull requests and their comments. */
export interface GitHubFake {
  readonly handlers: RequestHandler[];
  /** Forgets every comment and every lookup, so one test cannot see another's. */
  reset(): void;
  /** Comments currently on a pull request, for asserting on what was written. */
  commentsOn(pull: number): readonly StoredComment[];
  /** Puts a comment on a pull request without going through the connector. */
  post(pull: number, body: string): StoredComment;
  /** Every write the connector made, in order, as `METHOD /path`. */
  writes(): readonly string[];
  /** The branches `GET /pulls?state=open` lists, newest first. */
  open(...branches: readonly string[]): void;
  /** Says which branch a commit is on, for `GET /commits/{sha}/pulls`. */
  commit(sha: string, branch: string): void;
  /** How many pull-request lookups have been served, for asserting a cache. */
  lookups(): number;
  /** The pull requests on a head branch, newest created first, as GitHub lists them. */
  head(branch: string, ...pulls: readonly HeadPull[]): void;
  /** Makes every head lookup for a branch answer with a GitHub error. */
  fail(branch: string, status: number): void;
}

/**
 * Creates the fake. A head containing a slash resolves to a pull request,
 * except one starting with `no-pull/`; anything else is a ticket or a
 * hostname label, and only `open()` and `commit()` resolve those.
 */
export function createGitHubFake(owner = "maple-kit", repo = "app"): GitHubFake {
  const comments = new Map<number, StoredComment[]>();
  const commits = new Map<string, string>();
  const heads = new Map<string, readonly HeadPull[]>();
  const failing = new Map<string, number>();
  let opened: readonly string[] = [];
  let lookups = 0;
  let nextId = 1000;
  const writes: string[] = [];

  const commentsFor = (pull: number): StoredComment[] => {
    const existing = comments.get(pull);
    if (existing) return existing;
    const created: StoredComment[] = [];
    comments.set(pull, created);
    return created;
  };

  const handlers: RequestHandler[] = [
    http.get(`${API}/repos/${owner}/${repo}/commits/:sha/pulls`, ({ params }) => {
      lookups += 1;
      const branch = commits.get(String(params["sha"]));
      if (branch === undefined) return HttpResponse.json([]);
      return HttpResponse.json([{ number: pullFor(branch), head: { ref: branch } }]);
    }),

    http.get(`${API}/repos/${owner}/${repo}/pulls`, ({ request }) => {
      lookups += 1;
      const head = new URL(request.url).searchParams.get("head");
      if (head === null) {
        return HttpResponse.json(
          opened.map((branch) => ({ number: pullFor(branch), head: { ref: branch } })),
        );
      }

      // A head lookup answers for anything that looks like a branch. An
      // identifier with no slash is a ticket or a hostname label, which is
      // exactly the case `PullLookup.matches` exists for, so it finds nothing.
      const branch = head.slice(head.indexOf(":") + 1);
      const status = failing.get(branch);
      if (status !== undefined) {
        return HttpResponse.json({ message: "Server Error" }, { status });
      }
      const recorded = heads.get(branch);
      if (recorded) return HttpResponse.json(listHead(branch, recorded, request.url));

      const known = branch.includes("/") && !branch.startsWith("no-pull/");
      return HttpResponse.json(known ? [{ number: pullFor(branch), head: { ref: branch } }] : []);
    }),

    http.get(`${API}/repos/${owner}/${repo}/pulls/:number`, ({ params }) => {
      const pull = Number(params["number"]);
      const found = [...commits].find(([, branch]) => pullFor(branch) === pull);
      if (!found) return HttpResponse.json({ message: "Not Found" }, { status: 404 });

      return HttpResponse.json({ number: pull, head: { ref: found[1], sha: found[0] } });
    }),

    http.get(`${API}/repos/${owner}/${repo}/issues/:pull/comments`, ({ params, request }) => {
      const url = new URL(request.url);
      const pull = Number(params["pull"]);
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      const page = Number(url.searchParams.get("page") ?? "1");

      const all = commentsFor(pull);
      const start = (page - 1) * perPage;
      const slice = all.slice(start, start + perPage);
      const headers = start + slice.length < all.length ? { link: nextLink(url, page) } : undefined;

      return HttpResponse.json(slice, headers ? { headers } : undefined);
    }),

    http.post(
      `${API}/repos/${owner}/${repo}/issues/:pull/comments`,
      async ({ params, request }) => {
        const pull = Number(params["pull"]);
        const { body } = (await request.json()) as { body: string };
        nextId += 1;
        const created = { id: nextId, body };

        writes.push(`POST /issues/${String(pull)}/comments`);
        commentsFor(pull).push(created);
        return HttpResponse.json(created, { status: 201 });
      },
    ),

    http.get(`${API}/repos/${owner}/${repo}/issues/comments/:id`, ({ params }) => {
      const found = find(comments, Number(params["id"]));
      if (!found) return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      return HttpResponse.json(found);
    }),

    http.patch(`${API}/repos/${owner}/${repo}/issues/comments/:id`, async ({ params, request }) => {
      const found = find(comments, Number(params["id"]));
      if (!found) return HttpResponse.json({ message: "Not Found" }, { status: 404 });

      const { body } = (await request.json()) as { body: string };
      writes.push(`PATCH /issues/comments/${String(found.id)}`);
      found.body = body;
      return HttpResponse.json(found);
    }),

    http.delete(`${API}/repos/${owner}/${repo}/issues/comments/:id`, ({ params }) => {
      const id = Number(params["id"]);
      for (const list of comments.values()) {
        const at = list.findIndex((comment) => comment.id === id);
        if (at < 0) continue;

        writes.push(`DELETE /issues/comments/${String(id)}`);
        list.splice(at, 1);
        return new HttpResponse(null, { status: 204 });
      }
      return HttpResponse.json({ message: "Not Found" }, { status: 404 });
    }),
  ];

  return {
    handlers,
    reset: () => {
      comments.clear();
      commits.clear();
      heads.clear();
      failing.clear();
      opened = [];
      lookups = 0;
      writes.length = 0;
    },
    commentsOn: (pull) => [...commentsFor(pull)],
    post: (pull, body) => {
      nextId += 1;
      const created = { id: nextId, body };
      commentsFor(pull).push(created);
      return created;
    },
    writes: () => [...writes],
    open: (...branches) => (opened = branches),
    commit: (sha, branch) => {
      commits.set(sha, branch);
    },
    lookups: () => lookups,
    head: (branch, ...pulls) => {
      heads.set(branch, pulls);
    },
    fail: (branch, status) => {
      failing.set(branch, status);
    },
  };
}

/** Filters by `state` and orders by `sort` the way `GET /pulls` does. */
function listHead(branch: string, pulls: readonly HeadPull[], url: string): unknown[] {
  const params = new URL(url).searchParams;
  const state = params.get("state") ?? "open";
  const perPage = Number(params.get("per_page") ?? "30");

  const kept = pulls.filter((pull) => state === "all" || pull.state === state);
  const ordered =
    params.get("sort") === "updated"
      ? [...kept].sort((a, b) => b.updated.localeCompare(a.updated))
      : kept;
  return ordered.slice(0, perPage).map((pull) => ({
    number: pull.number,
    state: pull.state,
    updated_at: pull.updated,
    head: { ref: branch },
  }));
}

/** A stable pull number per branch, so a branch always lands in one place. */
export function pullFor(branch: string): number {
  let hash = 7;
  for (const character of branch) hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  return hash + 1;
}

function find(comments: Map<number, StoredComment[]>, id: number): StoredComment | undefined {
  for (const list of comments.values()) {
    const found = list.find((comment) => comment.id === id);
    if (found) return found;
  }
  return undefined;
}

function nextLink(url: URL, page: number): string {
  const next = new URL(url);
  next.searchParams.set("page", String(page + 1));
  return `<${next.toString()}>; rel="next"`;
}

/** How the fake device flow should answer the next poll. */
export type DeviceStep = "pending" | "slow_down" | { token: string } | { error: string };

/** A fake of GitHub's Device Flow endpoints, plus the one call that names the user. */
export interface DeviceFlowFake {
  readonly handlers: RequestHandler[];
  /** Answers given to successive polls, consumed in order. */
  respond(...steps: DeviceStep[]): void;
  /** How many times the token endpoint was polled. */
  readonly polls: () => number;
  /** The login `GET /user` reports, or null to make that call fail. */
  whoami(login: string | null): void;
}

/** Creates the fake. `respond` sets what each poll returns, in order. */
export function createDeviceFlowFake(): DeviceFlowFake {
  let steps: DeviceStep[] = [];
  let polls = 0;
  let login: string | null = "octocat";

  const handlers: RequestHandler[] = [
    http.post(`${LOGIN}/login/device/code`, () =>
      HttpResponse.json({
        device_code: "dev-code-secret",
        user_code: "WDJB-MJHT",
        verification_uri: `${LOGIN}/login/device`,
        expires_in: 900,
        interval: 5,
      }),
    ),

    http.post(`${LOGIN}/login/oauth/access_token`, () => {
      polls += 1;
      const step = steps.shift() ?? "pending";

      if (step === "pending") return HttpResponse.json({ error: "authorization_pending" });
      if (step === "slow_down") return HttpResponse.json({ error: "slow_down", interval: 10 });
      if ("error" in step) return HttpResponse.json({ error: step.error });
      return HttpResponse.json({ access_token: step.token, scope: "", token_type: "bearer" });
    }),

    http.get(`${API}/user`, ({ request }) => {
      if (login === null) return HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
      const authorization = request.headers.get("authorization") ?? "";
      if (!authorization.startsWith("Bearer ")) {
        return HttpResponse.json({ message: "Requires authentication" }, { status: 401 });
      }
      return HttpResponse.json({ login });
    }),
  ];

  return {
    handlers,
    respond: (...next) => {
      steps = [...next];
      polls = 0;
    },
    polls: () => polls,
    whoami: (next) => {
      login = next;
    },
  };
}
