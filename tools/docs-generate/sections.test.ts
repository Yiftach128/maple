import { describe, expect, it } from "vitest";

import {
  markerNames,
  renderCommands,
  renderConnectorKinds,
  renderEnvironment,
  renderMockStates,
  renderTools,
  replaceSection,
  SECTIONS,
  signature,
  table,
} from "./sections.js";

const arg = (optional: boolean) => ({ isOptional: () => optional });

describe("table", () => {
  it.each<[string, string[], string[][], string]>([
    ["a header and no rows", ["A", "B"], [], "| A | B |\n| --- | --- |"],
    ["one row", ["A"], [["x"]], "| A |\n| --- |\n| x |"],
    [
      "a pipe in a cell is escaped",
      ["A"],
      [["a | b"]],
      String.raw`| A |` + "\n| --- |\n" + String.raw`| a \| b |`,
    ],
    ["a newline in a cell is a space", ["A"], [["a\nb"]], "| A |\n| --- |\n| a b |"],
  ])("%s", (_case, header, rows, expected) => {
    expect(table(header, rows)).toBe(expected);
  });
});

describe("signature", () => {
  it.each<[string, Record<string, ReturnType<typeof arg>>, string]>([
    ["no arguments", {}, "t()"],
    ["required only", { a: arg(false), b: arg(false) }, "t(a, b)"],
    ["an optional one", { a: arg(false), b: arg(true) }, "t(a, b?)"],
  ])("%s", (_case, shape, expected) => {
    expect(signature("t", shape)).toBe(expected);
  });
});

describe("renderTools", () => {
  it("lists each tool with its signature, whether it reads, and its description", () => {
    const rendered = renderTools({
      shapes: { read: { id: arg(false) }, write: { id: arg(false), note: arg(true) } },
      tools: [
        { description: "Reads one.", name: "read", readOnly: true },
        { description: "Writes one.", name: "write", readOnly: false },
      ],
    });
    expect(rendered.split("\n").slice(2)).toEqual([
      "| `read(id)` | ✓ | Reads one. |",
      "| `write(id, note?)` |  | Writes one. |",
    ]);
  });
});

describe("renderEnvironment", () => {
  it.each<[boolean, string]>([
    [true, "| `X_TOKEN` | Yes | A token. |"],
    [false, "| `X_TOKEN` | No | A token. |"],
  ])("secret: %s", (secret, row) => {
    const rendered = renderEnvironment({
      environment: [{ description: "A token.", name: "X_TOKEN", secret }],
    });
    expect(rendered.split("\n")[2]).toBe(row);
  });
});

describe("renderCommands", () => {
  const help = (commands: string) =>
    `tool\n\nUsage\n  x\n\nCommands\n${commands}\n\nOptions\n  --help  Help`;
  it.each<[string, string, string[]]>([
    [
      "one-word commands",
      "  a       Does a\n  b       Does b",
      ["| `maple a` | Does a |", "| `maple b` | Does b |"],
    ],
    ["a two-word command", "  mock plan   Plans a mock", ["| `maple mock plan` | Plans a mock |"]],
  ])("%s", (_case, commands, rows) => {
    expect(
      renderCommands({ help: help(commands) })
        .split("\n")
        .slice(2),
    ).toEqual(rows);
  });

  it("throws when there is no Commands block", () => {
    expect(() => renderCommands({ help: "Usage\n  x\n" })).toThrow(/no Commands block/);
  });
});

describe("renderConnectorKinds", () => {
  it("fences the CLI's own output", () => {
    expect(renderConnectorKinds({ connectorKinds: "Connector kinds\n  a" })).toBe(
      "```\nConnector kinds\n  a\n```",
    );
  });
});

describe("renderMockStates", () => {
  it.each<[string[], string]>([
    [[], ""],
    [["one"], "`one`"],
    [["a", "b"], "`a` or `b`"],
    [["a", "b", "c"], "`a`, `b` or `c`"],
  ])("%j → %s", (states, expected) => {
    expect(renderMockStates({ mockStates: states })).toBe(expected);
  });
});

describe("replaceSection", () => {
  const open = "<!-- generated:s -->";
  const close = "<!-- /generated:s -->";
  it.each<[string, string, boolean, string]>([
    [
      "a block",
      `a\n\n${open}\n\nold\n\n${close}\n\nb`,
      false,
      `a\n\n${open}\n\nnew\n\n${close}\n\nb`,
    ],
    ["an empty block", `${open}${close}`, false, `${open}\n\nnew\n\n${close}`],
    ["inline", `in ${open}old${close}.`, true, `in ${open}new${close}.`],
  ])("%s", (_case, text, inline, expected) => {
    expect(replaceSection(text, "s", "new", inline)).toBe(expected);
  });

  it.each<[string, string, RegExp]>([
    ["no markers", "prose", /no <!-- generated:s --> … <!-- \/generated:s --> pair/],
    ["no close", `${open} old`, /pair/],
    ["close before open", `${close} ${open}`, /pair/],
    ["two opens", `${open}${close}${open}${close}`, /appears twice/],
  ])("throws on %s", (_case, text, message) => {
    expect(() => replaceSection(text, "s", "new", false)).toThrow(message);
  });
});

describe("markerNames", () => {
  it("finds each name once, open or close", () => {
    const text = "<!-- generated:a -->x<!-- /generated:a --> <!-- generated:b-2 -->";
    expect(markerNames(text)).toEqual(["a", "b-2"]);
  });
});

describe("SECTIONS", () => {
  it("names each section once", () => {
    const names = SECTIONS.map((section) => section.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
