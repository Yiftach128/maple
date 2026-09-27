import { describe, expect, it } from "vitest";

import { withoutLayers } from "../src/connectors/keyword-layers.js";
import { keywordPlan } from "../src/connectors/keyword-plan.js";
import { plannedCall, stateFromWeights } from "../src/connectors/plan.js";
import { PLAN_FLOOR } from "../src/mock/reading.js";

import type { MockPlanCall, MockPlanState } from "../src/connectors/types.js";

const CALLS: readonly MockPlanCall[] = [
  { key: "trpc:roast.list", summary: "Roast[]: every roast, newest first" },
  { key: "trpc:bean.listByOrigin", summary: "Bean[]: beans from one origin" },
  { key: "trpc:user.me", summary: "User: who is signed in" },
  { key: "rest:POST /api/roasts", summary: "Roast: creates a roast" },
  { key: "trpc:roast.archive", summary: "mutation: archives a roast" },
];

function plan(request: string): ReturnType<typeof keywordPlan> {
  return keywordPlan({ request, route: "/roasts", calls: CALLS });
}

function concerned(request: string): string[] {
  return plan(request)
    .calls.filter((call) => call.concerned)
    .map((call) => call.key);
}

describe("the keyword planner's state", () => {
  const cases: readonly { request: string; state: MockPlanState }[] = [
    { request: "mock this page with an empty state", state: "empty" },
    { request: "what if there are no roasts yet", state: "empty" },
    { request: "first-time user with nothing", state: "empty" },
    { request: "the roast list fails to load with a 500", state: "error" },
    { request: "server is down", state: "error" },
    { request: "user without permission to see beans", state: "forbidden" },
    { request: "403 on the roast list", state: "forbidden" },
    { request: "no access to origins", state: "forbidden" },
    { request: "show the skeleton while it's loading", state: "loading" },
    { request: "just one roast", state: "one" },
    { request: "a single bean", state: "one" },
    { request: "lots of roasts, enough to paginate", state: "many" },
    { request: "hundreds of beans", state: "many" },
    { request: "a long list of roasts", state: "many" },
    { request: "roast names long enough to wrap", state: "long" },
    { request: "origins that get truncated", state: "long" },
    { request: "beans with no description", state: "sparse" },
    { request: "every optional field missing", state: "sparse" },
    { request: "no beans at all", state: "empty" },
    { request: "roasts in every status", state: "mixed" },
    { request: "a mix of paid and unpaid orders", state: "mixed" },
    { request: "make the header blue", state: "none" },
    { request: "", state: "none" },
  ];

  it.each(cases)("reads “$request” as $state", ({ request, state }) => {
    expect(plan(request).state).toBe(state);
  });

  it("is less sure of a sentence that names two states than of one naming one", () => {
    expect(plan("empty or error").confidence).toBeLessThan(plan("empty").confidence);
  });

  it("keeps one matched word above the gate's floor, however many states there are", () => {
    expect(plan("empty").confidence).toBeGreaterThanOrEqual(PLAN_FLOOR);
  });

  it("is surer of a sentence that says a state twice over", () => {
    expect(plan("empty, nothing at all").confidence).toBeGreaterThan(plan("empty").confidence);
  });
});

describe("the keyword planner's calls", () => {
  const cases: readonly { request: string; calls: readonly string[]; why: string }[] = [
    {
      request: "empty roast list",
      calls: ["trpc:roast.list", "rest:POST /api/roasts", "trpc:roast.archive"],
      why: "every call that shares a word, writes included",
    },
    {
      request: "no beans",
      calls: ["trpc:bean.listByOrigin"],
      why: "a plural folds onto the key's singular",
    },
    {
      request: "beans from one origin",
      calls: ["trpc:bean.listByOrigin"],
      why: "a camel-cased key splits into words",
    },
    {
      request: "mock this page with an empty state",
      calls: ["trpc:roast.list", "trpc:bean.listByOrigin", "trpc:user.me"],
      why: "a sentence naming no call is about the page, writes aside",
    },
  ];

  it.each(cases)("“$request”: $why", ({ request, calls }) => {
    expect(concerned(request)).toEqual(calls);
  });

  it("ranks the call that shares the most words above one that shares fewer", () => {
    const [roasts, , , create] = plan("every roast newest first").calls;
    expect(roasts?.p).toBeGreaterThan(create?.p ?? 1);
  });

  it("answers a route with no calls with no verdicts", () => {
    expect(keywordPlan({ request: "empty", route: "/", calls: [] }).calls).toEqual([]);
  });
});

describe("the plan arithmetic", () => {
  it("reads evidence for nothing as none, and none as the surest of a shrug", () => {
    const guess = stateFromWeights({});
    expect(guess.state).toBe("none");
    expect(guess.confidence).toBe(guess.distribution.none);
  });

  it("breaks a tie toward the earlier state", () => {
    expect(stateFromWeights({ one: 1, empty: 1 }).state).toBe("empty");
  });

  it.each([
    { p: 0.5, concerned: true },
    { p: 0.49, concerned: false },
    { p: 2, concerned: true },
    { p: -1, concerned: false },
  ])("derives concerned from p = $p", ({ p, concerned: expected }) => {
    const call = plannedCall("k", p);
    expect(call.concerned).toBe(expected);
    expect(call.p).toBeGreaterThanOrEqual(0);
    expect(call.p).toBeLessThanOrEqual(1);
  });
});

describe("the keyword planner's flags and role", () => {
  const FLAGS = [
    { key: "new-roaster", type: "boolean" as const },
    { key: "roastTier", type: "string" as const, variants: ["gold", "free"] },
    { key: "batch_limit", type: "number" as const, variants: [3, 10] },
  ];
  const ROLES = ["owner", "barista", "guest"];

  function layered(request: string) {
    return keywordPlan({ request, route: "/roasts", calls: CALLS, flags: FLAGS, roles: ROLES });
  }

  function set(request: string): Record<string, unknown> {
    const named = (layered(request).flags ?? []).filter((flag) => flag.concerned);
    return Object.fromEntries(named.map((flag) => [flag.key, flag.value]));
  }

  it.each<[string, Record<string, unknown>]>([
    ["with the new roaster", { "new-roaster": true }],
    ["the new roaster turned on", { "new-roaster": true }],
    ["without the new roaster", { "new-roaster": false }],
    ["turn off the new roaster", { "new-roaster": false }],
    ["the new roaster disabled", { "new-roaster": false }],
    ["new roasters off and the gold roast tier", { "new-roaster": false, roastTier: "gold" }],
    ["a batch limit of 10", { batch_limit: 10 }],
    ["the roast tier", {}],
    ["the roaster", {}],
    ["no roasts yet", {}],
  ])("reads %j as %j", (request, flags) => {
    expect(set(request)).toEqual(flags);
  });

  it.each<[string, string, Record<string, unknown>]>([
    ["a ticket prefix, which names the work", "ROAST-2210-sparkline-tooltips", {}],
    ["digits in a key", "cupping-form-v3", {}],
  ])("reads a key with %s", (_name, key) => {
    const sentence = key === "cupping-form-v3" ? "cupping form v3 on" : "sparkline tooltips off";
    const planned = keywordPlan({
      request: sentence,
      route: "/roasts",
      calls: CALLS,
      flags: [{ key, type: "boolean" }],
    });
    expect(planned.flags?.[0]?.concerned).toBe(true);
  });

  it("reads a role written with a hyphen as the words it joins", () => {
    const planned = keywordPlan({
      request: "as the head roaster",
      route: "/roasts",
      calls: CALLS,
      roles: ["roaster", "head-roaster"],
    });
    expect(planned.role?.role).toBe("head-roaster");
  });

  it("answers every listed flag once, in order, with one of its values", () => {
    const flags = layered("no roasts yet").flags ?? [];
    expect(flags.map((flag) => [flag.key, flag.concerned])).toEqual([
      ["new-roaster", false],
      ["roastTier", false],
      ["batch_limit", false],
    ]);
    expect(flags.map((flag) => flag.value)).toEqual([true, "gold", 3]);
  });

  it.each<[string, string | undefined]>([
    ["as a barista", "barista"],
    ["show it for an owner", "owner"],
    ["what a guest sees", "guest"],
    ["the barista's view with no roasts", "barista"],
    ["as a guest, then as an owner", "guest"],
    ["the owner column is empty", undefined],
    ["as an admin", undefined],
  ])("reads %j as the role %j", (request, role) => {
    expect(layered(request).role?.role).toBe(role);
  });

  it("names no flag and no role for a request that lists none", () => {
    const planned = plan("as a barista with the new roaster");
    expect(planned.flags).toBeUndefined();
    expect(planned.role).toBeUndefined();
  });

  it("keeps the state and the calls it read without the layers", () => {
    const planned = layered("no roasts as a barista with the new roaster");
    expect(planned.state).toBe("empty");
    expect(planned.calls.find((call) => call.key === "trpc:roast.list")?.concerned).toBe(true);
  });
});

describe("withoutLayers", () => {
  const FLAGS = [
    { key: "merge-forecast", type: "boolean" as const },
    { key: "roastTier", type: "string" as const, variants: ["gold", "free"] },
    { key: "comments", type: "boolean" as const },
  ];
  const ROLES = ["owner", "member", "head-roaster"];

  it.each<[string, string]>([
    [
      "as a member with the merge forecast on, and the reviews table empty",
      "the reviews table empty",
    ],
    ["as a member, with the merge forecast on", ""],
    ["the merge forecast turned off for an owner", ""],
    ["as the head roaster with no roasts yet", "no roasts yet"],
    ["gold roast tier and a single roast", "a single roast"],
    ["no comments", "no comments"],
    ["comments off and no roasts", "no roasts"],
    ["the owner column is empty", "the owner column is empty"],
    ["No Roasts As A Member", "No Roasts"],
  ])("reads %j as asking %j of the data", (request, left) => {
    expect(withoutLayers(request, FLAGS, ROLES)).toBe(left);
  });

  it("leaves a sentence alone on a page that lists no flags or roles", () => {
    expect(withoutLayers("as a member, no reviews", [], [])).toBe("as a member, no reviews");
  });
});

describe("a sentence naming a role, a flag and a state", () => {
  const PAGE: readonly MockPlanCall[] = [
    { key: "rest:GET /api/session", summary: "name, tint, role, permissions" },
    { key: "rest:GET /api/audit", summary: "items [AuditEvent: id, who, what, when]" },
    { key: "rest:GET /api/reviews", summary: "items [Review: id, repo, branch, state], total" },
  ];

  it.each<[string, string[]]>([
    [
      "as a member with the merge forecast on, and the reviews table empty",
      ["rest:GET /api/reviews"],
    ],
    ["as a member with the merge forecast on, and no open reviews", ["rest:GET /api/reviews"]],
    ["the member's view with no reviews", ["rest:GET /api/reviews"]],
  ])("%j puts its state on %j alone", (request, calls) => {
    const planned = keywordPlan({
      request,
      route: "/",
      calls: PAGE,
      flags: [{ key: "merge-forecast", type: "boolean" }],
      roles: ["owner", "member", "guest"],
    });
    expect(planned.state).toBe("empty");
    expect(planned.calls.filter((call) => call.concerned).map((call) => call.key)).toEqual(calls);
  });
});
