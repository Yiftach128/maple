/**
 * GitHub pull-request store connector, and Maple's default store.
 *
 * Consistency: read-your-writes, strongly consistent within a repository.
 * Retention: as long as the pull request exists.
 * Credentials: one token, server-side only. It never reaches the overlay.
 *
 * Everything Maple keeps on a pull request lives in one issue comment — the
 * ledger — and news reposts it rather than editing it. `docs/connectors.md`.
 */

import { UpstreamError } from "../errors.js";
import { exportMarkdown, parseFence } from "../export/markdown.js";
import { USER_AGENT } from "../internal/user-agent.js";
import { findPull } from "./github-pull.js";

import type {
  Approval,
  Comment,
  CommentResolution,
  CommentStatus,
  MediaRef,
  NewApproval,
  NewComment,
} from "../types.js";
import type { PullCache, PullLookup, PullReader } from "./github-pull.js";
import type { CommentPage, ListQuery, MediaConnector, StoreConnector } from "./types.js";

/** Everything the connector needs to reach a repository. */
export interface GitHubStoreOptions {
  readonly owner: string;
  readonly repo: string;
  /**
   * A user-to-server or installation token. Never a value written into a file:
   * read it from the environment at the call site.
   */
  readonly token: string;
  /** Defaults to `https://api.github.com`. Set this for Enterprise Server. */
  readonly baseUrl?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * How a branch, ticket or shortened label becomes a pull request. Left out,
   * the identifier has to be the head branch's own name.
   */
  readonly pull?: PullLookup;
  /**
   * Where a resolved pull request is remembered, across the per-request stores
   * a per-reviewer credential needs. Left out, every call asks again.
   */
  readonly cache?: PullCache;
  /**
   * Turns an attachment into a URL the pull-request table links to. Left out,
   * a screenshot stays a `MediaRef` nothing human-readable points at.
   */
  readonly media?: MediaConnector;
}

const DEFAULT_BASE = "https://api.github.com";
const PAGE_SIZE = 100;
const ID = /^gh_(\d+)_(\d+)$/;
const APPROVAL_ID = /^gha_(\d+)_(\d+)$/;

/**
 * Bytes the fence is held under: one ledger carries a whole pull request, and
 * the table above it is unbudgeted out of GitHub's 65,536 characters.
 */
const LEDGER_BUDGET = 40_000;

/** Creates a store connector backed by a pull request's comments. */
export function githubStore(options: GitHubStoreOptions): StoreConnector {
  const api = createClient(options);

  return {
    name: "github",
    list: (query) => list(api, query),
    append: async (comment) => (await appendMany(api, [comment]))[0]!,
    appendMany: (comments) => appendMany(api, comments),
    setStatus: (id, status, resolution) => setStatus(api, id, status, resolution),
    head: (branch) => head(api, branch),
    approvals: (branch) => approvalsOn(api, branch),
    approve: (approval) => approve(api, approval),
    unapprove: (id) => unapprove(api, id),
  };
}

/** The narrow GitHub client the rest of this file is written against. */
interface Client {
  readonly options: GitHubStoreOptions;
  request<T>(path: string, init?: RequestInit): Promise<Paged<T>>;
}

interface Paged<T> {
  readonly body: T;
  readonly hasNext: boolean;
}

/** One issue comment, trimmed to what this connector reads. */
interface IssueComment {
  readonly id: number;
  readonly body: string;
}

/** One pull request, trimmed to the one field the gate needs from it. */
interface PullDetail {
  readonly head: { readonly sha: string };
}

function createClient(options: GitHubStoreOptions): Client {
  const base = options.baseUrl ?? DEFAULT_BASE;
  const call = options.fetch ?? globalThis.fetch;

  return {
    options,
    async request<T>(path: string, init: RequestInit = {}): Promise<Paged<T>> {
      const response = await call(`${base}${path}`, {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${options.token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": USER_AGENT,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers,
        },
      });

      if (!response.ok) throw await failure(response, path);
      return { body: (await response.json()) as T, hasNext: hasNextPage(response) };
    },
  };
}

/**
 * GitHub's message, not ours. Core maps this to `MapleStoreError` and decides
 * what to retry; swallowing it here would take that decision away.
 */
async function failure(response: Response, path: string): Promise<UpstreamError> {
  const detail = await response.text().catch(() => "");
  const parsed: unknown = detail ? safeJson(detail) : undefined;
  const message =
    typeof parsed === "object" && parsed !== null && "message" in parsed
      ? String(parsed.message)
      : detail || response.statusText;

  return new UpstreamError("GitHub", response.status, message, path);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function hasNextPage(response: Response): boolean {
  return (response.headers.get("link") ?? "").includes('rel="next"');
}

/** The pull request a surface belongs to, or undefined when it has none open. */
function pullFor(api: Client, identifier: string): Promise<number | undefined> {
  return findPull(reader(api), identifier, api.options.pull, api.options.cache);
}

/** The lookup reads; it never writes, so it is given a narrower client. */
function reader(api: Client): PullReader {
  return {
    owner: api.options.owner,
    repo: api.options.repo,
    get: async <T>(path: string) => (await api.request<T>(path)).body,
  };
}

/** Read fresh every time: the pull request's number is cacheable and its sha is not. */
async function head(api: Client, branch: string): Promise<string | undefined> {
  const pull = await pullFor(api, branch);
  if (pull === undefined) return undefined;

  const path = `/repos/${api.options.owner}/${api.options.repo}/pulls/${String(pull)}`;
  const { body } = await api.request<PullDetail>(path);
  return body.head.sha;
}

/**
 * Everything Maple keeps on one pull request, and the comment it is in.
 * `stale` is every older ledger a half-finished repost left behind.
 */
interface Ledger {
  readonly branch: string;
  readonly pull: number;
  readonly issueId: number | undefined;
  readonly stale: readonly number[];
  readonly comments: readonly Comment[];
  readonly approvals: readonly Approval[];
}

/** Reads the ledger for the pull request a surface identifier resolves to. */
async function readLedger(api: Client, branch: string): Promise<Ledger | undefined> {
  const pull = await pullFor(api, branch);
  return pull === undefined ? undefined : await readLedgerAt(api, pull, branch);
}

/**
 * Reads the ledger of a known pull request; the newest Maple comment wins.
 * Without a branch the fence's own is taken: an id never names one.
 */
async function readLedgerAt(api: Client, pull: number, branch?: string): Promise<Ledger> {
  const found: { id: number; body: string }[] = [];
  for (let page = 1; page <= PAGE_SIZE; page += 1) {
    const path = `/repos/${api.options.owner}/${api.options.repo}/issues/${String(pull)}/comments?per_page=${String(PAGE_SIZE)}&page=${String(page)}`;
    const { body, hasNext } = await api.request<IssueComment[]>(path);
    for (const issue of body) {
      if (parseFence(issue.body)) found.push({ id: issue.id, body: issue.body });
    }
    if (!hasNext) break;
  }

  const newest = found.at(-1);
  const fence = newest === undefined ? undefined : parseFence(newest.body);
  const surface = branch ?? fence?.branch ?? "";

  return {
    branch: surface,
    pull,
    issueId: newest?.id,
    stale: found.slice(0, -1).map((one) => one.id),
    comments: fence?.comments.map((comment) => ({ ...comment, branch: surface })) ?? [],
    approvals: fence?.approvals ?? [],
  };
}

/**
 * Writes the ledger back. `repost` creates the new comment before deleting the
 * old one, so an interrupted write leaves two Maple comments rather than none.
 */
async function writeLedger(api: Client, ledger: Ledger, repost: boolean): Promise<void> {
  const body = await bodyFor(api, ledger);
  const { owner, repo } = api.options;
  const gone = [...ledger.stale];

  if (repost || ledger.issueId === undefined) {
    await api.request<IssueComment>(
      `/repos/${owner}/${repo}/issues/${String(ledger.pull)}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    if (ledger.issueId !== undefined) gone.push(ledger.issueId);
  } else {
    await api.request<IssueComment>(
      `/repos/${owner}/${repo}/issues/comments/${String(ledger.issueId)}`,
      { method: "PATCH", body: JSON.stringify({ body }) },
    );
  }

  for (const id of gone) await remove(api, id);
}

/** A comment that will not delete is a duplicate, not a failed write. */
async function remove(api: Client, issueId: number): Promise<void> {
  const { owner, repo } = api.options;
  try {
    await api.request<unknown>(`/repos/${owner}/${repo}/issues/comments/${String(issueId)}`, {
      method: "DELETE",
    });
  } catch {
    // Left in place. `readLedger` takes the newest, so it shadows rather than wins.
  }
}

async function list(api: Client, query: ListQuery): Promise<CommentPage> {
  if (query.limit !== undefined && query.limit <= 0) {
    throw new RangeError(`limit must be positive, received ${String(query.limit)}`);
  }

  const ledger = await readLedger(api, query.branch);
  if (!ledger) return { comments: [] };

  const matching = ledger.comments.filter(
    (comment) => query.statuses === undefined || query.statuses.includes(comment.status),
  );
  const offset = query.cursor === undefined ? 0 : offsetOf(query.cursor);
  const page = matching.slice(offset, offset + (query.limit ?? matching.length));
  const next = offset + page.length;

  return { comments: page, ...(next < matching.length ? { cursor: String(next) } : {}) };
}

/**
 * One read and one repost, however many comments arrive. A reviewer
 * publishing five drafts spends one write and sends one notification.
 */
async function appendMany(
  api: Client,
  incoming: readonly NewComment[],
): Promise<readonly Comment[]> {
  const branch = incoming[0]?.branch;
  if (branch === undefined) return [];

  const ledger = await readLedger(api, branch);
  if (!ledger) {
    throw new Error(`No pull request for branch ${branch}; Maple has nowhere to post.`);
  }

  let seq = nextSeq(
    ledger.comments.map((one) => one.id),
    ID,
  );
  const stored = incoming.map((comment) => ({
    ...comment,
    id: `gh_${String(ledger.pull)}_${String(seq++)}`,
    status: comment.status ?? "open",
  }));

  await writeLedger(api, { ...ledger, comments: [...ledger.comments, ...stored] }, true);
  return stored;
}

/**
 * A status change edits the ledger in place. Nobody needs telling that a
 * comment they resolved is resolved, and a repost would move the whole thread.
 */
async function setStatus(
  api: Client,
  id: string,
  status: CommentStatus,
  resolution?: CommentResolution,
): Promise<Comment> {
  const located = ID.exec(id);
  if (!located) throw new Error(`Not a GitHub comment id: ${id}`);

  const ledger = await ledgerHolding(api, Number(located[1]), id, (one) =>
    one.comments.some((held) => held.id === id),
  );
  const existing = ledger.comments.find((one) => one.id === id);
  if (!existing) throw new Error(`No comment ${id} on this pull request.`);

  const updated: Comment = { ...existing, status, ...(resolution ? { resolution } : {}) };
  const comments = ledger.comments.map((one) => (one.id === id ? updated : one));
  await writeLedger(api, { ...ledger, comments }, false);
  return updated;
}

function approvalsOn(api: Client, branch: string): Promise<readonly Approval[]> {
  return readLedger(api, branch).then((ledger) => ledger?.approvals ?? []);
}

/** An approval reposts: it is news, and an edit sends nobody a notification. */
async function approve(api: Client, approval: NewApproval): Promise<Approval> {
  const ledger = await readLedger(api, approval.branch);
  if (!ledger) {
    throw new Error(`No pull request for branch ${approval.branch}; Maple has nowhere to post.`);
  }

  const seq = nextSeq(
    ledger.approvals.map((one) => one.id),
    APPROVAL_ID,
  );
  const stored: Approval = { ...approval, id: `gha_${String(ledger.pull)}_${String(seq)}` };
  await writeLedger(api, { ...ledger, approvals: [...ledger.approvals, stored] }, true);
  return stored;
}

/** Withdrawing edits in place: it removes a line rather than adding news. */
async function unapprove(api: Client, id: string): Promise<void> {
  const located = APPROVAL_ID.exec(id);
  if (!located) throw new Error(`Not a GitHub approval id: ${id}`);

  const ledger = await ledgerHolding(api, Number(located[1]), id, (one) =>
    one.approvals.some((approval) => approval.id === id),
  );
  const approvals = ledger.approvals.filter((one) => one.id !== id);
  await writeLedger(api, { ...ledger, approvals }, false);
}

/**
 * The ledger an id belongs to, read straight off its pull request. No lookup:
 * the number is in the id, and the branch comes back out of the fence.
 */
async function ledgerHolding(
  api: Client,
  pull: number,
  id: string,
  holds: (ledger: Ledger) => boolean,
): Promise<Ledger> {
  const ledger = await readLedgerAt(api, pull);
  if (!holds(ledger)) throw new Error(`No Maple record ${id} on this repository.`);
  return ledger;
}

/** One past the highest sequence any id has used, so a deleted one never returns. */
function nextSeq(ids: readonly string[], shape: RegExp): number {
  const used = ids.map((id) => Number(shape.exec(id)?.[2] ?? 0));
  return Math.max(0, ...used) + 1;
}

/** The whole pull request in one body: the table, the sign-offs and the fence. */
async function bodyFor(api: Client, ledger: Ledger): Promise<string> {
  const screenshots = await shotsFor(api, ledger.comments);

  return exportMarkdown(ledger.comments, {
    branch: ledger.branch,
    budget: LEDGER_BUDGET,
    ...(ledger.approvals.length === 0 ? {} : { approvals: ledger.approvals }),
    ...(screenshots.size === 0 ? {} : { screenshots }),
  }).markdown;
}

/**
 * Each comment's first image, as a URL. A connector that cannot answer costs
 * that row its link and nothing else; docs/screenshots.md says why.
 */
async function shotsFor(api: Client, comments: readonly Comment[]): Promise<Map<string, string>> {
  const shots = new Map<string, string>();
  const media = api.options.media;
  if (!media) return shots;

  for (const comment of comments) {
    const ref = comment.attachments?.find(isImage);
    if (!ref) continue;
    try {
      shots.set(comment.id, await media.getUrl(ref));
    } catch {
      // No link on that row. The comment itself is unaffected.
    }
  }
  return shots;
}

function isImage(ref: MediaRef): boolean {
  return ref.contentType.startsWith("image/");
}

function offsetOf(cursor: string): number {
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError(`Invalid cursor: ${cursor}`);
  return offset;
}
