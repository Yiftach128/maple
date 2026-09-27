/**
 * Finding the pull request a preview belongs to.
 *
 * The branch name is the easy case and not the common one. A preview hostname
 * has to be a DNS label, so what it usually carries is a ticket, a shortened
 * branch or nothing at all — and the build knows its commit for certain while
 * the browser knows only the name it was served under. Every integration that
 * hit this wrote the same two GitHub calls and the same cache; this is that,
 * once.
 */

/** How a surface identifier becomes a pull request, when it is not a branch. */
export interface PullLookup {
  /**
   * The commit the preview was built from. Asked first and trusted outright:
   * `GET /commits/{sha}/pulls` names the pull request rather than inferring it.
   */
  readonly commit?: string;
  /**
   * Which open pull request an identifier belongs to, when neither the commit
   * nor the head branch's name found one. Called per open head, newest first.
   */
  readonly matches?: (head: string, identifier: string) => boolean;
}

/**
 * Where a resolved pull request is remembered.
 *
 * It is a parameter rather than a closure because a store built per request —
 * which is what a per-reviewer credential needs — has a new closure every
 * time, so the cache has to outlive it. Create one per process.
 */
export interface PullCache {
  /** Resolved or resolving. A rejection removes itself, so a miss is re-asked. */
  readonly held: Map<string, Promise<number | undefined>>;
}

/** Creates a cache. One per process, shared by every per-request store. */
export function createPullCache(): PullCache {
  return { held: new Map() };
}

/** What the lookup needs from the GitHub client, and nothing more. */
export interface PullReader {
  readonly owner: string;
  readonly repo: string;
  get<T>(path: string): Promise<T>;
}

interface PullRequest {
  readonly number: number;
  readonly head: { readonly ref: string };
}

const PAGE_SIZE = 100;

/**
 * The pull request for a surface, or undefined when nothing open matches.
 *
 * Kept on the commit where there is one and on the identifier otherwise: a
 * deployment serves one surface for its whole life. Only a hit is kept — a
 * branch is pushed, the preview builds, and the pull request is opened after.
 */
export function findPull(
  api: PullReader,
  identifier: string,
  lookup: PullLookup | undefined,
  cache: PullCache | undefined,
): Promise<number | undefined> {
  const key = `${api.owner}/${api.repo}#${lookup?.commit ?? identifier}`;
  const known = cache?.held.get(key);
  if (known) return known;

  const forget = (): void => {
    cache?.held.delete(key);
  };
  const pending = resolve(api, identifier, lookup).then(
    (found) => {
      if (found === undefined) forget();
      return found;
    },
    (error: unknown) => {
      forget();
      throw error;
    },
  );

  cache?.held.set(key, pending);
  return pending;
}

/** Commit, then the branch's own name, then whatever the application says. */
async function resolve(
  api: PullReader,
  identifier: string,
  lookup: PullLookup | undefined,
): Promise<number | undefined> {
  const exact = lookup?.commit === undefined ? undefined : await ofCommit(api, lookup.commit);
  if (exact !== undefined) return exact;

  const named = await ofHead(api, identifier);
  if (named !== undefined) return named;

  return lookup?.matches === undefined ? undefined : ofMatch(api, identifier, lookup.matches);
}

/** The commit names its pull request outright; nothing is inferred from it. */
async function ofCommit(api: PullReader, commit: string): Promise<number | undefined> {
  const path = `/repos/${api.owner}/${api.repo}/commits/${encodeURIComponent(commit)}/pulls`;
  return (await api.get<PullRequest[]>(path))[0]?.number;
}

/**
 * The ordinary case: the identifier is the head branch's own name. An open pull
 * request beats a newer closed duplicate; a closed one is used only when none is.
 */
async function ofHead(api: PullReader, branch: string): Promise<number | undefined> {
  const head = encodeURIComponent(`${api.owner}:${branch}`);
  const base = `/repos/${api.owner}/${api.repo}/pulls?head=${head}&per_page=1`;

  const open = (await api.get<PullRequest[]>(`${base}&state=open`))[0]?.number;
  if (open !== undefined) return open;

  const path = `${base}&state=all&sort=updated&direction=desc`;
  return (await api.get<PullRequest[]>(path))[0]?.number;
}

/** Newest first, so the most recent wins where several would match. */
async function ofMatch(
  api: PullReader,
  identifier: string,
  matches: (head: string, identifier: string) => boolean,
): Promise<number | undefined> {
  const path =
    `/repos/${api.owner}/${api.repo}/pulls` +
    `?state=open&sort=updated&direction=desc&per_page=${String(PAGE_SIZE)}`;
  const open = await api.get<PullRequest[]>(path);

  return open.find((pull) => matches(pull.head.ref, identifier))?.number;
}
