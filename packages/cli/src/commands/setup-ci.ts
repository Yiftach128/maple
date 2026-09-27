/**
 * `maple setup ci`: the gate workflow on `maple-kit/maple-action`, and the
 * ruleset command that makes its check required. The workflow publishes on its
 * own GITHUB_TOKEN, so a merge is gated before any gate App is registered.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isSet } from "../args.js";

import type { ParsedArgs } from "../args.js";

/** What the command prints, and its exit code. */
export interface SetupCiResult {
  readonly output: string;
  readonly exitCode: number;
}

/** The two filesystem calls `--write` makes, so a test can supply its own. */
export interface WorkflowFs {
  readonly exists: (path: string) => boolean;
  readonly write: (path: string, content: string) => void;
}

/** Where `--write` puts the workflow, relative to the working directory. */
export const WORKFLOW_PATH = ".github/workflows/maple.yml";

/** The check the gate publishes, and the App `github.token` acts as. */
export const CHECK_NAME = "maple/visual-review";
export const GITHUB_ACTIONS_APP_ID = 15368;

export const SETUP_CI_USAGE = `Usage
  maple setup ci [--require-approval] [--write]

  --require-approval  Hold a quiet pull request until somebody approves it in the
                      overlay. Must match RouteOptions.requireApproval.
  --write             Write ${WORKFLOW_PATH} instead of printing it. Never overwrites.`;

const nodeFs: WorkflowFs = {
  exists: existsSync,
  write(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { flag: "wx" });
  },
};

/** The workflow, with `require-approval` on the gate step when asked for. */
export function gateWorkflow(requireApproval: boolean): string {
  const approval = requireApproval ? `\n          require-approval: "true"` : "";
  return `name: Maple

on:
  pull_request:
  merge_group:

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write
      pull-requests: write
    steps:
      - uses: maple-kit/maple-action@v0
        with:
          mode: sync
      - uses: maple-kit/maple-action@v0
        with:
          mode: gate${approval}
`;
}

/** A `gh api` call adding a ruleset that requires the check on the default branch. */
export function rulesetCommand(integrationId: number = GITHUB_ACTIONS_APP_ID): string {
  const ruleset = {
    name: "Maple visual review",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: CHECK_NAME, integration_id: integrationId }],
        },
      },
    ],
  };
  return `gh api --method POST 'repos/{owner}/{repo}/rulesets' --input - <<'JSON'
${JSON.stringify(ruleset, null, 2)}
JSON`;
}

const RULESET_NOTE = `Make ${CHECK_NAME} required, from inside the repository (gh fills in {owner}/{repo}):

${rulesetCommand()}

integration_id ${String(GITHUB_ACTIONS_APP_ID)} is GitHub Actions, the App the workflow's token acts as;
pinning it stops anyone with push access forging a green status under the same name.
A check published from the SDK route by a gate App comes from that App instead,
so pin the gate App's own App ID there.`;

/** Runs the command. Nothing here exits the process. */
export function setupCi(
  flags: ParsedArgs["flags"],
  options: { readonly cwd?: string; readonly fs?: WorkflowFs } = {},
): SetupCiResult {
  const workflow = gateWorkflow(isSet(flags, "require-approval"));
  if (!isSet(flags, "write")) {
    return { output: `# ${WORKFLOW_PATH}\n${workflow}\n${RULESET_NOTE}`, exitCode: 0 };
  }

  const fs = options.fs ?? nodeFs;
  const path = join(options.cwd ?? process.cwd(), WORKFLOW_PATH);
  if (fs.exists(path)) {
    return { output: `${path} already exists; not overwriting it.`, exitCode: 1 };
  }
  try {
    fs.write(path, workflow);
  } catch (error) {
    return { output: `Could not write ${path}: ${String(error)}`, exitCode: 1 };
  }
  return { output: `Wrote ${path}.\n\n${RULESET_NOTE}`, exitCode: 0 };
}
