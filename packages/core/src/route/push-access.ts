/**
 * Whether a caller's GitHub token may push to the repository under review.
 *
 * Push is the bar for asking the route to republish the gate: anyone who can
 * push can already move the check by pushing. The answer is cached briefly,
 * keyed by a SHA-256 of the token so the token itself is never held.
 */

/** Where the check is made. */
export interface PushAccessOptions {
  readonly owner: string;
  readonly repo: string;
  /** Defaults to `https://api.github.com`. */
  readonly baseUrl?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Injected in tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** How long an answer is kept. Defaults to a minute. */
  readonly cacheMs?: number;
}

/** `bad-token` is GitHub's 401; `denied` is a token that cannot push, or cannot see. */
export type PushAnswer = "push" | "denied" | "bad-token";

/** Asks GitHub, or the cache, whether `token` can push. */
export type PushAccess = (token: string) => Promise<PushAnswer>;

/** Raised when GitHub gives no answer either way. Never carries the token. */
export class PushAccessError extends Error {
  override readonly name = "PushAccessError";
}

const DEFAULT_BASE = "https://api.github.com";
const MINUTE = 60_000;

/** Enough for every agent on a team; past it the oldest answer is dropped. */
const MAX_HELD = 500;

interface Held {
  readonly answer: PushAnswer;
  readonly until: number;
}

/** Creates the checker. One per route, so the cache is shared across requests. */
export function createPushAccess(options: PushAccessOptions): PushAccess {
  const clock = options.now ?? Date.now;
  const ttl = options.cacheMs ?? MINUTE;
  const held = new Map<string, Held>();

  return async (token) => {
    const key = await digest(token);
    const cached = held.get(key);
    if (cached && clock() < cached.until) return cached.answer;

    const answer = await ask(options, token);
    held.delete(key);
    held.set(key, { answer, until: clock() + ttl });
    if (held.size > MAX_HELD) held.delete(held.keys().next().value!);
    return answer;
  };
}

async function ask(options: PushAccessOptions, token: string): Promise<PushAnswer> {
  const call = options.fetch ?? globalThis.fetch;
  const path = `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
  const response = await call(`${options.baseUrl ?? DEFAULT_BASE}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (response.status === 401) return "bad-token";
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    throw new PushAccessError(`GitHub rate-limited ${path}`);
  }
  // GitHub answers 404 for a repository the token cannot see, and 403 for one
  // it may not read: both are a caller who may not refresh.
  if (response.status === 403 || response.status === 404) return "denied";
  if (!response.ok) throw new PushAccessError(`GitHub ${String(response.status)} on ${path}`);

  const body = (await response.json().catch(() => undefined)) as
    { permissions?: { push?: unknown } } | undefined;
  return body?.permissions?.push === true ? "push" : "denied";
}

async function digest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
