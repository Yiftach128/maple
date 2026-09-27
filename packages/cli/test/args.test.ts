import { describe, expect, it } from "vitest";

import { ArgsError, describeFlags, isSet, parseArgs } from "../src/args.js";

import type { FlagSpec, ParsedArgs } from "../src/args.js";

const SPEC = { branch: "string", filter: "string", json: "boolean" } as const satisfies FlagSpec;

describe("parseArgs", () => {
  it.each<[string, string[], ParsedArgs]>([
    ["nothing", [], { positionals: [], flags: {} }],
    ["a command", ["connectors"], { command: "connectors", positionals: [], flags: {} }],
    [
      "later positionals, in order",
      ["list", "main", "c_1"],
      { command: "list", positionals: ["main", "c_1"], flags: {} },
    ],
    ["a boolean flag", ["--json"], { positionals: [], flags: { json: true } }],
    ["--flag=value", ["--branch=feature/x"], { positionals: [], flags: { branch: "feature/x" } }],
    [
      "--flag value",
      ["--branch", "feature/x"],
      { positionals: [], flags: { branch: "feature/x" } },
    ],
    [
      "a value before a positional",
      ["list", "--branch", "a", "b"],
      { command: "list", positionals: ["b"], flags: { branch: "a" } },
    ],
    [
      "equals signs inside a value",
      ["--filter=a=b"],
      { positionals: [], flags: { filter: "a=b" } },
    ],
    ["an empty value", ["--branch="], { positionals: [], flags: { branch: "" } }],
    [
      "a dash-led value after equals",
      ["--branch=-x"],
      { positionals: [], flags: { branch: "-x" } },
    ],
    [
      "the later of two values",
      ["--branch=a", "--branch", "b"],
      { positionals: [], flags: { branch: "b" } },
    ],
    ["a lone dash as a positional", ["-"], { command: "-", positionals: [], flags: {} }],
    [
      "anything after -- as a positional",
      ["x", "--", "--json"],
      { command: "x", positionals: ["--json"], flags: {} },
    ],
  ])("reads %s", (_, argv, expected) => {
    expect(parseArgs(argv, SPEC)).toEqual(expected);
  });

  it.each<[string, string[], string]>([
    ["an unknown flag", ["--brnch=a"], "Unknown option '--brnch'."],
    ["an unknown short flag", ["-j"], "Unknown option '-j'."],
    [
      "a string flag at the end with no value",
      ["--branch"],
      "Option '--branch <value>' argument missing.",
    ],
    [
      "a string flag followed by another flag",
      ["--branch", "--json"],
      "Option '--branch' argument is ambiguous.",
    ],
    [
      "a value given to a boolean flag",
      ["--json=false"],
      "Option '--json' does not take an argument.",
    ],
  ])("refuses %s", (_, argv, message) => {
    expect(() => parseArgs(argv, SPEC)).toThrow(new ArgsError(message));
  });

  it("reads an undeclared flag as boolean, and throws nothing, when not strict", () => {
    expect(parseArgs(["--nope", "x", "--branch", "a"], SPEC, { strict: false })).toEqual({
      command: "x",
      positionals: [],
      flags: { nope: true, branch: "a" },
    });
  });
});

describe("describeFlags", () => {
  it("marks the flags that take a value", () => {
    expect(describeFlags(SPEC)).toBe("--branch <value>, --filter <value>, --json");
  });
});

describe("isSet", () => {
  it.each<[ParsedArgs["flags"], boolean]>([
    [{ json: true }, true],
    [{}, false],
    [{ json: "yes" }, false],
  ])("reads %j as %s", (flags, expected) => {
    expect(isSet(flags, "json")).toBe(expected);
  });
});
