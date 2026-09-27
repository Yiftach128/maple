/**
 * Rewrites every `<!-- generated:<name> -->` section from the code it
 * restates, then formats the file with prettier: `pnpm docs:generate`. With
 * `--check` it writes nothing and exits 1 naming each file that would change,
 * which is what CI runs. It imports the packages' TypeScript source directly
 * through the hooks below, so nothing has to be built first.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import * as prettier from "prettier";
import ts from "typescript";

import type { Sources } from "./sections.js";

const ROOT = new URL("../../", import.meta.url);

/** `@maple-kit/*` through tsconfig.base.json's paths, `./x.js` to `./x.ts`. */
function registerSourceHooks(): void {
  const config = JSON.parse(readFileSync(new URL("tsconfig.base.json", ROOT), "utf8")) as {
    compilerOptions: { paths: Record<string, string[]> };
  };
  const paths = new Map<string, string>();
  for (const [name, [target]] of Object.entries(config.compilerOptions.paths)) {
    if (target !== undefined) paths.set(name, new URL(target, ROOT).href);
  }
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !/\.tsx?$/.test(url) || url.includes("/node_modules/")) {
        return nextLoad(url, context);
      }
      return { format: "module", shortCircuit: true, source: transpile(fileURLToPath(url)) };
    },
    resolve(specifier, context, nextResolve) {
      const workspace = paths.get(specifier);
      if (workspace !== undefined) return { shortCircuit: true, url: workspace };
      const parent = context.parentURL;
      if (parent?.startsWith("file:") && specifier.startsWith(".") && specifier.endsWith(".js")) {
        const source = new URL(specifier.replace(/\.js$/, ".ts"), parent);
        if (existsSync(fileURLToPath(source))) return { shortCircuit: true, url: source.href };
      }
      return nextResolve(specifier, context);
    },
  });
}

/** Node's own type stripping rejects parameter properties, which core uses. */
function transpile(path: string): string {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
      verbatimModuleSyntax: true,
    },
    fileName: path,
  }).outputText;
}

async function loadSources(): Promise<Sources> {
  const [tools, schemas, environment, help, mock, connectors] = await Promise.all([
    import("../../packages/mcp/src/tools.js"),
    import("../../packages/mcp/src/schemas.js"),
    import("../../packages/mcp/src/environment.js"),
    import("../../packages/cli/src/help.js"),
    import("../../packages/core/src/mock/recipe.js"),
    import("../../packages/cli/src/commands/connectors.js"),
  ]);
  return {
    connectorKinds: connectors.renderConnectorKinds(connectors.connectorKindRows()),
    environment: environment.ENVIRONMENT,
    help: help.HELP,
    mockStates: mock.MOCK_STATES,
    shapes: schemas.SHAPES,
    tools: tools.TOOLS,
  };
}

/** Every tracked Markdown file, so a marker with no generator is found too. */
function markdownFiles(): string[] {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is whichever one the hook or CI runs.
  const out = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter((file) => file !== "");
}

type Sections = typeof import("./sections.js");

/** Renders every section of `file` and formats it, collecting what failed. */
async function regenerate(
  file: string,
  text: string,
  { replaceSection, SECTIONS }: Sections,
  sources: Sources,
): Promise<{ problems: string[]; text: string }> {
  const problems: string[] = [];
  let next = text;
  for (const section of SECTIONS.filter((candidate) => candidate.files.includes(file))) {
    try {
      next = replaceSection(next, section.name, section.render(sources), section.inline);
    } catch (error) {
      problems.push(`${file}: ${(error as Error).message}.`);
    }
  }
  const options = await prettier.resolveConfig(fileURLToPath(new URL(file, ROOT)));
  return { problems, text: await prettier.format(next, { ...options, filepath: file }) };
}

async function main(): Promise<void> {
  registerSourceHooks();
  const sections = await import("./sections.js");
  const sources = await loadSources();
  const check = process.argv.includes("--check");
  const known = new Set(sections.SECTIONS.map((section) => section.name));
  const targets = new Set(sections.SECTIONS.flatMap((section) => section.files));
  const problems: string[] = [];
  for (const file of new Set([...targets, ...markdownFiles()])) {
    const path = fileURLToPath(new URL(file, ROOT));
    const text = readFileSync(path, "utf8");
    for (const name of sections.markerNames(text).filter((found) => !known.has(found))) {
      problems.push(`${file}: no generator is named ${name}.`);
    }
    if (!targets.has(file)) continue;
    const result = await regenerate(file, text, sections, sources);
    problems.push(...result.problems);
    if (result.text === text) continue;
    if (check) problems.push(`${file} is out of date. Run pnpm docs:generate and commit it.`);
    else writeFileSync(path, result.text);
  }
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
