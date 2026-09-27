/**
 * Every exact version pin the weekly sweep compares with the registry, and
 * how each compares. Policy is "always pin the latest, exactly", so a pin is
 * a finding when it is behind, ahead of anything published, not exact, or
 * names a package whose latest could not be read. Nothing here reads a file
 * or the network: the callers hand in text and the latest versions.
 */

import { mcpPins, versionMentions } from "../doc-guards/check.ts";

/** One pin, where it sits, and whether the bump pull request may move it. */
export interface Pin {
  readonly file: string;
  /** Moved by the bump pull request; otherwise only reported. */
  readonly fixable: boolean;
  /** From 1; absent for a manifest entry. */
  readonly line?: number | undefined;
  readonly name: string;
  readonly version: string;
}

/** What is wrong with a pin. A pin at the latest version is not a finding. */
export type Status = "ahead" | "behind" | "loose" | "unknown";

/** A pin that is not at the latest published version, and why. */
export interface Finding extends Pin {
  readonly latest?: string | undefined;
  readonly status: Status;
}

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Orders two exact versions; negative when `a` is older. A prerelease sorts before its release. */
export function compareExact(a: string, b: string): number {
  const [coreA = "", preA] = a.split(/-(.*)/);
  const [coreB = "", preB] = b.split(/-(.*)/);
  const left = coreA.split(".").map(Number);
  const right = coreB.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA.localeCompare(preB);
}

/** The findings among `pins`, given each package's latest published version. */
export function assess(pins: readonly Pin[], latest: ReadonlyMap<string, string>): Finding[] {
  return pins.flatMap((pin): Finding[] => {
    const newest = latest.get(pin.name);
    if (!EXACT.test(pin.version)) return [{ ...pin, latest: newest, status: "loose" }];
    if (newest === undefined) return [{ ...pin, status: "unknown" }];
    const order = compareExact(pin.version, newest);
    if (order === 0) return [];
    return [{ ...pin, latest: newest, status: order < 0 ? "behind" : "ahead" }];
  });
}

/** Whether a finding is one the bump pull request moves. */
export function isBumpable(finding: Finding): boolean {
  return finding.fixable && finding.status === "behind";
}

/** Each `@maple-kit/mcp@x.y.z` in a plugin file, with its line. */
export function mcpPinsIn(file: string, text: string): Pin[] {
  return mcpPins(text).map(({ index, version }) => ({
    file,
    fixable: true,
    line: text.slice(0, index).split("\n").length,
    name: "@maple-kit/mcp",
    version,
  }));
}

/** Each `0.x.y` next to an `@maple-kit/*` name in a Markdown file, as doc-guards reads them. */
export function docPinsIn(file: string, text: string): Pin[] {
  return versionMentions(text).map(({ line, name, version }) => ({
    file,
    fixable: true,
    line,
    name,
    version,
  }));
}

/** Which dependencies of a manifest to read, by name; all of them when absent. */
export type Only = (name: string) => boolean;

/**
 * Each dependency a package.json pins, skipping `workspace:` links and peer
 * ranges, which are ranges on purpose. Reported, never moved: a manifest
 * change needs a lockfile change, which is Dependabot's job.
 */
export function manifestPins(file: string, text: string, only: Only = () => true): Pin[] {
  const manifest = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
  const entries = ["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
    Object.entries(manifest[field] ?? {}),
  );
  return entries
    .filter(([name, version]) => only(name) && !version.startsWith("workspace:"))
    .map(([name, version]) => ({ file, fixable: false, name, version }));
}
