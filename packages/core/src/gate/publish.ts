/**
 * Re-reading a surface and publishing its verdict.
 *
 * It lives beside the decision rather than inside the route, because the
 * route is not the only thing that changes a comment's status: the agent's
 * `resolve_comment` does too, and a resolve that reports nothing leaves the
 * check holding on work already done.
 */

import { decideGate } from "./decide.js";

import type { GateConnector } from "../connectors/types.js";
import type { Logger } from "../logger/types.js";
import type { CommentStore } from "../store.js";
import type { Approval, Comment, GateVerdict } from "../types.js";

/** How many comments are read back before the verdict stops being exact. */
const PAGE = 100;

/**
 * Re-reads the surface and publishes a verdict for its head commit.
 *
 * Never throws. The status change has already happened by the time this runs,
 * and a gate that fails a resolve is worse than a gate that is briefly stale:
 * the reviewer did the thing, and the check is a report about it.
 */
export async function publishGate(
  context: GateContext,
  branch: string,
  reviewUrl?: string,
): Promise<void> {
  try {
    await publishVerdict(context, branch, reviewUrl);
  } catch (error) {
    context.logger?.error(
      "Maple could not publish the merge gate; the comment's status was saved.",
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/** What a publish needs, gathered once by the caller. */
export interface GateContext {
  readonly store: CommentStore;
  readonly gate: GateConnector;
  readonly logger?: Logger;
  /**
   * True when a quiet surface still needs somebody to say they looked at it.
   * `docs/gate.md` covers why that is off by default.
   */
  readonly requireApproval?: boolean;
}

/** What was published, and on which commit. */
export interface Published {
  readonly sha: string;
  readonly verdict: GateVerdict;
}

/**
 * {@link publishGate} for a caller that asked for nothing but the publish, so a
 * failure is its answer: it throws, and undefined means no head commit.
 */
export async function publishVerdict(
  context: GateContext,
  branch: string,
  reviewUrl?: string,
): Promise<Published | undefined> {
  const sha = await headOf(context, branch);
  if (sha === undefined) return undefined;

  const approvals = await approvalsOn(context, branch);
  const verdict = decideGate(await commentsOn(context.store, branch), {
    statusTracked: context.store.capabilities.setStatus,
    commit: sha,
    ...(context.requireApproval === undefined ? {} : { requireApproval: context.requireApproval }),
    ...(approvals === undefined ? {} : { approvals }),
  });

  await context.gate.publish({
    branch,
    sha,
    verdict,
    ...(reviewUrl === undefined ? {} : { reviewUrl }),
  });
  return { sha, verdict };
}

/**
 * Undefined is a store with nowhere to keep one, which the verdict reports as
 * neutral. Asked for even when none is required: the summary names who signed.
 */
async function approvalsOn(
  context: GateContext,
  branch: string,
): Promise<readonly Approval[] | undefined> {
  return await context.store.approvals(branch);
}

/**
 * A store that cannot name a commit means no publish: a verdict on a guessed
 * commit reads as an answer, which is worse than silence.
 */
async function headOf(context: GateContext, branch: string): Promise<string | undefined> {
  if (!context.store.capabilities.head) {
    context.logger?.warn(
      `Store "${context.store.name}" cannot name a head commit, so no gate was published.`,
    );
    return undefined;
  }

  const sha = await context.store.head(branch);
  if (sha === undefined) {
    context.logger?.warn(`No head commit for "${branch}", so no gate was published.`);
  }

  return sha;
}

/**
 * Every comment on the surface, not one page: a count that stopped at the
 * first page would clear a gate that holds.
 */
async function commentsOn(store: CommentStore, branch: string): Promise<Comment[]> {
  const comments: Comment[] = [];
  let cursor: string | undefined;

  do {
    const page = await store.list({
      branch,
      limit: PAGE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    comments.push(...page.comments);
    cursor = page.cursor;
  } while (cursor !== undefined && comments.length < PAGE * PAGE);

  return comments;
}
