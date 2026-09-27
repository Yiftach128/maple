/**
 * The one pull-request comment the job keeps: flagged paragraphs, each linked
 * at the head commit, with jev's probability and reason. The marker on its
 * first line is how the workflow finds the comment again to update it.
 */

import type { Candidate } from "./candidates.ts";
import type { Reason, Verdict } from "./judge.ts";

/** The first line of the comment, and how the workflow finds it. */
export const MARKER = "<!-- maple-doc-drift -->";

/** One candidate's outcome: a verdict, or why there is none. */
export interface Judged {
  readonly candidate: Candidate;
  readonly error?: string;
  readonly verdict?: Verdict;
}

/** Where the paragraphs are linked, and what was left out. */
export interface Context {
  /** A probability at or above this is flagged. */
  readonly flagAt: number;
  /** `owner/name`. */
  readonly repository: string;
  readonly sha: string;
  /** Candidates past the cap, never sent. */
  readonly unjudged: number;
}

const WHY: Record<Reason, string> = {
  behaviour: "describes behaviour the change altered",
  consistent: "already matches the change",
  renamed: "names something the change removed or renamed",
  unrelated: "not touched by the change",
};

/** Whether a verdict is flagged at `flagAt`. */
export function isFlagged(judged: Judged, flagAt: number): boolean {
  return judged.verdict !== undefined && judged.verdict.stale >= flagAt;
}

/** The comment body for one run. */
export function renderComment(judged: readonly Judged[], context: Context): string {
  const flagged = judged
    .filter((one) => isFlagged(one, context.flagAt))
    .toSorted((a, b) => (b.verdict?.stale ?? 0) - (a.verdict?.stale ?? 0));
  const failed = judged.filter((one) => one.error !== undefined).length;
  const lines = [
    MARKER,
    "### Docs this change may have made false",
    "",
    `jev read ${count(judged.length, "paragraph")} that name code this pull request changes, in docs it does not touch, at \`${context.sha.slice(0, 7)}\`.`,
    "",
  ];
  if (flagged.length === 0) {
    lines.push("None looks stale.");
  } else {
    lines.push("| Paragraph | p(stale) | Why | Via |", "| --- | --- | --- | --- |");
    for (const one of flagged) lines.push(row(one, context));
    lines.push("", ...flagged.map((one) => quoted(one.candidate)));
  }
  if (failed > 0) lines.push("", `${count(failed, "paragraph")} could not be judged.`);
  if (context.unjudged > 0) {
    lines.push("", `${count(context.unjudged, "more paragraph")} matched and were not sent.`);
  }
  lines.push(
    "",
    `_Advisory: this comment blocks nothing. A paragraph is listed at p ≥ ${String(context.flagAt)}; \`evals/cases/doc-drift\` decides when that becomes a check._`,
  );
  return `${lines.join("\n")}\n`;
}

function row(one: Judged, context: Context): string {
  const { paragraph, via } = one.candidate;
  const where = `${paragraph.file}:${String(paragraph.start)}`;
  const url = `https://github.com/${context.repository}/blob/${context.sha}/${paragraph.file}#L${String(paragraph.start)}-L${String(paragraph.end)}`;
  const verdict = one.verdict;
  const p = verdict === undefined ? "" : verdict.stale.toFixed(2);
  const why = verdict === undefined ? "" : WHY[verdict.reason];
  return `| [${where}](${url}) | ${p} | ${why} | ${via.map(code).join(", ")} |`;
}

function quoted(candidate: Candidate): string {
  const { paragraph, hunks } = candidate;
  const files = [...new Set(hunks.map((hunk) => hunk.file))].map(code);
  const text = paragraph.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `<details><summary>${paragraph.file}:${String(paragraph.start)}, against ${files.join(", ")}</summary>\n\n${text}\n\n</details>`;
}

function code(text: string): string {
  return `\`${text}\``;
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}
