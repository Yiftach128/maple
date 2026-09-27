/**
 * Moves every pin run.ts found behind to the registry's latest, for the bump
 * pull request. Doc mentions and the plugin's MCP pins move; manifests do not,
 * since they need a lockfile. A moved plugin file bumps plugin.json's patch,
 * as sync-versions.ts does. Writes the commit message to `--message`.
 * `node tools/sweep/bump.ts --in sweep.json --message <file>`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as prettier from "prettier";

import { bumpManifest, PLUGIN_MANIFEST, syncPins, syncProse } from "../doc-guards/sync-versions.ts";
import { isBumpable } from "./pins.ts";

import type { Finding } from "./pins.ts";
import type { Sweep } from "./report.ts";

/** The commit message for the pins moved, one line per package and version. */
export function bumpMessage(findings: readonly Finding[]): string {
  const moves = [
    ...new Set(findings.map((one) => `- ${one.name} ${one.version} -> ${one.latest ?? ""}`)),
  ];
  return [
    "chore: pin the latest published versions",
    "",
    "The weekly sweep found these pins behind the registry's latest. The",
    "policy is to pin the latest release exactly, and a pin that lags sends",
    "readers and the plugin to a version that is no longer current.",
    "",
    ...moves.toSorted((a, b) => a.localeCompare(b)),
    "",
  ].join("\n");
}

/** Rewrites the files under `root` that hold a bumpable finding; returns the paths written. */
export async function applyBumps(root: string, sweep: Sweep): Promise<string[]> {
  const bumpable = sweep.pins.filter((finding) => isBumpable(finding));
  const latest = new Map(Object.entries(sweep.latest));
  const written: string[] = [];
  for (const file of [...new Set(bumpable.map((finding) => finding.file))]) {
    const text = readFileSync(join(root, file), "utf8");
    const next = file.endsWith(".md")
      ? await formatted(root, file, syncProse(text, latest))
      : pinned(text, latest);
    if (next === text) continue;
    writeFileSync(join(root, file), next);
    written.push(file);
  }
  if (written.some((file) => file.startsWith("plugins/maple/"))) {
    const manifest = join(root, PLUGIN_MANIFEST);
    writeFileSync(manifest, bumpManifest(readFileSync(manifest, "utf8")));
    written.push(PLUGIN_MANIFEST);
  }
  return written;
}

function pinned(text: string, latest: ReadonlyMap<string, string>): string {
  const mcp = latest.get("@maple-kit/mcp");
  return mcp === undefined ? text : syncPins(text, mcp);
}

async function formatted(root: string, file: string, text: string): Promise<string> {
  const options = await prettier.resolveConfig(join(root, file));
  return prettier.format(text, { ...options, filepath: file });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { in: { type: "string" }, message: { type: "string" } },
    strict: true,
  });
  if (values.in === undefined || values.message === undefined) {
    throw new Error("bump needs --in and --message.");
  }
  const sweep = JSON.parse(readFileSync(values.in, "utf8")) as Sweep;
  const written = await applyBumps(fileURLToPath(new URL("../..", import.meta.url)), sweep);
  writeFileSync(values.message, bumpMessage(sweep.pins.filter((finding) => isBumpable(finding))));
  for (const file of written) process.stdout.write(`${file}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
