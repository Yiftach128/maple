/**
 * Does jev tell a paragraph a code change made false from one it did not?
 *
 * Each case pairs a paragraph with the hunk that decides it: the stale ones
 * as they stood before the setup-docs audit, their rewrites as current. Three
 * tiers are scored: the trigger that picks candidates, a word-list judge, and
 * jev. cases/doc-drift says where every case came from.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findCandidates, spansIn } from "../tools/doc-drift/candidates.ts";
import { parseDiff } from "../tools/doc-drift/diff.ts";
import { createJudge, stateFor } from "../tools/doc-drift/judge.ts";
import { FLAG_AT } from "../tools/doc-drift/run.ts";
import { extractParagraphs, repositoryFiles } from "../tools/doc-references/check.ts";

import type { Hunk } from "../tools/doc-drift/diff.ts";
import type { Paragraph } from "../tools/doc-references/check.ts";

/** One paragraph, the change that decides it, and the label a reader would not argue with. */
interface Case {
  readonly id: string;
  readonly by: "agent" | "maintainer" | "reviewer";
  readonly label: "current" | "stale";
  readonly doc: string;
  /** The commit the paragraph is quoted from. */
  readonly at: string;
  readonly paragraph: string;
  readonly change: readonly {
    readonly commit: string;
    readonly diff: string;
    readonly file: string;
  }[];
}

const CASES = JSON.parse(
  readFileSync(new URL("./cases/doc-drift/cases.json", import.meta.url), "utf8"),
) as readonly Case[];

/** Measured, each just under what was measured; the README's table has the numbers. Raised, never lowered. */
const THRESHOLDS = {
  /** `audit` is the recall first measured, on the audit's cases alone; `all` is the whole set's. */
  trigger: { audit: 0.61, all: 0.76 },
  names: { accuracy: 0.52 },
  jev: { accuracy: 0.75 },
};

/** The commits the setup-docs audit's paragraphs are quoted from, before and after #270. */
const AUDIT = new Set(["8093648", "0ede164"]);

const ids = process.env["EVAL_IDS"]?.split(",").map((id) => id.trim());
const chosen = ids === undefined ? CASES : CASES.filter((one) => ids.includes(one.id));
const samples = Math.max(1, Number(process.env["EVAL_SAMPLES"] ?? "1"));
const verbose = process.env["EVAL_VERBOSE"] !== undefined;

const root = join(import.meta.dirname, "..");
const ROOTS = new Set([...repositoryFiles(root).map((file) => file.split("/")[0] ?? ""), "src"]);

function paragraphOf(one: Case): Paragraph {
  const [paragraph, ...rest] = extractParagraphs(one.doc, one.paragraph, ROOTS);
  if (paragraph === undefined || rest.length > 0) throw new Error(`${one.id}: not one paragraph`);
  return paragraph;
}

function hunksOf(one: Case): Hunk[] {
  return one.change.flatMap(({ diff, file }) =>
    parseDiff(`diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n${diff}`),
  );
}

/** Stale when a name the paragraph quotes is on a removed line and on no added one. */
function namesJudge(one: Case): boolean {
  const paragraph = paragraphOf(one);
  const names = [
    ...paragraph.references.map((reference) => reference.text.replace(/\(\)$/, "")),
    ...spansIn(paragraph.text),
  ];
  const hunks = hunksOf(one);
  const removed = hunks.flatMap((hunk) => hunk.removed).join("\n");
  const added = hunks.flatMap((hunk) => hunk.added).join("\n");
  return names.some((name) => removed.includes(name) && !added.includes(name));
}

/** The share of `results` that match their case's label. */
function accuracy(results: readonly { one: Case; stale: boolean }[]): number {
  if (results.length === 0) return 1;
  return (
    results.filter(({ one, stale }) => stale === (one.label === "stale")).length / results.length
  );
}

function misses(results: readonly { one: Case; stale: boolean }[]): string {
  return results
    .filter(({ one, stale }) => stale !== (one.label === "stale"))
    .map(({ one }) => one.id)
    .join(", ");
}

function reaches(one: Case): boolean {
  return findCandidates([paragraphOf(one)], hunksOf(one), new Set()).length === 1;
}

/**
 * Stale paragraphs `findCandidates` picks from their own hunk, as a share.
 * Verbose, it counts current ones picked too: each costs the judge a call.
 */
function recallOf(cases: readonly Case[], label: string): number {
  const stale = cases.filter((one) => one.label === "stale");
  const reached = stale.filter(reaches);
  const recall = stale.length === 0 ? 1 : reached.length / stale.length;
  if (verbose) {
    const missed = stale.filter((one) => !reached.includes(one)).map((one) => one.id);
    const current = cases.filter((one) => one.label === "current");
    const picked = current.filter(reaches).length;
    process.stdout.write(
      `trigger recall (${label}) ${recall.toFixed(3)}; misses ${missed.join(", ")}; ` +
        `current picked ${String(picked)} of ${String(current.length)}\n`,
    );
  }
  return recall;
}

describe("doc drift · the trigger", () => {
  it("reaches the audit's stale paragraphs from the hunk that decides them", () => {
    const seed = chosen.filter((one) => AUDIT.has(one.at));
    expect(recallOf(seed, "audit")).toBeGreaterThanOrEqual(THRESHOLDS.trigger.audit);
  });

  it("reaches every stale paragraph from the hunk that decides it", () => {
    expect(recallOf(chosen, "all")).toBeGreaterThanOrEqual(THRESHOLDS.trigger.all);
  });
});

describe("doc drift · the word-list judge", () => {
  it(`is the floor jev has to clear (${String(chosen.length)} cases)`, () => {
    const results = chosen.map((one) => ({ one, stale: namesJudge(one) }));
    if (verbose) {
      process.stdout.write(
        `names accuracy ${accuracy(results).toFixed(3)}; misses ${misses(results)}\n`,
      );
    }
    expect(accuracy(results)).toBeGreaterThanOrEqual(THRESHOLDS.names.accuracy);
  });
});

const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";

/** Skipped rather than failed without a credential, as the other model tiers are. */
describe.skipIf(apiKey === "")("doc drift · jev", () => {
  it("clears its threshold and beats the word list", async () => {
    const model = process.env["MAPLE_AI_MODEL"];
    const judge = createJudge({ apiKey, ...(model === undefined ? {} : { model }) });
    const results = [];
    // One sample at a time: the whole set at once is as much as one run should send.
    for (let sample = 0; sample < samples; sample++) {
      const run = chosen.map(async (one) => {
        const verdict = await judge(stateFor(one.doc, one.paragraph, hunksOf(one)));
        return { one, p: verdict.stale, reason: verdict.reason, stale: verdict.stale >= FLAG_AT };
      });
      results.push(...(await Promise.all(run)));
    }
    if (verbose) {
      for (const { one, p, reason } of results) {
        process.stdout.write(`${one.id} ${one.label} p=${p.toFixed(3)} ${reason}\n`);
      }
      process.stdout.write(
        `jev accuracy ${accuracy(results).toFixed(3)}; misses ${misses(results)}\n`,
      );
      // What choosing FLAG_AT reads: the same answers, cut at each other point.
      for (let at = 0.2; at < 0.81; at += 0.05) {
        const cut = results.map(({ one, p }) => ({ one, stale: p >= at }));
        process.stdout.write(`jev accuracy at ${at.toFixed(2)} ${accuracy(cut).toFixed(3)}\n`);
      }
    }
    const floor = accuracy(chosen.map((one) => ({ one, stale: namesJudge(one) })));
    expect(accuracy(results)).toBeGreaterThanOrEqual(THRESHOLDS.jev.accuracy);
    expect(accuracy(results)).toBeGreaterThan(floor);
  }, 600_000);
});
