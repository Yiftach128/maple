/**
 * The parts of the docs that restate code, and how each is rendered from it.
 * A section sits between `<!-- generated:<name> -->` and
 * `<!-- /generated:<name> -->`; everything outside the markers is prose and
 * left alone. Every renderer here is pure: generate.ts loads the code.
 */

/** What the renderers read, loaded from the packages' own source. */
export interface Sources {
  connectorKinds: string;
  environment: readonly { description: string; name: string; secret: boolean }[];
  help: string;
  mockStates: readonly string[];
  shapes: Readonly<Record<string, Readonly<Record<string, ArgumentSchema>>>>;
  tools: readonly { description: string; name: string; readOnly: boolean }[];
}

/** The one thing a tool argument's zod schema is asked. */
export interface ArgumentSchema {
  isOptional(): boolean;
}

/** One generated section: where it goes and what fills it. */
export interface Section {
  files: readonly string[];
  /** Inline sections sit inside a sentence; block ones get blank lines. */
  inline: boolean;
  name: string;
  render(sources: Sources): string;
}

/** A Markdown table from a header row and body rows, left to prettier to pad. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function escapeCell(cell: string): string {
  return cell.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}

/** `tool(a, b?)`, from the argument shape. */
export function signature(name: string, shape: Readonly<Record<string, ArgumentSchema>>): string {
  const args = Object.entries(shape).map(([arg, schema]) =>
    schema.isOptional() ? `${arg}?` : arg,
  );
  return `${name}(${args.join(", ")})`;
}

/** The MCP tool table: signature, whether it only reads, and what it does. */
export function renderTools(sources: Pick<Sources, "shapes" | "tools">): string {
  const rows = sources.tools.map((tool) => [
    `\`${signature(tool.name, sources.shapes[tool.name] ?? {})}\``,
    tool.readOnly ? "✓" : "",
    tool.description,
  ]);
  return table(["Tool", "Reads", "What it does"], rows);
}

/** The environment table: name, whether it is a secret, and what it is. */
export function renderEnvironment(sources: Pick<Sources, "environment">): string {
  return table(
    ["Name", "Secret", "What it is"],
    sources.environment.map((variable) => [
      `\`${variable.name}\``,
      variable.secret ? "Yes" : "No",
      variable.description,
    ]),
  );
}

/** The command table, from the Commands block of `maple --help`. */
export function renderCommands(sources: Pick<Sources, "help">): string {
  const block = /\nCommands\n([\s\S]*?)\n\n/.exec(sources.help)?.[1];
  if (block === undefined) throw new Error("maple --help has no Commands block.");
  const rows = block.split("\n").map((line) => {
    const [command = "", description = ""] = line.trim().split(/\s{2,}/);
    return [`\`maple ${command}\``, description];
  });
  return table(["Command", "What it does"], rows);
}

/** The connector matrix exactly as `maple connectors` prints it. */
export function renderConnectorKinds(sources: Pick<Sources, "connectorKinds">): string {
  return ["```", sources.connectorKinds, "```"].join("\n");
}

/** The mock states as a sentence's list: `a`, `b` or `c`. */
export function renderMockStates(sources: Pick<Sources, "mockStates">): string {
  const quoted = sources.mockStates.map((state) => `\`${state}\``);
  const last = quoted.pop();
  if (last === undefined) return "";
  return quoted.length === 0 ? last : `${quoted.join(", ")} or ${last}`;
}

/** Every generated section in the repository. */
export const SECTIONS: readonly Section[] = [
  {
    files: ["packages/mcp/README.md", "docs/agent-loop.md"],
    inline: false,
    name: "mcp-tools",
    render: renderTools,
  },
  {
    files: ["packages/mcp/README.md", "docs/configuration.md"],
    inline: false,
    name: "mcp-environment",
    render: renderEnvironment,
  },
  {
    files: ["packages/cli/README.md"],
    inline: false,
    name: "cli-commands",
    render: renderCommands,
  },
  {
    files: ["packages/cli/README.md"],
    inline: false,
    name: "connector-kinds",
    render: renderConnectorKinds,
  },
  {
    files: ["plugins/maple/skills/maple-review/SKILL.md", "docs/mock.md"],
    inline: true,
    name: "mock-states",
    render: renderMockStates,
  },
];

/** `text` with section `name`'s body replaced; throws when a marker is missing. */
export function replaceSection(text: string, name: string, body: string, inline: boolean): string {
  const open = `<!-- generated:${name} -->`;
  const close = `<!-- /generated:${name} -->`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`no ${open} … ${close} pair`);
  }
  if (text.indexOf(open, start + 1) !== -1) throw new Error(`${open} appears twice`);
  const inner = inline ? body : `\n\n${body}\n\n`;
  return text.slice(0, start + open.length) + inner + text.slice(end);
}

/** Names of every generated marker in `text`, open or close, deduplicated. */
export function markerNames(text: string): string[] {
  const names = [...text.matchAll(/<!-- \/?generated:([a-z0-9-]+) -->/g)].map((m) => m[1] ?? "");
  return [...new Set(names)];
}
