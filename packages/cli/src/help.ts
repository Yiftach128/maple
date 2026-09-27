/** The text `maple --help` prints. */
export const HELP = `maple — visual review comments on deployed previews

Usage
  maple <command> [options]

Commands
  connectors        Show the connector kinds and the methods each one may implement
  mock schema       Write an OpenAPI document of a tRPC router's response types
  mock plan         Print the recipe a preview's route plans for a sentence
  setup app         Print the prefilled GitHub App registration URL and the steps after it
  setup verify      Check that a comment App's Device Flow is on
  setup ci          Print or write the gate workflow, and the ruleset that requires it

Options
  --json            Print machine-readable output where a command supports it
  --help            Show this help
  --version         Show the version

Every command that prints a table also supports --json, so the CLI can be driven
by an agent as easily as by a person.`;
