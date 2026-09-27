/**
 * The weekly sweep's jev pass: the same judge and the same questions as a
 * pull request's, over every commit since `--since` and every doc, including
 * docs those commits edited, which the pull-request pass skips. Writes a JSON
 * summary to `--out`; without `TYPESAFE_API_KEY` the summary says it skipped.
 * `node tools/doc-drift/sweep.ts --since "8 days ago" --out <file>`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { extractParagraphs, isChecked, repositoryFiles } from "../doc-references/check.ts";
import { findCandidates } from "./candidates.ts";
import { isFlagged } from "./comment.ts";
import { parseDiff } from "./diff.ts";
import { createJudge } from "./judge.ts";
import { FLAG_AT, judgeAll } from "./run.ts";

import type { Candidate } from "./candidates.ts";
import type { Judged } from "./comment.ts";
import type { Reason } from "./judge.ts";

/** A week's change reaches more paragraphs than a pull request's; past this they are counted. */
export const SWEEP_CANDIDATES = 150;

/** One paragraph jev flagged. */
export interface DriftFlag {
  readonly end: number;
  readonly file: string;
  readonly reason: Reason;
  readonly stale: number;
  readonly start: number;
  readonly via: readonly string[];
}

/** What the sweep's issue says about jev. */
export interface DriftSummary {
  /** The commit the window starts from. */
  readonly base?: string | undefined;
  readonly failed: number;
  readonly flagAt: number;
  readonly flagged: readonly DriftFlag[];
  readonly judged: number;
  /** Why nothing was judged, when nothing was. */
  readonly skipped?: string;
  readonly unjudged: number;
}

/** The summary of one pass, flagged paragraphs most likely stale first. */
export function summarize(
  judged: readonly Judged[],
  unjudged: number,
  base: string | undefined,
): DriftSummary {
  const flagged = judged
    .filter((one) => isFlagged(one, FLAG_AT))
    .map(({ candidate, verdict }) => ({
      end: candidate.paragraph.end,
      file: candidate.paragraph.file,
      reason: verdict?.reason ?? "behaviour",
      stale: verdict?.stale ?? 0,
      start: candidate.paragraph.start,
      via: candidate.via,
    }))
    .toSorted((a, b) => b.stale - a.stale);
  return {
    base,
    failed: judged.filter((one) => one.error !== undefined).length,
    flagAt: FLAG_AT,
    flagged,
    judged: judged.length,
    unjudged,
  };
}

/** The commit at the start of the window: the last one before `since`, else the first. */
export function windowStart(root: string, since: string): string {
  const before = git(root, "rev-list", "-1", `--before=${since}`, "HEAD").trim();
  if (before !== "") return before;
  return git(root, "rev-list", "--max-parents=0", "HEAD").trim().split("\n").at(-1) ?? "HEAD";
}

/** Every paragraph in every checked doc that the code changed since `base` reaches. */
export function sweepCandidates(root: string, base: string): Candidate[] {
  const hunks = parseDiff(git(root, "diff", "--no-color", "--unified=3", base, "HEAD"));
  const files = repositoryFiles(root);
  const roots = new Set([...files.map((file) => file.split("/")[0] ?? ""), "src", "test"]);
  const paragraphs = files
    .filter((file) => isChecked(file))
    .flatMap((file) => extractParagraphs(file, readFileSync(join(root, file), "utf8"), roots));
  return findCandidates(paragraphs, hunks, new Set());
}

/**
 * At most `max` candidates, taken one per doc in turn, so the cap thins every
 * doc rather than dropping the docs that sort last. Each doc keeps its order.
 */
export function spread(candidates: readonly Candidate[], max: number): Candidate[] {
  const byFile = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const file = candidate.paragraph.file;
    byFile.set(file, [...(byFile.get(file) ?? []), candidate]);
  }
  const queues = [...byFile.values()];
  const taken: Candidate[] = [];
  for (let round = 0; taken.length < max && queues.some((queue) => round < queue.length); round++) {
    for (const queue of queues) {
      const next = queue[round];
      if (next !== undefined && taken.length < max) taken.push(next);
    }
  }
  return taken;
}

function git(root: string, ...args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one CI runs.
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: "string" }, since: { type: "string", default: "8 days ago" } },
    strict: true,
  });
  if (values.out === undefined) throw new Error("doc-drift sweep needs --out.");
  const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
  if (apiKey === "") {
    const skipped = "TYPESAFE_API_KEY is not set, so jev judged nothing.";
    process.stderr.write(`doc-drift sweep: ${skipped}\n`);
    const summary: DriftSummary = {
      failed: 0,
      flagAt: FLAG_AT,
      flagged: [],
      judged: 0,
      skipped,
      unjudged: 0,
    };
    writeFileSync(values.out, `${JSON.stringify(summary, undefined, 2)}\n`);
    return;
  }
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const base = windowStart(root, values.since);
  const all = sweepCandidates(root, base);
  const sent = spread(all, SWEEP_CANDIDATES);
  const judge = createJudge({ apiKey, model: process.env["MAPLE_AI_MODEL"] });
  const summary = summarize(await judgeAll(sent, judge), all.length - sent.length, base);
  writeFileSync(values.out, `${JSON.stringify(summary, undefined, 2)}\n`);
  process.stderr.write(
    `doc-drift sweep: since ${base.slice(0, 7)}, ${String(all.length)} candidates, ${String(summary.judged)} judged, ${String(summary.flagged.length)} flagged.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
