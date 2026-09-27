/**
 * Flags prose a pull request's code change may have made false, as advice.
 * Reads the diff from `--base` to `--head`, finds paragraphs in untouched
 * docs whose references reach it, asks jev about each, and writes the comment
 * body to `--out` with the flagged count beside it in `<out>.count`. Without
 * `TYPESAFE_API_KEY` it says so and exits 0, writing nothing. It never fails
 * a build on what it finds. Run it as
 * `node tools/doc-drift/run.ts --base <sha> --head <sha> --out <file> --repository <owner/name>`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { extractParagraphs, isChecked, repositoryFiles } from "../doc-references/check.ts";
import { findCandidates } from "./candidates.ts";
import { isFlagged, renderComment } from "./comment.ts";
import { isCode, parseDiff } from "./diff.ts";
import { candidateState, createJudge } from "./judge.ts";

import type { Candidate } from "./candidates.ts";
import type { Judged } from "./comment.ts";
import type { DriftState, Verdict } from "./judge.ts";

/**
 * A paragraph is listed from here. Chosen on the doc-drift evals, and moved
 * only by what they measure: `evals/cases/doc-drift/README.md` has the sweep.
 */
export const FLAG_AT = 0.4;

/** Past this many candidates the rest are counted, not sent. */
export const MAX_CANDIDATES = 40;

const IN_FLIGHT = 4;

/** Judges every candidate, at most {@link IN_FLIGHT} at once, results in order. */
export async function judgeAll(
  candidates: readonly Candidate[],
  judge: (state: DriftState) => Promise<Verdict>,
): Promise<Judged[]> {
  const results: Judged[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let at = next++; at < candidates.length; at = next++) {
      const candidate = candidates[at]!;
      try {
        results[at] = { candidate, verdict: await judge(candidateState(candidate)) };
      } catch (error) {
        results[at] = { candidate, error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, candidates.length) }, worker));
  return results;
}

/** The candidates for the change from `base` to `head` in the checkout at `root`. */
export function candidatesIn(root: string, base: string, head: string): Candidate[] {
  const hunks = parseDiff(git(root, "diff", "--no-color", "--unified=3", `${base}...${head}`));
  const names = git(root, "diff", "--name-only", `${base}...${head}`).split("\n");
  const touched = new Set(names.filter((file) => file !== "" && !isCode(file)));
  const files = repositoryFiles(root);
  const roots = new Set([...files.map((file) => file.split("/")[0] ?? ""), "src", "test"]);
  const paragraphs = files
    .filter((file) => isChecked(file) && !touched.has(file))
    .flatMap((file) => extractParagraphs(file, readFileSync(join(root, file), "utf8"), roots));
  return findCandidates(paragraphs, hunks, touched);
}

function git(root: string, ...args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one CI runs.
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      out: { type: "string" },
      repository: { type: "string", default: "maple-kit/maple" },
    },
    strict: true,
  });
  const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
  if (apiKey === "") {
    process.stderr.write(
      "doc-drift: TYPESAFE_API_KEY is not set, so nothing is judged. A pull request from a fork gets no secrets; this is expected there. Skipping.\n",
    );
    return;
  }
  if (values.base === undefined || values.out === undefined) {
    throw new Error("doc-drift needs --base and --out.");
  }
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const all = candidatesIn(root, values.base, values.head);
  const sent = all.slice(0, MAX_CANDIDATES);
  const model = process.env["MAPLE_AI_MODEL"];
  const judged = await judgeAll(sent, createJudge({ apiKey, model }));
  const sha = git(root, "rev-parse", values.head).trim();
  const context = {
    flagAt: FLAG_AT,
    repository: values.repository,
    sha,
    unjudged: all.length - sent.length,
  };
  const flagged = judged.filter((one) => isFlagged(one, FLAG_AT)).length;
  writeFileSync(values.out, renderComment(judged, context));
  writeFileSync(`${values.out}.count`, `${String(flagged)}\n`);
  for (const one of judged) {
    const { file, start } = one.candidate.paragraph;
    const outcome =
      one.verdict === undefined
        ? `error: ${one.error ?? ""}`
        : `${one.verdict.stale.toFixed(2)} ${one.verdict.reason}`;
    process.stderr.write(`${file}:${String(start)} ${outcome}\n`);
  }
  process.stderr.write(
    `doc-drift: ${String(all.length)} candidates, ${String(judged.length)} judged, ${String(flagged)} flagged at p >= ${String(FLAG_AT)}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
