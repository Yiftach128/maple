import { CONNECTOR_METHODS } from "@maple-kit/core";
import { describe, expect, it } from "vitest";

import { describeFlags, GLOBAL_FLAGS } from "../src/args.js";
import { HELP } from "../src/help.js";
import { COMMANDS, run } from "../src/run.js";

const OPTIONS = { version: "1.2.3" };

describe("run", () => {
  it("prints help when given nothing", async () => {
    expect(await run([], OPTIONS)).toEqual({ output: HELP, exitCode: 0 });
  });

  it("prints help for --help", async () => {
    expect((await run(["--help"], OPTIONS)).output).toBe(HELP);
  });

  it("prints the version for --version", async () => {
    expect(await run(["--version"], OPTIONS)).toEqual({ output: "1.2.3", exitCode: 0 });
  });

  it("answers --version even when a command is given", async () => {
    expect((await run(["connectors", "--version"], OPTIONS)).output).toBe("1.2.3");
  });

  it("exits non-zero on an unknown command and says so", async () => {
    const result = await run(["nope"], OPTIONS);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Unknown command "nope"');
  });

  it("lists every connector kind", async () => {
    const output = (await run(["connectors"], OPTIONS)).output;

    for (const kind of Object.keys(CONNECTOR_METHODS)) expect(output).toContain(kind);
  });

  it("says a kind requiring nothing requires none, rather than leaving a blank", async () => {
    const output = (await run(["connectors"], OPTIONS)).output;

    expect(output).toContain("classifier    required: none");
  });

  it("emits JSON for --json", async () => {
    const result = await run(["connectors", "--json"], OPTIONS);
    const parsed: unknown = JSON.parse(result.output);

    expect(parsed).toContainEqual({
      kind: "store",
      required: ["list", "append"],
      optional: ["appendMany", "setStatus", "head", "watch", "approvals", "approve", "unapprove"],
    });
  });

  it("derives the matrix from core rather than a copy", async () => {
    const parsed = JSON.parse((await run(["connectors", "--json"], OPTIONS)).output) as {
      kind: string;
      required: string[];
      optional: string[];
    }[];

    for (const row of parsed) {
      const methods = CONNECTOR_METHODS[row.kind as keyof typeof CONNECTOR_METHODS];
      expect(new Set([...row.required, ...row.optional])).toEqual(new Set(methods));
    }
  });
});

const NAMES = Object.keys(COMMANDS);

/** Every `[command, flag]` pair whose flag has `type`, the global ones included. */
function flagsOfType(type: string): (readonly [string, string])[] {
  return Object.entries(COMMANDS).flatMap(([name, { flags }]) =>
    Object.entries({ ...GLOBAL_FLAGS, ...flags })
      .filter(([, declared]) => declared === type)
      .map(([flag]) => [name, flag] as const),
  );
}

describe("every command's flags", () => {
  it.each(NAMES)("maple %s refuses an unknown flag and names the ones it takes", async (name) => {
    const result = await run([...name.split(" "), "--bogus"], OPTIONS);
    const spec = { ...COMMANDS[name]?.flags, ...GLOBAL_FLAGS };

    expect(result).toEqual({
      output: `maple ${name}: Unknown option '--bogus'.\nIts flags: ${describeFlags(spec)}`,
      exitCode: 1,
    });
  });

  it.each(flagsOfType("string"))("maple %s refuses --%s with no value", async (name, flag) => {
    const result = await run([...name.split(" "), `--${flag}`], OPTIONS);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`maple ${name}: Option '--${flag} <value>' argument missing.`);
  });

  it.each(flagsOfType("boolean"))("maple %s refuses a value for --%s", async (name, flag) => {
    const result = await run([...name.split(" "), `--${flag}=yes`], OPTIONS);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`Option '--${flag}' does not take an argument.`);
  });

  it("lists a command's own flags first, marking those that take a value", async () => {
    const { output } = await run(["setup", "app", "--ownr", "acme"], OPTIONS);

    expect(output).toContain(
      "Its flags: --owner <value>, --name <value>, --personal, --gate, --json, --help, --version",
    );
  });

  it("refuses a flag only another command takes", async () => {
    const result = await run(["setup", "ci", "--owner=acme"], OPTIONS);

    expect(result.output).toContain("maple setup ci: Unknown option '--owner'.");
  });

  it("gives a flag one type wherever two commands share its name", () => {
    const seen = new Map<string, string>(Object.entries(GLOBAL_FLAGS));
    for (const { flags } of Object.values(COMMANDS)) {
      for (const [flag, type] of Object.entries(flags)) {
        expect(seen.get(flag) ?? type).toBe(type);
        seen.set(flag, type);
      }
    }
  });

  it.each([
    [["setup", "app", "--gate", "--owner", "acme"]],
    [["--owner", "acme", "setup", "app", "--gate"]],
    [["setup", "--gate", "app", "--owner=acme"]],
  ])("finds the command wherever the flags sit in %j", async (argv) => {
    const result = await run(argv, OPTIONS);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Register the gate App");
  });

  it("answers --help before checking flags", async () => {
    expect((await run(["setup", "app", "--bogus", "--help"], OPTIONS)).output).toBe(HELP);
  });
});
