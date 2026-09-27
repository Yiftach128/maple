import { isSet, parseArgs } from "./args.js";
import { connectorKindRows, renderConnectorKinds } from "./commands/connectors.js";
import { MOCK_PLAN_USAGE, mockPlan } from "./commands/mock-plan.js";
import { MOCK_SCHEMA_USAGE, mockSchema } from "./commands/mock-schema.js";
import { SETUP_APP_USAGE, setupApp } from "./commands/setup-app.js";
import { SETUP_CI_USAGE, setupCi } from "./commands/setup-ci.js";
import { SETUP_VERIFY_USAGE, setupVerify } from "./commands/setup-verify.js";
import { HELP } from "./help.js";

import type { Generate } from "./commands/mock-schema.js";
import type { WorkflowFs } from "./commands/setup-ci.js";

/** What the CLI needs from its environment, so tests can supply their own. */
export interface RunOptions {
  /** Reported by `--version`. */
  readonly version: string;
  /** `maple mock schema`'s generator, in place of the optional peer. */
  readonly generate?: Generate;
  /** How `maple mock plan` and `maple setup verify` reach the network. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Where `maple setup ci --write` writes. Defaults to the process's own. */
  readonly cwd?: string;
  /** The filesystem `maple setup ci --write` writes through. */
  readonly fs?: WorkflowFs;
}

/** What a command produced: text to print and the exit code to use. */
export interface RunResult {
  readonly output: string;
  readonly exitCode: number;
}

/** Serialises `value` for `--json`, or renders it for a terminal. */
function present(json: boolean, value: unknown, text: string): RunResult {
  return { output: json ? JSON.stringify(value, null, 2) : text, exitCode: 0 };
}

/**
 * Runs one command and returns what to print.
 *
 * Nothing here writes to stdout or exits the process; that is the binary's job,
 * which is what makes every command testable as a plain function.
 */
export async function run(argv: readonly string[], options: RunOptions): Promise<RunResult> {
  const { command, flags, positionals } = parseArgs(argv);
  const json = isSet(flags, "json");

  if (isSet(flags, "version")) return { output: options.version, exitCode: 0 };
  if (isSet(flags, "help") || command === undefined) return { output: HELP, exitCode: 0 };

  if (command === "mock") return mock({ flags, positionals }, options);
  if (command === "setup") return setup({ flags, positionals }, options);

  if (command === "connectors") {
    const rows = connectorKindRows();
    return present(json, rows, renderConnectorKinds(rows));
  }

  return {
    output: `Unknown command "${command}".\n\n${HELP}`,
    exitCode: 1,
  };
}

/** `maple mock schema` and `maple mock plan`, by their first positional. */
function mock(
  args: { flags: RunResultFlags; positionals: readonly string[] },
  options: RunOptions,
): Promise<RunResult> {
  const [subcommand] = args.positionals;
  if (subcommand === "schema") return mockSchema(args, options.generate);
  if (subcommand === "plan") return mockPlan(args, options.fetch);
  return Promise.resolve({ output: `${MOCK_SCHEMA_USAGE}\n\n${MOCK_PLAN_USAGE}`, exitCode: 1 });
}

const SETUP_USAGE = `${SETUP_APP_USAGE}\n\n${SETUP_VERIFY_USAGE}\n\n${SETUP_CI_USAGE}`;

/** `maple setup app`, `verify` and `ci`, by their first positional. */
async function setup(
  args: { flags: RunResultFlags; positionals: readonly string[] },
  options: RunOptions,
): Promise<RunResult> {
  const [subcommand] = args.positionals;
  const json = isSet(args.flags, "json");
  if (subcommand === "app") return setupApp(args.flags, json);
  if (subcommand === "verify") return setupVerify(args.flags, options.fetch);
  if (subcommand === "ci") return setupCi(args.flags, pick(options));
  return { output: SETUP_USAGE, exitCode: 1 };
}

function pick({ cwd, fs }: RunOptions): { cwd?: string; fs?: WorkflowFs } {
  return { ...(cwd === undefined ? {} : { cwd }), ...(fs === undefined ? {} : { fs }) };
}

type RunResultFlags = ReturnType<typeof parseArgs>["flags"];
