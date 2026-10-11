/**
 * Turning a finding into a comment, which is what pins it on the page.
 *
 * The overlay draws marks from comments, and a finding already carries the
 * cascade's anchor, so this is a shape change and nothing more. It is a
 * separate export on purpose: a run does not do it, a host chooses to.
 * discussion #112 is still deciding whether findings belong in the ledger at
 * all, and this decides nothing for it.
 */

import { ADVISORY_AUTHORS } from "@maple-kit/core";

import type { RenderedRun } from "./rendered/audit.js";
import type { Finding } from "./types.js";
import type { Comment, CommentAuthor, CommentContext } from "@maple-kit/core";

/** Who a finding is from. Not a person, and it says so. */
export const LINT_AUTHOR: CommentAuthor = {
  id: ADVISORY_AUTHORS[0] ?? "maple-lint",
  name: "Maple lint",
  provenance: "server",
};

/** What a comment needs that a finding does not carry. */
export interface FindingCommentOptions {
  /** The branch or pull request the preview is for. */
  readonly branch: string;
  /** The environment it was seen in, from the run that found it. */
  readonly context: CommentContext;
  /** The commit the preview was serving, where the caller knows it. */
  readonly commit?: string;
  readonly author?: CommentAuthor;
  /** When the run happened. Defaults to now; a test passes its own. */
  readonly now?: string;
}

/**
 * FNV-1a, for an id that is the same on every run over the same page: a random
 * one would append the same finding again on each run.
 */
function hash(value: string): string {
  let result = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01_00_01_93) >>> 0;
  }
  return result.toString(36);
}

/** The rung the id is counted from: the most durable one the page supplied. */
function place(finding: Finding): string {
  const { anchor } = finding;
  return anchor.key ?? anchor.source ?? anchor.selector ?? anchor.component ?? "";
}

/**
 * A stable id for a finding on a branch. Two runs over an unchanged page
 * produce the same one, so a store that already holds it can say so.
 */
export function findingCommentId(finding: Finding, branch: string): string {
  const identity = `${branch}|${finding.rule}|${place(finding)}|${finding.message}`;
  return `lint_${hash(identity)}`;
}

/** The body a reviewer reads: what is wrong, then which rule says so. */
function bodyOf(finding: Finding): string {
  const rule = finding.url === undefined ? finding.rule : `${finding.rule} — ${finding.url}`;
  return `${finding.message}\n\n${rule}`;
}

/** One finding as a comment the overlay can pin. */
export function findingComment(finding: Finding, options: FindingCommentOptions): Comment {
  return {
    id: findingCommentId(finding, options.branch),
    branch: options.branch,
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    body: bodyOf(finding),
    status: "open",
    createdAt: options.now ?? new Date().toISOString(),
    author: options.author ?? LINT_AUTHOR,
    anchor: finding.anchor,
    context: options.context,
  };
}

/** Every finding as a comment, in the order they were found. */
export function findingComments(
  findings: readonly Finding[],
  options: FindingCommentOptions,
): readonly Comment[] {
  return findings.map((finding) => findingComment(finding, options));
}

/** What a run needs beyond itself to become comments. */
export type RunCommentOptions = Omit<FindingCommentOptions, "context">;

/**
 * A whole run as comments, each keeping the environment it was seen in. A
 * finding found only at 375px stores 375px rather than the run's widest.
 */
export function commentsForRun(run: RenderedRun, options: RunCommentOptions): readonly Comment[] {
  return run.findings.map((finding, index) =>
    findingComment(finding, { ...options, context: run.contexts[index] ?? run.context }),
  );
}
