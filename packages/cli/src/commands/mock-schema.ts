/**
 * `maple mock schema <router.ts>`: an OpenAPI document of a tRPC router's
 * response types, for Maple's route to serve as each call's shape.
 *
 * It wraps `@trpc/openapi`, which reads the router's TypeScript types
 * statically and runs none of its code. That package is an alpha and an
 * optional peer, so it is loaded only here; see `docs/mock.md`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { MOCK_EXTENSION } from "@maple-kit/core/mock";

import type { FlagSpec, ParsedArgs } from "../args.js";

/** What the command prints, and its exit code. */
export interface MockSchemaResult {
  readonly output: string;
  readonly exitCode: number;
}

/** The generator's one call this needs, injectable so a test need not type-check a router. */
export type Generate = (
  entry: string,
  options: { exportName: string; title: string; version: string },
) => Promise<unknown>;

/** The peer this command needs, named so its absence can be said plainly. */
export const GENERATOR = "@trpc/openapi";
const GENERATOR_VERSION = "11.19.0-alpha";

export const MOCK_SCHEMA_FLAGS = {
  export: "string",
  out: "string",
  superjson: "boolean",
} as const satisfies FlagSpec;

export const MOCK_SCHEMA_USAGE = `Usage
  maple mock schema <router.ts> [--export=AppRouter] [--out=file.json] [--superjson]

  --export      The router type's exported name. Defaults to AppRouter.
  --out         Where to write the document. Printed when absent.
  --superjson   The router's transformer is superjson, so a sampled date is a Date.`;

/** Runs the command. Nothing here exits the process. */
export async function mockSchema(
  args: Pick<ParsedArgs, "flags" | "positionals">,
  generate?: Generate,
): Promise<MockSchemaResult> {
  const [subcommand, entry] = args.positionals;
  if (subcommand !== "schema" || entry === undefined) {
    return { output: MOCK_SCHEMA_USAGE, exitCode: 1 };
  }
  const run = generate ?? (await loadGenerator());
  if (run === undefined) {
    return {
      output: `maple mock schema needs ${GENERATOR}, an optional peer:\n  pnpm add -D ${GENERATOR}@${GENERATOR_VERSION}`,
      exitCode: 1,
    };
  }

  const exportName = flag(args.flags, "export") ?? "AppRouter";
  let document: unknown;
  try {
    document = await run(resolve(entry), { exportName, title: exportName, version: "0" });
  } catch (error) {
    return { output: `Could not read ${exportName} from ${entry}: ${String(error)}`, exitCode: 1 };
  }

  const stamped = stamp(document, args.flags["superjson"] === true);
  const text = `${JSON.stringify(stamped, null, 2)}\n`;
  const out = flag(args.flags, "out");
  if (out === undefined) return { output: text.trimEnd(), exitCode: 0 };
  try {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, text);
  } catch (error) {
    return { output: `Could not write ${out}: ${String(error)}`, exitCode: 1 };
  }
  return { output: `Wrote ${String(procedures(stamped))} procedures to ${out}`, exitCode: 0 };
}

/** The document, marked as a tRPC router's, so the route reads it without being told. */
function stamp(document: unknown, superjson: boolean): Record<string, unknown> {
  const base = typeof document === "object" && document !== null ? document : {};
  const mark = { codec: "trpc", source: "router", ...(superjson ? { superjson: true } : {}) };
  return { ...base, [MOCK_EXTENSION]: mark };
}

function procedures(document: Record<string, unknown>): number {
  const paths = document["paths"];
  return typeof paths === "object" && paths !== null ? Object.keys(paths).length : 0;
}

function flag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function loadGenerator(): Promise<Generate | undefined> {
  try {
    const loaded = (await import(GENERATOR)) as { generateOpenAPIDocument?: Generate };
    return loaded.generateOpenAPIDocument;
  } catch {
    return undefined;
  }
}
