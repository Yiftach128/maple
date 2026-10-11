/**
 * The Effect layer around a store connector.
 *
 * Contributors write plain Promise methods. Everything that makes those methods
 * survive a flaky network — typed errors, a retry schedule, a timeout — lives
 * here, once, instead of in every connector.
 *
 * Every export returns a Promise, so no caller imports Effect. An optional
 * method the connector omits resolves to the absent value its export names.
 */

import { Cause, Effect, Exit, Option, Schedule } from "effect";

import { MapleStoreError, UpstreamError } from "../../errors.js";
import { StoreRejected, StoreUnavailable } from "./errors.js";

import type { CommentPage, ListQuery, StoreConnector } from "../../connectors/types.js";
import type {
  Approval,
  Comment,
  CommentResolution,
  CommentStatus,
  NewApproval,
  NewComment,
} from "../../types.js";

/** Three tries, 100ms apart, doubling, with jitter so retries do not synchronise. */
const RETRY_POLICY = Schedule.jittered(
  Schedule.intersect(Schedule.exponential("100 millis", 2), Schedule.recurs(2)),
);

/** How long any single connector call may take before it is abandoned. */
const CALL_TIMEOUT = "10 seconds";

/** True for errors that another attempt might get past. */
function isRetryable(cause: unknown): boolean {
  // A RangeError is the caller's argument, not the backend: a bad cursor or a
  // negative limit is refused identically however many times it is sent.
  if (cause instanceof RangeError) return false;
  if (cause instanceof UpstreamError) return cause.status >= 500;
  if (!(cause instanceof Error)) return true;
  return !/\b(4\d\d|invalid|unauthori[sz]ed|forbidden|not found)\b/i.test(cause.message);
}

/** One connector call as a typed failure, with neither a timeout nor a retry. */
function attempt<A>(
  connector: StoreConnector,
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, StoreRejected | StoreUnavailable> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      isRetryable(cause)
        ? new StoreUnavailable({ connector: connector.name, operation, cause })
        : new StoreRejected({ connector: connector.name, operation, cause }),
  });
}

/**
 * Typed failure, a timeout and the retry policy. A write is retried like a
 * read, and `docs/connectors.md` records what that costs a non-idempotent one.
 */
function call<A>(
  connector: StoreConnector,
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, StoreRejected | StoreUnavailable> {
  return attempt(connector, operation, run).pipe(
    Effect.timeoutFail({
      duration: CALL_TIMEOUT,
      onTimeout: () =>
        new StoreUnavailable({
          connector: connector.name,
          operation,
          cause: new Error(`Timed out after ${CALL_TIMEOUT}.`),
        }),
    }),
    Effect.retry({ schedule: RETRY_POLICY, while: (error) => error._tag === "StoreUnavailable" }),
  );
}

/** Restates a tagged failure as the public error type. */
function toPublicError(error: StoreRejected | StoreUnavailable): MapleStoreError {
  const reason = error._tag === "StoreUnavailable" ? "unavailable" : "rejected";
  return new MapleStoreError(reason, error.connector, error.operation, error.cause);
}

/**
 * Runs the program, rejecting with a plain MapleStoreError: Effect.runPromise
 * would reject with a FiberFailure and put Effect in front of every caller.
 */
async function run<A>(program: Effect.Effect<A, StoreRejected | StoreUnavailable>): Promise<A> {
  const exit = await Effect.runPromiseExit(program.pipe(Effect.mapError(toPublicError)));
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  throw Option.getOrElse(failure, () => new Error(Cause.pretty(exit.cause)));
}

/** Lists comments, retrying transient failures. */
export function listComments(connector: StoreConnector, query: ListQuery): Promise<CommentPage> {
  return run(call(connector, "list", () => connector.list(query)));
}

/** Appends a comment, retrying transient failures. */
export function appendComment(connector: StoreConnector, comment: NewComment): Promise<Comment> {
  return run(call(connector, "append", () => connector.append(comment)));
}

/**
 * Appends several. One write where the connector takes a batch, one call each
 * where it does not, so a caller never has to ask which kind it has.
 */
export async function appendComments(
  connector: StoreConnector,
  comments: readonly NewComment[],
): Promise<readonly Comment[]> {
  const many = connector.appendMany?.bind(connector);
  if (many) return await run(call(connector, "appendMany", () => many(comments)));

  const stored: Comment[] = [];
  for (const comment of comments) stored.push(await appendComment(connector, comment));
  return stored;
}

/** Sets a comment's status. Resolves to null when the connector cannot do it. */
export function setCommentStatus(
  connector: StoreConnector,
  id: string,
  status: CommentStatus,
  resolution?: CommentResolution,
): Promise<Comment | null> {
  const setStatus = connector.setStatus?.bind(connector);
  if (!setStatus) return Promise.resolve(null);
  return run(call(connector, "setStatus", () => setStatus(id, status, resolution)));
}

/**
 * The commit a surface points at now. Undefined for a connector that cannot
 * say and for a branch with no head; the capability report tells them apart.
 * Never memoised: a push moves the head and a cached one gates the wrong commit.
 */
export function headCommit(connector: StoreConnector, branch: string): Promise<string | undefined> {
  const head = connector.head?.bind(connector);
  if (!head) return Promise.resolve(undefined);
  return run(call(connector, "head", () => head(branch)));
}

/**
 * Long-polls for new comments, or undefined where the connector cannot.
 *
 * Neither timed out nor retried: the poll is documented to resolve empty when
 * its own window closes, so CALL_TIMEOUT would turn a quiet period into a
 * failure, and a retry would re-enter it on a signal the caller already spent.
 */
export function watchComments(
  connector: StoreConnector,
  query: ListQuery,
  signal: AbortSignal,
): Promise<CommentPage | undefined> {
  const watch = connector.watch?.bind(connector);
  if (!watch) return Promise.resolve(undefined);
  return run(attempt(connector, "watch", () => watch(query, signal)));
}

/**
 * Approvals on a surface. Undefined is a connector that keeps none, which the
 * gate reports as neutral; an empty array is a connector that keeps them and
 * holds none, which is "nobody approved". The two must never be conflated.
 */
export function listApprovals(
  connector: StoreConnector,
  branch: string,
): Promise<readonly Approval[] | undefined> {
  const approvals = connector.approvals?.bind(connector);
  if (!approvals) return Promise.resolve(undefined);
  return run(call(connector, "approvals", () => approvals(branch)));
}

/** Records an approval. Resolves to null when the connector keeps none. */
export function approveSurface(
  connector: StoreConnector,
  approval: NewApproval,
): Promise<Approval | null> {
  const approve = connector.approve?.bind(connector);
  if (!approve) return Promise.resolve(null);
  return run(call(connector, "approve", () => approve(approval)));
}

/** Takes one back. Resolves false when the connector cannot withdraw one. */
export async function unapproveSurface(connector: StoreConnector, id: string): Promise<boolean> {
  const unapprove = connector.unapprove?.bind(connector);
  if (!unapprove) return false;

  await run(call(connector, "unapprove", () => unapprove(id)));
  return true;
}
