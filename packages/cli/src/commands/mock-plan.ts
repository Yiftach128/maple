/**
 * `maple mock plan "<sentence>"`: a sentence planned by a deployed Maple
 * route, printed as the recipe the box would apply. It asks the route rather
 * than a model, so CI holds no key and gets the box's own plan.
 */

import { parseRecipe, readPlan, RECIPE_VERSION } from "@maple-kit/core/mock";

import type { FlagSpec, ParsedArgs } from "../args.js";
import type { MockPlan } from "@maple-kit/core/connectors";
import type { Recipe } from "@maple-kit/core/mock";

/** What the command prints, and its exit code. */
export interface MockPlanResult {
  readonly output: string;
  readonly exitCode: number;
}

export const MOCK_PLAN_FLAGS = {
  url: "string",
  route: "string",
  calls: "string",
} as const satisfies FlagSpec;

export const MOCK_PLAN_USAGE = `Usage
  maple mock plan "<sentence>" --url=<route> --route=<pattern> --calls=<key>,<key>

  --url      Where Maple's route is mounted on a preview, such as
             https://preview.example.com/api/maple.
  --route    The page's route pattern the recipe applies on, such as /projects/:id.
  --calls    The calls the page makes, comma-separated, as the box names them:
             "trpc:project.list,rest:GET /api/session".`;

interface Asked {
  readonly sentence: string;
  readonly url: URL;
  readonly route: string;
  readonly calls: readonly string[];
}

/** Runs the command. Nothing here exits the process. */
export async function mockPlan(
  args: Pick<ParsedArgs, "flags" | "positionals">,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<MockPlanResult> {
  const asked = read(args);
  if (asked === undefined) return failed(MOCK_PLAN_USAGE);

  let response: Response;
  try {
    response = await fetcher(new URL("mock/plan", `${asked.url.href.replace(/\/?$/, "/")}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: asked.sentence,
        route: asked.route,
        calls: asked.calls.map((key) => ({ key, summary: "" })),
      }),
    });
  } catch (error) {
    return failed(`Could not reach ${asked.url.href}: ${String(error)}`);
  }
  if (!response.ok) return failed(refusal(response.status, asked.url));

  const { plan } = (await response.json()) as { plan: MockPlan | null };
  return recipeFrom(plan, asked);
}

/** The plan through the box's own gate, so the two never disagree. */
function recipeFrom(plan: MockPlan | null, asked: Asked): MockPlanResult {
  const reading = readPlan(plan);
  if (reading.unnamed) {
    return failed(`"${asked.sentence}" doesn't name a state this page's data can be in.`);
  }
  const [chosen] = reading.suggestions;
  if (chosen === undefined) {
    const best = plan === null ? "nothing" : `${plan.state} at ${plan.confidence.toFixed(2)}`;
    return failed(`Not sure enough to mock anything; the best reading was ${best}.`);
  }

  const { as, flags, state } = chosen;
  const recipe: Recipe = parseRecipe({
    version: RECIPE_VERSION,
    calls: state === undefined ? [] : chosen.calls.map((key) => ({ key, state })),
    ...(flags === undefined ? {} : { flags }),
    ...(as === undefined ? {} : { as }),
    route: asked.route,
    request: asked.sentence,
  });
  return { output: JSON.stringify(recipe, null, 2), exitCode: 0 };
}

function read(args: Pick<ParsedArgs, "flags" | "positionals">): Asked | undefined {
  const [, sentence] = args.positionals;
  const url = parsed(flag(args.flags, "url"));
  const route = flag(args.flags, "route");
  const calls = (flag(args.flags, "calls") ?? "").split(",").map((key) => key.trim());
  const named = calls.filter((key) => key !== "");
  if (sentence === undefined || sentence.trim() === "" || url === undefined) return undefined;
  if (route === undefined || !route.startsWith("/") || named.length === 0) return undefined;
  return { sentence: sentence.trim(), url, route, calls: named };
}

/** What each refusal means, in the words a CI log needs. */
function refusal(status: number, url: URL): string {
  if (status === 404) {
    return `${url.href} plans nothing: /mock/plan answers only on a preview whose classifier plans.`;
  }
  if (status === 401) return `${url.href} plans only for a signed-in reviewer.`;
  return `${url.href} could not plan: ${String(status)}.`;
}

function failed(output: string): MockPlanResult {
  return { output, exitCode: 1 };
}

function parsed(value: string | undefined): URL | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function flag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}
