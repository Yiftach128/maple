/**
 * Renders the weekly sweep's one tracking issue from what run.ts found. The
 * marker on the first line identifies the body; the workflow finds the issue
 * by its label and rewrites it every run, closing it when nothing is found.
 * `node tools/sweep/report.ts --in sweep.json --out body.md [--bump-pr <url>]`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { DriftSummary } from "../doc-drift/sweep.ts";
import type { Finding } from "./pins.ts";

/** The first line of the issue body. */
export const MARKER = "<!-- maple-sweep -->";

/** One layer-1 check run over the whole tree. */
export interface CheckResult {
  readonly command: string;
  readonly name: string;
  readonly ok: boolean;
  readonly output: string;
}

/** Everything one run found, as run.ts writes it. */
export interface Sweep {
  /** maple-action's pins, or why its manifest could not be read. */
  readonly action: { readonly error: string } | { readonly findings: readonly Finding[] };
  readonly checks: readonly CheckResult[];
  readonly drift: DriftSummary;
  /** Pending changesets and the plugin version since `base`, the window's first commit. */
  readonly history: { readonly base: string; readonly problems: readonly string[] };
  /** Every name's latest published version that the registry answered. */
  readonly latest: Readonly<Record<string, string>>;
  readonly pins: readonly Finding[];
  readonly registryErrors: readonly string[];
  readonly repository: string;
  readonly sha: string;
  readonly since: string;
}

/** What the report adds from the jobs after the sweep. */
export interface Outcome {
  /** The bump pull request, when one was opened or updated. */
  readonly bumpPr?: string | undefined;
  /** The bump job's result, when it ran and did not succeed. */
  readonly bumpResult?: string | undefined;
  readonly runUrl?: string | undefined;
}

/** How many things the run found. Zero closes the issue. */
export function countFindings(sweep: Sweep): number {
  const action = "error" in sweep.action ? 1 : sweep.action.findings.length;
  return (
    sweep.pins.length +
    action +
    sweep.checks.filter((check) => !check.ok).length +
    sweep.history.problems.length +
    sweep.drift.flagged.length
  );
}

const STATUS: Record<Finding["status"], string> = {
  ahead: "newer than anything published",
  behind: "behind",
  loose: "not an exact pin",
  unknown: "latest could not be read",
};

/** The issue body for one run. */
export function renderIssue(sweep: Sweep, outcome: Outcome = {}): string {
  const found = countFindings(sweep);
  const sha = `\`${sweep.sha.slice(0, 7)}\``;
  const run = outcome.runUrl === undefined ? "" : ` ([this run](${outcome.runUrl}))`;
  const lines = [
    MARKER,
    `## Weekly sweep at ${sha}`,
    "",
    found === 0
      ? `Nothing found. Commits since ${sweep.since} were read.`
      : `${count(found, "finding")}. Drift that landed outside any pull request's checks, over the whole tree and the commits since ${sweep.since}.`,
    "",
    ...pinSection(sweep, outcome),
    ...actionSection(sweep),
    ...checkSection(sweep),
    ...historySection(sweep),
    ...driftSection(sweep),
    `_Rewritten by \`.github/workflows/sweep.yml\` every week${run}, and closed when a run finds nothing._`,
  ];
  return `${lines.join("\n")}\n`;
}

function pinSection(sweep: Sweep, outcome: Outcome): string[] {
  const lines = ["### Pins in this repository", ""];
  if (sweep.pins.length === 0) {
    lines.push("Every pin is the latest published version.");
  } else {
    lines.push(...pinTable(sweep.pins, sweep));
    if (outcome.bumpPr !== undefined) lines.push("", `Bump pull request: ${outcome.bumpPr}.`);
    if (outcome.bumpResult === "failure" || outcome.bumpResult === "cancelled") {
      lines.push("", `The bump job ended \`${outcome.bumpResult}\`; its log says why.`);
    }
  }
  for (const error of sweep.registryErrors) lines.push("", `- Registry: ${error}`);
  return [...lines, ""];
}

function actionSection(sweep: Sweep): string[] {
  const lines = ["### maple-kit/maple-action", ""];
  if ("error" in sweep.action) {
    lines.push(`Its package.json could not be read: ${sweep.action.error}`);
  } else if (sweep.action.findings.length === 0) {
    lines.push("Its `@maple-kit/*` pins are the latest published versions.");
  } else {
    lines.push(
      ...pinTable(sweep.action.findings, {
        ...sweep,
        repository: "maple-kit/maple-action",
        sha: "main",
      }),
      "",
      "This workflow's token cannot open a pull request there; bump it by hand.",
    );
  }
  return [...lines, ""];
}

function checkSection(sweep: Sweep): string[] {
  const lines = ["### Layer 1 over the whole tree", ""];
  for (const check of sweep.checks) {
    lines.push(`- ${check.name} ${check.ok ? "passed" : "failed"}: \`${check.command}\``);
  }
  for (const check of sweep.checks.filter((one) => !one.ok)) {
    lines.push(
      "",
      `<details><summary>${check.name}</summary>`,
      "",
      fence(check.output),
      "",
      "</details>",
    );
  }
  return [...lines, ""];
}

function historySection(sweep: Sweep): string[] {
  const { base, problems } = sweep.history;
  const lines = ["### Checks that read a diff", ""];
  lines.push(
    `changeset-level on each pending changeset, against the commit that added it; the plugin version against every plugin change since \`${base.slice(0, 7)}\`.`,
  );
  lines.push("", ...(problems.length === 0 ? ["No problem."] : problems.map((one) => `- ${one}`)));
  return [...lines, ""];
}

function driftSection(sweep: Sweep): string[] {
  const drift = sweep.drift;
  const lines = ["### jev over every doc", ""];
  if (drift.skipped !== undefined) return [...lines, `Skipped: ${drift.skipped}`, ""];
  lines.push(
    `jev read ${count(drift.judged, "paragraph")} that name code changed since ${sweep.since}; ${String(drift.flagged.length)} at p ≥ ${String(drift.flagAt)}.`,
  );
  if (drift.flagged.length > 0) {
    lines.push("", "| Paragraph | p(stale) | Reason | Via |", "| --- | --- | --- | --- |");
    for (const flag of drift.flagged) {
      const where = `${flag.file}:${String(flag.start)}`;
      const url = `https://github.com/${sweep.repository}/blob/${sweep.sha}/${flag.file}#L${String(flag.start)}-L${String(flag.end)}`;
      lines.push(
        `| [${where}](${url}) | ${flag.stale.toFixed(2)} | ${flag.reason} | ${flag.via.map(code).join(", ")} |`,
      );
    }
  }
  if (drift.failed > 0) lines.push("", `${count(drift.failed, "paragraph")} could not be judged.`);
  if (drift.unjudged > 0)
    lines.push("", `${count(drift.unjudged, "more paragraph")} matched and were not sent.`);
  return [...lines, ""];
}

function pinTable(
  findings: readonly Finding[],
  where: Pick<Sweep, "repository" | "sha">,
): string[] {
  const rows = findings.map((finding) => {
    const at =
      finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`;
    const anchor = finding.line === undefined ? "" : `#L${String(finding.line)}`;
    const url = `https://github.com/${where.repository}/blob/${where.sha}/${finding.file}${anchor}`;
    const latest = finding.latest === undefined ? "" : code(finding.latest);
    const moved = finding.fixable ? "" : " (report only)";
    return `| [${at}](${url}) | ${code(finding.name)} | ${code(finding.version)} | ${latest} | ${STATUS[finding.status]}${moved} |`;
  });
  return [
    "| Where | Package | Pinned | Latest | Status |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ];
}

function fence(text: string): string {
  const trimmed = text.trim().split("\n").slice(0, 80).join("\n");
  return ["```", trimmed.replaceAll("```", "ʼʼʼ"), "```"].join("\n");
}

function code(text: string): string {
  return `\`${text}\``;
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "bump-pr": { type: "string" },
      "bump-result": { type: "string" },
      in: { type: "string" },
      out: { type: "string" },
      "run-url": { type: "string" },
    },
    strict: true,
  });
  if (values.in === undefined || values.out === undefined)
    throw new Error("report needs --in and --out.");
  const sweep = JSON.parse(readFileSync(values.in, "utf8")) as Sweep;
  const outcome = {
    bumpPr: values["bump-pr"] || undefined,
    bumpResult: values["bump-result"] || undefined,
    runUrl: values["run-url"] || undefined,
  };
  writeFileSync(values.out, renderIssue(sweep, outcome));
  writeFileSync(`${values.out}.count`, `${String(countFindings(sweep))}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
