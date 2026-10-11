/**
 * Whether a review surface is clear to merge, decided from the comments alone.
 *
 * The decision is vendor-agnostic and the publication is not: a check run, an
 * external status check and a build status are three different APIs over this
 * one verdict. Keeping them apart is what keeps the check-run API out of core.
 */

import { nameMembers } from "../anchor/label.js";

import type { Approval, Comment, CommentStatus, GateVerdict } from "../types.js";

/** Statuses that hold the gate. Everything but `resolved`, by default. */
export const BLOCKING_STATUSES: readonly CommentStatus[] = ["open", "needs_reverify", "orphaned"];

/**
 * Author ids whose comments inform a review without holding it: design-lint
 * pins, which `maple/design-lint` already gates by severity. Exported so the
 * lint author's id and the gate's default read one definition.
 */
export const ADVISORY_AUTHORS: readonly string[] = ["maple-lint"];

/**
 * True when `id` is an advisory author. The one place the default list is
 * applied: `undefined` means {@link ADVISORY_AUTHORS}, `[]` means nobody.
 */
export function isAdvisoryId(
  id: string,
  advisoryAuthors: readonly string[] = ADVISORY_AUTHORS,
): boolean {
  return advisoryAuthors.includes(id);
}

/**
 * True for a comment the gate ignores: its author is advisory and server
 * provenance. The route refuses to post as an advisory id, so a reviewer
 * cannot take the exemption by choosing an identity.
 */
export function isAdvisory(comment: Comment, advisoryAuthors?: readonly string[]): boolean {
  return comment.author.provenance === "server" && isAdvisoryId(comment.author.id, advisoryAuthors);
}

/** How the verdict is reached. */
export interface GateOptions {
  /**
   * Which statuses hold the gate. Defaults to {@link BLOCKING_STATUSES}:
   * a comment nobody resolved is a comment nobody addressed.
   */
  readonly blockOn?: readonly CommentStatus[];
  /**
   * False when Maple is not reviewing this surface at all: a fork, a bot's
   * bump, a branch with no preview. Neither `unreadable` nor `no-comments`.
   */
  readonly hasReview?: boolean;
  /**
   * False when the store cannot record status, so nothing it reports can be
   * trusted to mean resolved. The verdict is then `neutral`, never `clear`.
   */
  readonly statusTracked?: boolean;
  /**
   * True when somebody has to say they looked. Off, a surface with no
   * comments clears, which cannot be told apart from one nobody opened.
   */
  readonly requireApproval?: boolean;
  /**
   * Every approval the store holds for this surface. Undefined is a store
   * that cannot keep one, which is `neutral` rather than "nobody approved".
   */
  readonly approvals?: readonly Approval[];
  /** The commit under judgement. An approval of another commit is not one. */
  readonly commit?: string;
  /**
   * Treat a comment resolved against an older commit as `needs_reverify`.
   * Nothing else ever writes that status, so this is what makes it reachable.
   */
  readonly reverifyResolved?: boolean;
  /**
   * Author ids whose comments are listed but never block or count.
   * Defaults to {@link ADVISORY_AUTHORS}; `[]` lets every author hold.
   */
  readonly advisoryAuthors?: readonly string[];
}

/**
 * Resolved against a commit that is no longer the head is resolved against a
 * page no longer on show. Off by default: `docs/gate.md` says why.
 */
function reverified(comment: Comment, options: GateOptions): Comment {
  if (options.reverifyResolved !== true || options.commit === undefined) return comment;
  if (comment.status !== "resolved") return comment;

  const against = comment.resolution?.sha;
  if (against === undefined || against === options.commit) return comment;

  return { ...comment, status: "needs_reverify" };
}

/** How many comments a summary lists before it stops naming them. */
const LISTED = 10;

/**
 * Decides the verdict for one surface. `comments` is undefined when the store
 * could not be read at all; `hasReview: false` is a surface Maple was never
 * reviewing. Both are neutral, and each says which one it is.
 */
export function decideGate(
  comments: readonly Comment[] | undefined,
  options: GateOptions = {},
): GateVerdict {
  const cannotTell = unjudgeable(comments, options);
  if (cannotTell) return cannotTell;

  const blockOn = options.blockOn ?? BLOCKING_STATUSES;
  const listed = (comments ?? []).map((comment) => reverified(comment, options));
  const all = listed.filter((comment) => !isAdvisory(comment, options.advisoryAuthors));
  const blocking = all.filter((comment) => blockOn.includes(comment.status));
  const counts = { open: blocking.length, total: all.length };

  if (blocking.length > 0) {
    return {
      ...counts,
      conclusion: "blocked",
      reason: "comments-open",
      title: `${String(blocking.length)} of ${String(all.length)} ${plural(all.length)} still open`,
      summary: listing(listed, blocking),
    };
  }

  const untracked = untrackedApproval(options);
  if (untracked) return untracked;

  const approved = approvalFor(options);
  if (options.requireApproval === true && !approved) {
    return { ...counts, conclusion: "blocked", ...unapproved(all.length) };
  }
  return { ...counts, conclusion: "clear", ...cleared(all.length === 0, approved) };
}

/**
 * The verdicts reached without looking at a single status, in the order they
 * have to be asked: a surface nobody is reviewing is not a store that failed.
 */
function unjudgeable(
  comments: readonly Comment[] | undefined,
  options: GateOptions,
): GateVerdict | undefined {
  if (options.hasReview === false) {
    return neutral(
      "no-review",
      "No visual review on this pull request",
      "Maple is not reviewing this pull request, so this check has nothing to hold it on.",
    );
  }
  if (comments === undefined) {
    return neutral("unreadable", NOT_CHECKED, `Maple could not read the comments${NO_ANSWER}`);
  }
  if (options.statusTracked === false) {
    return neutral(
      "status-untracked",
      NOT_CHECKED,
      `This store cannot record whether a comment was resolved${NO_ANSWER}`,
    );
  }
  return undefined;
}

/**
 * Nowhere to have recorded an approval, or no commit named to match one
 * against. Both are guesses, so both are neutral, and both after the comments.
 */
function untrackedApproval(options: GateOptions): GateVerdict | undefined {
  if (options.requireApproval !== true) return undefined;
  if (options.approvals !== undefined && options.commit !== undefined) return undefined;

  const missing =
    options.approvals === undefined
      ? "This store cannot record that anybody approved the preview"
      : "Nothing here names the commit the preview is serving, so an approval of it cannot be found";

  return neutral("approval-untracked", NOT_CHECKED, `${missing}${NO_ANSWER}`);
}

/** The approval for the commit under judgement. Another commit's is not one. */
function approvalFor(options: GateOptions): Approval | undefined {
  if (options.commit === undefined) return undefined;
  return options.approvals?.find((approval) => approval.commit === options.commit);
}

/** Nobody has said they looked, which is a different nothing from no comments. */
function unapproved(total: number): Pick<GateVerdict, "reason" | "title" | "summary"> {
  const looked =
    total === 0
      ? "Nobody has left a visual review comment on this pull request, and nobody has approved it either."
      : "Every visual review comment on this pull request is resolved, but nobody has approved the preview.";

  return {
    reason: "awaiting-approval",
    title: "Waiting for somebody to approve the preview",
    summary: `${looked}\n\nOpen the preview and approve it from the Maple overlay.`,
  };
}

function cleared(
  empty: boolean,
  approved: Approval | undefined,
): Pick<GateVerdict, "reason" | "title" | "summary"> {
  const reason = empty ? "no-comments" : "all-resolved";
  const title = empty ? "No visual review comments" : "Every comment is resolved";
  const summary = empty
    ? "Nobody has left a visual review comment on this pull request."
    : "Every visual review comment on this pull request has been resolved.";

  return { reason, ...signedOff(title, summary, approved) };
}

/** Who approved it, where one was asked for: a clear gate nobody stood behind
 * reads the same as one somebody did, and they are not the same thing. */
function signedOff(
  title: string,
  summary: string,
  approved: Approval | undefined,
): Pick<GateVerdict, "title" | "summary"> {
  if (!approved) return { title, summary };

  const note = approved.note === undefined ? "" : `\n\n> ${oneLine(approved.note)}`;
  return {
    title: `Approved by ${approved.author.name}`,
    summary: `${summary}\n\n${approved.author.name} approved this preview.${note}`,
  };
}

/** The title the "I cannot tell" neutrals share, and the way all of them end. */
const NOT_CHECKED = "Visual review was not checked";
const NO_ANSWER = ", so this check has nothing to say about them.";

/** A gate with nothing it can judge must not block, and must say which nothing. */
function neutral(reason: GateVerdict["reason"], title: string, summary: string): GateVerdict {
  return { conclusion: "neutral", reason, open: 0, total: 0, title, summary };
}

/**
 * The open comments, numbered as the pull-request table numbers them, so a
 * reviewer moving between the check and the table never translates.
 */
function listing(comments: readonly Comment[], blocking: readonly Comment[]): string {
  const lines = blocking
    .slice(0, LISTED)
    .map((comment) => `${String(comments.indexOf(comment) + 1)}. ${entry(comment)}`);

  const rest = blocking.length - lines.length;
  if (rest > 0) lines.push(`…and ${String(rest)} more.`);

  return ["These comments are still open:", "", ...lines].join("\n");
}

function entry(comment: Comment): string {
  const { anchor: recorded } = comment;
  const anchor =
    nameMembers(recorded) ?? recorded.component ?? recorded.source ?? recorded.selector;
  const where = anchor === undefined ? "" : `\`${anchor}\` — `;

  return `${where}${oneLine(comment.body)}${note(comment.status)}`;
}

/** Why a comment nobody reopened is nonetheless still holding the gate. */
function note(status: CommentStatus): string {
  if (status === "orphaned") return " _(unpinned)_";
  return status === "needs_reverify" ? " _(needs re-checking after a new commit)_" : "";
}

/** A markdown list item ends at a newline, so a multi-line body becomes one. */
function oneLine(body: string): string {
  return body.replaceAll(/\s+/g, " ").trim();
}

function plural(count: number): string {
  return count === 1 ? "comment" : "comments";
}
