/**
 * Moves every version pin to the current release while the version pull
 * request is made: `pnpm version-packages` runs it after `changeset version`.
 * Each `0.x.y` the stale-version guard would flag is rewritten to its package's
 * package.json version, the plugin's MCP pins (server and hook) to @maple-kit/mcp's, and when
 * anything under plugins/maple moved, plugin.json's version gets a patch bump:
 * installed plugins update only when it changes. Rewritten Markdown is
 * formatted with prettier, so a longer version cannot misalign a table.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as prettier from "prettier";

import {
  compareVersions,
  markdownFiles,
  MCP_PINNED,
  mcpPins,
  packageVersions,
  versionMentions,
} from "./check.ts";

/** Where the plugin manifest lives, relative to the root. */
export const PLUGIN_MANIFEST = "plugins/maple/.claude-plugin/plugin.json";

/** `text` with every stale version mention moved to its package's current. */
export function syncProse(text: string, current: ReadonlyMap<string, string>): string {
  const lines = text.split("\n");
  const mentions = versionMentions(text).toSorted((a, b) => b.column - a.column);
  for (const { column, line, name, version } of mentions) {
    const latest = current.get(name);
    const content = lines[line - 1];
    if (latest === undefined || content === undefined || compareVersions(version, latest) >= 0) {
      continue;
    }
    lines[line - 1] = content.slice(0, column) + latest + content.slice(column + version.length);
  }
  return lines.join("\n");
}

/** `text` with every `@maple-kit/mcp@x.y.z` pin set to `version`. */
export function syncPins(text: string, version: string): string {
  let next = text;
  for (const pin of mcpPins(text).toReversed()) {
    next = next.slice(0, pin.index) + version + next.slice(pin.index + pin.version.length);
  }
  return next;
}

/** `version` with its patch number one higher. */
export function bumpPatch(version: string): string {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return `${major}.${minor}.${Number(patch) + 1}`;
}

/** `manifest` (plugin.json text) with its version patch-bumped. */
export function bumpManifest(manifest: string): string {
  return manifest.replace(/("version"\s*:\s*")(\d+\.\d+\.\d+)(")/, (_match, open, version, close) =>
    [open, bumpPatch(version as string), close].join(""),
  );
}

/** Rewrites every file under `root` that needs it; returns the paths written. */
export async function syncRepository(root: string): Promise<string[]> {
  const current = packageVersions(root);
  const written: string[] = [];
  const write = (file: string, text: string) => {
    writeFileSync(join(root, file), text);
    written.push(file);
  };
  for (const file of markdownFiles(root)) {
    const text = readFileSync(join(root, file), "utf8");
    const synced = syncProse(text, current);
    if (synced === text) continue;
    const options = await prettier.resolveConfig(join(root, file));
    write(file, await prettier.format(synced, { ...options, filepath: file }));
  }
  const mcp = current.get("@maple-kit/mcp");
  for (const file of MCP_PINNED) {
    if (mcp === undefined || !existsSync(join(root, file))) continue;
    const text = readFileSync(join(root, file), "utf8");
    if (syncPins(text, mcp) !== text) write(file, syncPins(text, mcp));
  }
  if (written.some((file) => file.startsWith("plugins/maple/"))) {
    write(PLUGIN_MANIFEST, bumpManifest(readFileSync(join(root, PLUGIN_MANIFEST), "utf8")));
  }
  return written;
}

async function main(): Promise<void> {
  const written = await syncRepository(fileURLToPath(new URL("../..", import.meta.url)));
  for (const file of written) process.stdout.write(`${file}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
