/**
 * Argument parsing, over `node:util`'s `parseArgs`.
 *
 * Every command declares its flags and whether each takes a value, which is
 * what lets `--owner acme` and `--owner=acme` mean the same thing, and what
 * turns a mistyped flag into an error rather than something silently ignored.
 */

import { parseArgs as parseNodeArgs } from "node:util";

/** Whether a flag takes a value (`--owner acme`) or stands alone (`--gate`). */
export type FlagType = "boolean" | "string";

/** The flags one command accepts, by name without the leading dashes. */
export type FlagSpec = Readonly<Record<string, FlagType>>;

/** The flags every command accepts. */
export const GLOBAL_FLAGS = {
  json: "boolean",
  help: "boolean",
  version: "boolean",
} as const satisfies FlagSpec;

/** A parsed command line. */
export interface ParsedArgs {
  /** The subcommand, or undefined when none was given. */
  readonly command?: string;
  /** Positional arguments after the subcommand. */
  readonly positionals: readonly string[];
  /** Flags: `true` for a boolean one that was given, the value for a string one. */
  readonly flags: Readonly<Record<string, boolean | string>>;
}

/** A command line the flag spec does not allow, such as an unknown flag or a missing value. */
export class ArgsError extends Error {
  override readonly name = "ArgsError";
}

/**
 * Parses `argv` (without the node and script entries) against `spec`.
 *
 * Strict by default, throwing an {@link ArgsError} for a flag `spec` does not
 * declare, a string flag with no value, or a value given to a boolean flag.
 * With `strict: false` nothing throws, and an undeclared flag reads as boolean.
 */
export function parseArgs(
  argv: readonly string[],
  spec: FlagSpec,
  { strict = true }: { readonly strict?: boolean } = {},
): ParsedArgs {
  const options = Object.fromEntries(Object.entries(spec).map(([name, type]) => [name, { type }]));
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseNodeArgs({ args: [...argv], options, strict, allowPositionals: true });
  } catch (error) {
    throw new ArgsError(firstSentence(error));
  }

  const flags: Record<string, boolean | string> = {};
  for (const [name, value] of Object.entries(parsed.values)) {
    if (typeof value === "string" || typeof value === "boolean") flags[name] = value;
  }
  const [command, ...rest] = parsed.positionals;
  return { ...(command === undefined ? {} : { command }), positionals: rest, flags };
}

/** Node's own sentence naming the flag, without its advice on positionals. */
function firstSentence(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const [sentence = message] = message.split(/\.(?:\s|$)/);
  return `${sentence}.`;
}

/** The flags `spec` accepts, as a usage line: `--owner <value>, --gate`. */
export function describeFlags(spec: FlagSpec): string {
  return Object.entries(spec)
    .map(([name, type]) => (type === "string" ? `--${name} <value>` : `--${name}`))
    .join(", ");
}

/** True when the boolean flag `name` was given. */
export function isSet(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true;
}
