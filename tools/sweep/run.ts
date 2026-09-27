/**
 * The weekly sweep. Compares every pin in this repository and maple-action's
 * `@maple-kit/*` pins with the registry's latest, runs each layer-1 check over
 * the whole tree and the diff-reading ones per commit since `--since`, and
 * writes it all to `--out` for report.ts and bump.ts. Findings never fail it.
 * `node tools/sweep/run.ts --out sweep.json [--since "8 days ago"] [--action-manifest f] [--drift f]`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { windowStart } from "../doc-drift/sweep.ts";
import { markdownFiles, MCP_PINNED } from "../doc-guards/check.ts";
import { checkHistory } from "./history.ts";
import { assess, docPinsIn, isBumpable, manifestPins, mcpPinsIn } from "./pins.ts";
import { latestVersions } from "./registry.ts";

import type { DriftSummary } from "../doc-drift/sweep.ts";
import type { Pin } from "./pins.ts";
import type { CheckResult, Sweep } from "./report.ts";

/** The layer-1 checks that already read the whole tree, as CI runs them. */
export const CHECKS: readonly { readonly args: readonly string[]; readonly name: string }[] = [
  { name: "doc-guards", args: ["tools/doc-guards/check.ts"] },
  { name: "doc-references", args: ["tools/doc-references/check.ts"] },
  { name: "docs-generate", args: ["tools/docs-generate/generate.ts", "--check"] },
  { name: "skill-links", args: ["tools/skill-links/check.ts"] },
];

/** Every pin in this repository: plugin MCP pins, doc mentions and example manifests. */
export function repositoryPins(root: string): Pin[] {
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const plugin = MCP_PINNED.filter((file) => existsSync(join(root, file))).flatMap((file) =>
    mcpPinsIn(file, read(file)),
  );
  const docs = markdownFiles(root).flatMap((file) => docPinsIn(file, read(file)));
  const examples = readdirSync(join(root, "examples"))
    .map((dir) => `examples/${dir}/package.json`)
    .filter((file) => existsSync(join(root, file)))
    .flatMap((file) => manifestPins(file, read(file)));
  return [...plugin, ...docs, ...examples];
}

/** maple-action's `@maple-kit/*` dependencies, from its package.json text. */
export function actionPins(text: string): Pin[] {
  return manifestPins("package.json", text, (name) => name.startsWith("@maple-kit/"));
}

function runCheck(root: string, check: (typeof CHECKS)[number]): CheckResult {
  const result = spawnSync(process.execPath, check.args, { cwd: root, encoding: "utf8" });
  return {
    command: `node ${check.args.join(" ")}`,
    name: check.name,
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}${result.error?.message ?? ""}`,
  };
}

function readAction(file: string | undefined): { error: string } | { pins: Pin[] } {
  if (file === undefined || !existsSync(file)) return { error: "the workflow could not fetch it." };
  try {
    return { pins: actionPins(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function readDrift(file: string | undefined): DriftSummary {
  if (file !== undefined && existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8")) as DriftSummary;
  }
  return {
    failed: 0,
    flagAt: 0,
    flagged: [],
    judged: 0,
    skipped: "the jev pass wrote no summary.",
    unjudged: 0,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "action-manifest": { type: "string" },
      drift: { type: "string" },
      out: { type: "string" },
      repository: {
        type: "string",
        default: process.env["GITHUB_REPOSITORY"] ?? "maple-kit/maple",
      },
      since: { type: "string", default: "8 days ago" },
    },
    strict: true,
  });
  if (values.out === undefined) throw new Error("sweep needs --out.");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const pins = repositoryPins(root);
  const action = readAction(values["action-manifest"]);
  const names = [...pins, ...("pins" in action ? action.pins : [])].map((pin) => pin.name);
  const latest = await latestVersions(names, { registry: process.env["NPM_CONFIG_REGISTRY"] });
  const base = windowStart(root, values.since);
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one CI runs.
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sweep: Sweep = {
    action: "pins" in action ? { findings: assess(action.pins, latest.versions) } : action,
    checks: CHECKS.map((check) => runCheck(root, check)),
    drift: readDrift(values.drift),
    history: { base, problems: checkHistory(root, base) },
    latest: Object.fromEntries(latest.versions),
    pins: assess(pins, latest.versions),
    registryErrors: latest.errors,
    repository: values.repository,
    sha: head,
    since: values.since,
  };
  writeFileSync(values.out, `${JSON.stringify(sweep, undefined, 2)}\n`);
  const bump = sweep.pins.some((finding) => isBumpable(finding));
  const output = process.env["GITHUB_OUTPUT"];
  if (output !== undefined) appendFileSync(output, `bump=${String(bump)}\n`);
  for (const check of sweep.checks)
    process.stderr.write(`${check.name}: ${check.ok ? "ok" : "failed"}\n`);
  process.stderr.write(
    `sweep: ${String(sweep.pins.length)} pin findings, ${String(sweep.history.problems.length)} history problems, bump=${String(bump)}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
