import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { MOCK_PLAN_USAGE } from "../src/commands/mock-plan.js";
import { run } from "../src/run.js";
import { createRouteFake, planOf, ROUTE_URL } from "./msw/route.js";

const fake = createRouteFake();
beforeAll(() => fake.server.listen({ onUnhandledRequest: "error" }));
afterEach(() => fake.reset());
afterAll(() => fake.server.close());

const LIST = "trpc:roast.list";
const USER = "trpc:user.me";

function plan(sentence: string, ...flags: string[]) {
  return run(
    [
      "mock",
      "plan",
      sentence,
      `--url=${ROUTE_URL}`,
      "--route=/roasts",
      `--calls=${LIST}, ${USER}`,
      ...flags,
    ],
    { version: "0" },
  );
}

describe("maple mock plan", () => {
  it("prints the recipe the route plans, with the sentence in it", async () => {
    fake.answerNext(planOf({ empty: 0.8 }, [LIST]));
    const result = await plan("no roasts yet");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      version: 2,
      calls: [{ key: LIST, state: "empty" }],
      route: "/roasts",
      request: "no roasts yet",
    });
  });

  it("asks the route with the sentence, the route pattern and every call", async () => {
    fake.answerNext(planOf({ empty: 0.8 }, [LIST]));
    await plan("  no roasts yet ");

    expect(fake.asked).toEqual([
      {
        request: "no roasts yet",
        route: "/roasts",
        calls: [
          { key: LIST, summary: "" },
          { key: USER, summary: "" },
        ],
      },
    ]);
  });

  it("reads --flag value the same as --flag=value", async () => {
    fake.answerNext(planOf({ empty: 0.8 }, [LIST]));
    const argv = ["mock", "plan", "--url", ROUTE_URL, "no roasts yet", "--route", "/roasts"];
    const result = await run([...argv, "--calls", LIST, "--json"], { version: "0" });

    expect(result.exitCode).toBe(0);
    expect(fake.asked).toEqual([
      { request: "no roasts yet", route: "/roasts", calls: [{ key: LIST, summary: "" }] },
    ]);
  });

  it("takes the first of two tied states, as the box's first chip", async () => {
    fake.answerNext(planOf({ empty: 0.45, error: 0.35 }, [LIST]));
    const result = await plan("no roasts or broken");

    expect(JSON.parse(result.output)).toMatchObject({ calls: [{ key: LIST, state: "empty" }] });
  });

  it("prints a role the route plans, with no call, where the sentence names no state", async () => {
    fake.answerNext({ ...planOf({ none: 0.7 }, []), role: { role: "barista", p: 0.9 } });
    const result = await plan("as a barista");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      version: 2,
      calls: [],
      as: { role: "barista" },
      route: "/roasts",
      request: "as a barista",
    });
  });

  it.each<[string, ReturnType<typeof planOf> | null, RegExp]>([
    ["a sentence that names no state", planOf({ none: 0.7 }, []), /doesn't name a state/],
    ["a plan it is unsure of", planOf({ empty: 0.3 }, [LIST]), /Not sure enough.*empty at 0\.30/],
    ["a state no call is in", planOf({ empty: 0.8 }, []), /Not sure enough/],
  ])("fails on %s, and says why", async (_name, answer, said) => {
    fake.answerNext(answer);
    const result = await plan("whatever");

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(said);
  });

  it.each<[number, RegExp]>([
    [404, /plans nothing: \/mock\/plan answers only on a preview/],
    [401, /only for a signed-in reviewer/],
    [502, /could not plan: 502/],
  ])("fails on a %i from the route, and says what it means", async (status, said) => {
    fake.refuseNext(status);
    const result = await plan("no roasts");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.output).toMatch(said);
  });

  it.each([
    ["no sentence", ["mock", "plan", `--url=${ROUTE_URL}`, "--route=/", `--calls=${LIST}`]],
    ["no url", ["mock", "plan", "empty", "--route=/", `--calls=${LIST}`]],
    [
      "a url that is not one",
      ["mock", "plan", "empty", "--url=nope", "--route=/", `--calls=${LIST}`],
    ],
    [
      "a route that is not a path",
      ["mock", "plan", "empty", `--url=${ROUTE_URL}`, "--route=roasts", `--calls=${LIST}`],
    ],
    ["no calls", ["mock", "plan", "empty", `--url=${ROUTE_URL}`, "--route=/"]],
  ])("prints its usage with %s, and asks nobody", async (_name, argv) => {
    expect(await run(argv, { version: "0" })).toEqual({ output: MOCK_PLAN_USAGE, exitCode: 1 });
    expect(fake.asked).toEqual([]);
  });
});
