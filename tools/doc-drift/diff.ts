/**
 * Reads a unified diff, as `git diff` prints it, into one record per hunk.
 * Only what a judgement needs is kept: the file, the hunk's header, and its
 * lines with their `+`, `-` or space prefix intact.
 */

/** One hunk of one file. */
export interface Hunk {
  /** Lines the hunk adds, without the `+`. */
  readonly added: readonly string[];
  /** The path after the change, or before it for a deletion. */
  readonly file: string;
  /** The `@@ … @@` line. */
  readonly header: string;
  /** Every line of the hunk, prefix intact. */
  readonly lines: readonly string[];
  /** Lines the hunk removes, without the `-`. */
  readonly removed: readonly string[];
}

/** Every hunk in `text`. A binary or mode-only change has none. */
export function parseDiff(text: string): Hunk[] {
  const hunks: Hunk[] = [];
  let before = "";
  let file = "";
  let current: { header: string; lines: string[] } | undefined;
  const flush = () => {
    if (current !== undefined) hunks.push(hunkOf(file, current.header, current.lines));
    current = undefined;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      before = "";
      file = "";
    } else if (current === undefined && line.startsWith("--- ")) {
      before = pathOf(line.slice(4));
    } else if (current === undefined && line.startsWith("+++ ")) {
      file = pathOf(line.slice(4)) || before;
    } else if (line.startsWith("@@")) {
      flush();
      current = { header: line, lines: [] };
    } else if (current !== undefined && /^[ +-]/.test(line)) {
      current.lines.push(line);
    }
  }
  flush();
  return hunks;
}

function hunkOf(file: string, header: string, lines: readonly string[]): Hunk {
  const body = (prefix: string) =>
    lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(1));
  return { added: body("+"), file, header, lines, removed: body("-") };
}

/** `a/x` or `b/x` as `x`; `/dev/null` as nothing. */
function pathOf(field: string): string {
  const path = field.split("\t")[0] ?? "";
  if (path === "/dev/null") return "";
  return path.replace(/^[ab]\//, "");
}

/** Whether a file's change is code a doc could describe, rather than prose or bookkeeping. */
export function isCode(file: string): boolean {
  if (file.endsWith(".md") || file === "pnpm-lock.yaml") return false;
  if (file.startsWith(".changeset/") || file.startsWith("evals/cases/")) return false;
  return !/(?:(?:^|\/)test\/)|(?:\.test\.tsx?$)/.test(file);
}
