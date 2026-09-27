import { ArgsError, describeFlags, GLOBAL_FLAGS, isSet, parseArgs } from "./args.js";
import { connectorKindRows, renderConnectorKinds } from "./commands/connectors.js";
import { MOCK_PLAN_FLAGS, MOCK_PLAN_USAGE, mockPlan } from "./commands/mock-plan.js";
import { MOCK_SCHEMA_FLAGS, MOCK_SCHEMA_USAGE, mockSchema } from "./commands/mock-schema.js";
import { SETUP_APP_FLAGS, SETUP_APP_USAGE, setupApp } from "./commands/setup-app.js";
import { SETUP_CI_FLAGS, SETUP_CI_USAGE, setupCi } from "./commands/setup-ci.js";
import { SETUP_VERIFY_FLAGS, SETUP_VERIFY_USAGE, setupVerify } from "./commands/setup-verify.js";
import { HELP } from "./help.js";

import type { FlagSpec, ParsedArgs } from "./args.js";
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

/** One command: the flags it accepts beyond the global ones, and what it does. */
interface Command {
  readonly flags: FlagSpec;
  readonly run: (args: ParsedArgs, options: RunOptions) => Promise<RunResult> | RunResult;
}

/** Every command, by the words that name it. */
export const COMMANDS: Readonly<Record<string, Command>> = {
  connectors: {
    flags: {},
    run: ({ flags }) => {
      const rows = connectorKindRows();
      return present(isSet(flags, "json"), rows, renderConnectorKinds(rows));
    },
  },
  "mock schema": {
    flags: MOCK_SCHEMA_FLAGS,
    run: (args, options) => mockSchema(args, options.generate),
  },
  "mock plan": { flags: MOCK_PLAN_FLAGS, run: (args, options) => mockPlan(args, options.fetch) },
  "setup app": {
    flags: SETUP_APP_FLAGS,
    run: ({ flags }) => setupApp(flags, isSet(flags, "json")),
  },
  "setup verify": {
    flags: SETUP_VERIFY_FLAGS,
    run: ({ flags }, options) => setupVerify(flags, options.fetch),
  },
  "setup ci": { flags: SETUP_CI_FLAGS, run: ({ flags }, options) => setupCi(flags, pick(options)) },
};

/** What a command group prints when its subcommand is missing or unknown. */
const GROUP_USAGE: Readonly<Record<string, string>> = {
  mock: `${MOCK_SCHEMA_USAGE}\n\n${MOCK_PLAN_USAGE}`,
  setup: `${SETUP_APP_USAGE}\n\n${SETUP_VERIFY_USAGE}\n\n${SETUP_CI_USAGE}`,
};

/** Every flag any command declares, so the first pass finds positionals wherever flags sit. */
const ANY_FLAG: FlagSpec = Object.fromEntries(
  [GLOBAL_FLAGS, ...Object.values(COMMANDS).map((command) => command.flags)].flatMap((spec) =>
    Object.entries(spec),
  ),
);

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
  const { command, flags, positionals } = parseArgs(argv, ANY_FLAG, { strict: false });

  if (isSet(flags, "version")) return { output: options.version, exitCode: 0 };
  if (isSet(flags, "help") || command === undefined) return { output: HELP, exitCode: 0 };

  const group = GROUP_USAGE[command];
  const name = group === undefined ? command : `${command} ${positionals[0] ?? ""}`;
  const found = COMMANDS[name];
  if (found === undefined) {
    if (group !== undefined) return { output: group, exitCode: 1 };
    return { output: `Unknown command "${command}".\n\n${HELP}`, exitCode: 1 };
  }

  const spec = { ...found.flags, ...GLOBAL_FLAGS };
  let args: ParsedArgs;
  try {
    args = parseArgs(argv, spec);
  } catch (error) {
    if (!(error instanceof ArgsError)) throw error;
    return {
      output: `maple ${name}: ${error.message}\nIts flags: ${describeFlags(spec)}`,
      exitCode: 1,
    };
  }
  return found.run(args, options);
}

function pick({ cwd, fs }: RunOptions): { cwd?: string; fs?: WorkflowFs } {
  return { ...(cwd === undefined ? {} : { cwd }), ...(fs === undefined ? {} : { fs }) };
}
