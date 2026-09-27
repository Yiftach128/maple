/**
 * Every variable the server and the Stop hook read, described once. The
 * configuration table in docs/configuration.md and this package's README is
 * rendered from this list by `pnpm docs:generate`, and a test holds it to the
 * names config.ts actually reads.
 */

/** One environment variable, as the docs describe it. */
export interface EnvironmentVariable {
  readonly name: string;
  /** Whether it belongs in a secret store rather than plain configuration. */
  readonly secret: boolean;
  readonly description: string;
}

/** The variables, in the order the docs list them. */
export const ENVIRONMENT: readonly EnvironmentVariable[] = [
  {
    name: "GITHUB_TOKEN",
    secret: true,
    description: "A token that can read and write pull-request comments. Required.",
  },
  { name: "MAPLE_GITHUB_OWNER", secret: false, description: "The repository's owner. Required." },
  { name: "MAPLE_GITHUB_REPO", secret: false, description: "The repository. Required." },
  { name: "MAPLE_GITHUB_API", secret: false, description: "The API root, for Enterprise Server." },
  {
    name: "MAPLE_STORE",
    secret: false,
    description: "`github`, the default and so far the only one.",
  },
  {
    name: "MAPLE_BRANCH",
    secret: false,
    description: "The branch under review. Required by the Stop hook; the server ignores it.",
  },
  {
    name: "MAPLE_GATE_TOKEN",
    secret: true,
    description: "The gate App's installation token. Absent, a resolve publishes no verdict.",
  },
  {
    name: "MAPLE_GATE_APP_ID",
    secret: false,
    description: "The gate App's id, so it updates its own check run rather than another's.",
  },
  {
    name: "MAPLE_REQUIRE_APPROVAL",
    secret: false,
    description: "`true` to hold the gate until somebody approves, matching the route and CI.",
  },
];

/** The description of `name`, or undefined for a variable not listed. */
export function describeVariable(name: string): string | undefined {
  return ENVIRONMENT.find((variable) => variable.name === name)?.description;
}
