import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createInventory,
  createMockClient,
  planCall,
  PlanUnavailableError,
  routePlan,
  seenFlags,
} from "../src/index.js";
import { createPlanFake, PLAN_URL, SURE } from "./msw/plan.js";
import { createTestServer, useTestServer } from "./msw/server.js";

import type { MockHandle, MockView, PlanLookup } from "../src/index.js";
import type { MockPlan, MockPlanState } from "@maple-kit/core/connectors";

const fake = createPlanFake();
const server = createTestServer(...fake.handlers);
useTestServer(server, { afterAll, afterEach, beforeAll });
afterEach(() => fake.reset());

const ROUTE = "/roasts";
const LIST = "rest:GET /api/roasts";
const USER = "rest:GET /api/session";

/** A plan with the given shares, every call concerned unless named otherwise. */
function planOf(shares: Partial<Record<MockPlanState, number>>, concerned = [LIST]): MockPlan {
  const distribution = { ...SURE.distribution, ...shares };
  const state = (Object.keys(shares)[0] ?? "none") as MockPlanState;
  return {
    state,
    distribution,
    confidence: distribution[state],
    calls: [LIST, USER].map((key) => ({ key, concerned: concerned.includes(key), p: 0.9 })),
  };
}

describe("what a planner reads of a recorded call", () => {
  it.each<[string, unknown, string]>([
    ["an object's fields", { name: "Ada", tint: 3 }, "name, tint"],
    [
      "a list inside a page",
      { items: [{ id: "r_1", origin: "Huila" }], total: 9 },
      "items [id, origin], total",
    ],
    ["a bare list", [{ id: 1 }], "list of [id]"],
    ["a scalar", 42, ""],
  ])("names %s, and no value", (_name, body, summary) => {
    const call = planCall({ key: LIST, status: 200, body, at: 1 });
    expect(call).toEqual({ key: LIST, summary });
  });
});

function view(): MockView {
  const url = new URL(`https://preview.example.com${ROUTE}`);
  return {
    location: { href: url.href, pathname: url.pathname, assign: vi.fn(), protocol: url.protocol },
  } as unknown as MockView;
}

function handle(plan?: PlanLookup): MockHandle {
  const inventory = createInventory();
  inventory.record(ROUTE, { key: USER, status: 200, body: { name: "Ada" }, at: 1 });
  inventory.record(ROUTE, { key: LIST, status: 200, body: { items: [{ id: "r_1" }] }, at: 2 });
  return { recipe: undefined, inventory, ...(plan ? { plan } : {}), dispose: () => undefined };
}

describe("the box, planning a sentence", () => {
  const settle = () => vi.advanceTimersByTimeAsync(600);

  it("reads the field as a sentence where the route plans, and lists every call", () => {
    const client = createMockClient({ view: view(), handle: handle(() => Promise.resolve(null)) });
    client.setQuery("no roasts at all");

    expect(client.getState().planning).toBe(true);
    expect(client.getState().calls.map((row) => row.key)).toEqual([LIST, USER]);
  });

  it("plans once a pause in typing, with the route's calls and their names", async () => {
    vi.useFakeTimers();
    const plan = vi.fn<PlanLookup>(() => Promise.resolve(planOf({ empty: 0.7 })));
    const client = createMockClient({ view: view(), handle: handle(plan) });
    for (const typed of ["no r", "no ro", "no roasts"]) client.setQuery(typed);
    await settle();

    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan.mock.calls[0]?.[0]).toEqual({
      request: "no roasts",
      route: ROUTE,
      calls: [
        { key: LIST, summary: "items [id]" },
        { key: USER, summary: "name" },
      ],
    });
    expect(client.getState().suggestions).toEqual([{ state: "empty", calls: [LIST] }]);
    vi.useRealTimers();
  });

  it("abandons a plan in flight when the sentence changes", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const plan = vi.fn<PlanLookup>((_request, signal) => {
      if (signal) signals.push(signal);
      return new Promise(() => undefined);
    });
    const client = createMockClient({ view: view(), handle: handle(plan) });
    client.setQuery("no roasts");
    await settle();
    client.setQuery("no roasts at all");

    expect(signals[0]?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("thinks while the route reads the sentence, and not while it is typed", async () => {
    vi.useFakeTimers();
    const held: { answer?: (plan: MockPlan) => void } = {};
    const plan = vi.fn<PlanLookup>(() => new Promise((resolve) => (held.answer = resolve)));
    const client = createMockClient({ view: view(), handle: handle(plan) });
    const thinking = () => client.getState().thinking;

    client.setQuery("no roasts");
    expect(thinking()).toBe(false);
    await settle();
    expect(thinking()).toBe(true);
    client.setQuery("no roasts yet");
    expect(thinking()).toBe(false);
    await settle();
    held.answer?.(planOf({ empty: 0.7 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(thinking()).toBe(false);
    expect(client.getState().suggestions).toHaveLength(1);
    vi.useRealTimers();
  });

  it("puts the reading's calls in its state and keeps the sentence in the recipe", async () => {
    vi.useFakeTimers();
    const client = createMockClient({
      view: view(),
      handle: handle(() => Promise.resolve(planOf({ empty: 0.7 }))),
    });
    client.setQuery("  no roasts  ");
    await settle();

    expect(client.recipe()).toEqual({
      version: 2,
      calls: [{ key: LIST, state: "empty" }],
      route: ROUTE,
      request: "no roasts",
    });
    client.clear();
    expect(client.getState().request).toBeUndefined();
    vi.useRealTimers();
  });

  it("puts the draft back as it was when the field is emptied", async () => {
    vi.useFakeTimers();
    const client = createMockClient({
      view: view(),
      handle: handle(() => Promise.resolve(planOf({ empty: 0.7 }))),
    });
    client.choose(USER, "error");
    client.setQuery("no roasts");
    await settle();
    expect(client.getState().draft).toEqual([
      { key: USER, state: "error" },
      { key: LIST, state: "empty" },
    ]);

    client.setQuery("");
    expect(client.getState().draft).toEqual([{ key: USER, state: "error" }]);
    expect(client.getState().request).toBeUndefined();
    vi.useRealTimers();
  });

  it("applies each new reading over the draft from before the sentence", async () => {
    vi.useFakeTimers();
    const plans = [planOf({ empty: 0.7 }), planOf({ error: 0.7 })];
    const client = createMockClient({
      view: view(),
      handle: handle(() => Promise.resolve(plans.shift() ?? null)),
    });
    client.setQuery("no roasts");
    await settle();
    client.setQuery("roasts broken");
    await settle();

    expect(client.getState().draft).toEqual([{ key: LIST, state: "error" }]);
    vi.useRealTimers();
  });

  it("keeps a hand edit when the field is emptied after it", async () => {
    vi.useFakeTimers();
    const client = createMockClient({
      view: view(),
      handle: handle(() => Promise.resolve(planOf({ empty: 0.7 }))),
    });
    client.setQuery("no roasts");
    await settle();
    client.choose(USER, "forbidden");
    client.setQuery("");

    expect(client.getState().draft).toEqual([
      { key: LIST, state: "empty" },
      { key: USER, state: "forbidden" },
    ]);
    vi.useRealTimers();
  });

  it("sends the flags the page evaluated, by key, type and variants, and never a value", async () => {
    vi.useFakeTimers();
    seenFlags().record({ key: "new-roaster", type: "boolean", value: true });
    seenFlags().record({ key: "tier", type: "string", value: "gold", variants: ["gold", "free"] });
    const plan = vi.fn<PlanLookup>(() => Promise.resolve(null));
    const client = createMockClient({ view: view(), handle: handle(plan) });
    client.setQuery("without the new roaster");
    await settle();

    expect(plan.mock.calls[0]?.[0].flags).toEqual([
      { key: "new-roaster", type: "boolean" },
      { key: "tier", type: "string", variants: ["gold", "free"] },
    ]);
    vi.useRealTimers();
  });

  it("puts a reading's flags beside the draft's and its role in place of the draft's", async () => {
    vi.useFakeTimers();
    const planned: MockPlan = {
      ...planOf({ none: 0.7 }),
      flags: [{ key: "new-roaster", value: false, concerned: true, p: 0.9 }],
      role: { role: "barista", p: 0.9 },
    };
    const client = createMockClient({
      view: view(),
      handle: handle(() => Promise.resolve(planned)),
    });
    client.setFlag("tier", "gold");
    client.setPermission("roasts.delete", false);
    client.setRole("owner");
    client.setQuery("as a barista without the new roaster");
    await settle();

    expect(client.getState().suggestions).toEqual([
      { calls: [], flags: { "new-roaster": false }, as: { role: "barista" } },
    ]);
    expect(client.recipe()).toEqual({
      version: 2,
      calls: [],
      flags: { tier: "gold", "new-roaster": false },
      as: { role: "barista", permissions: { "roasts.delete": false } },
      route: ROUTE,
      request: "as a barista without the new roaster",
    });
    vi.useRealTimers();
  });

  /** A surface waits on `request` before Apply, so it must never run ahead of the draft. */
  it("names a sentence in the same change that puts its reading in the draft", async () => {
    vi.useFakeTimers();
    const full: MockPlan = {
      ...planOf({ none: 0.7 }),
      flags: [{ key: "new-roaster", value: false, concerned: true, p: 0.9 }],
      role: { role: "barista", p: 0.9 },
    };
    const plans = [planOf({ empty: 0.7 }), full];
    const client = createMockClient({
      view: view(),
      handle: handle(() => Promise.resolve(plans.shift() ?? null)),
    });
    const seen: ReturnType<typeof client.getState>[] = [];
    client.subscribe((state) => seen.push(state));
    // A slow typist: the route answers the pause before the sentence is done.
    client.setQuery("as a barista, no roasts");
    await settle();
    client.setQuery("as a barista, no roasts, no new roaster");
    await settle();

    // Every distinct pairing of a sentence with a draft that a listener was shown.
    const pairs = new Map(
      seen
        .filter((state) => state.request !== undefined)
        .map(({ request, draft, draftFlags, draftAs }) => {
          const pair = { request, draft, draftFlags, draftAs };
          return [JSON.stringify(pair), pair] as const;
        }),
    );
    expect([...pairs.values()]).toEqual([
      {
        request: "as a barista, no roasts",
        draft: [{ key: LIST, state: "empty" }],
        draftFlags: {},
        draftAs: undefined,
      },
      {
        request: "as a barista, no roasts, no new roaster",
        draft: [],
        draftFlags: { "new-roaster": false },
        draftAs: { role: "barista" },
      },
    ]);
    vi.useRealTimers();
  });

  it("goes back to filtering for good once the route says it plans nothing", async () => {
    vi.useFakeTimers();
    const plan = vi.fn<PlanLookup>(() => Promise.reject(new PlanUnavailableError("no")));
    const client = createMockClient({ view: view(), handle: handle(plan) });
    client.setQuery("roasts");
    await settle();

    expect(client.getState().planning).toBe(false);
    expect(client.getState().calls.map((row) => row.key)).toEqual([LIST]);
    client.setQuery("session");
    await settle();
    expect(plan).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("shows nothing when a plan fails, and keeps planning", async () => {
    vi.useFakeTimers();
    const client = createMockClient({
      view: view(),
      handle: handle(() => Promise.reject(new Error("502"))),
    });
    client.setQuery("no roasts");
    await settle();

    expect(client.getState()).toMatchObject({ planning: true, suggestions: [], unnamed: false });
    vi.useRealTimers();
  });

  it("stays a filter when the host says so, or nothing plans", () => {
    const off = createMockClient({
      view: view(),
      handle: handle(() => Promise.resolve(null)),
      plan: false,
    });
    const none = createMockClient({ view: view(), handle: handle() });
    expect(off.getState().planning).toBe(false);
    expect(none.getState().planning).toBe(false);
  });
});

describe("the route's planner, over the network", () => {
  const lookup = routePlan({
    basePath: "/api/maple/",
    fetch: (input, init) => fetch(input, init),
    origin: "https://preview.example.com",
  });
  const asked = { request: "no roasts", route: ROUTE, calls: [{ key: LIST, summary: "items" }] };

  it("posts the sentence, the route and the calls, and answers the plan", async () => {
    const plan = await lookup(asked);

    expect(fake.asked).toEqual([asked]);
    expect(plan?.state).toBe("empty");
    expect(plan?.calls).toEqual([{ key: LIST, concerned: true, p: 0.9 }]);
  });

  it("posts the page's flags when it lists some, and no roles: the route has its own", async () => {
    const flags = [{ key: "new-roaster", type: "boolean" as const }];
    await lookup({ ...asked, flags, roles: ["admin"] });
    expect(fake.asked).toEqual([{ ...asked, flags }]);
  });

  it("answers null for a blank sentence", async () => {
    expect(await lookup({ ...asked, request: " " })).toBeNull();
  });

  it("says a route with no planner is one, and any other failure is a plain error", async () => {
    fake.refuseNext(404);
    await expect(lookup(asked)).rejects.toBeInstanceOf(PlanUnavailableError);
    fake.refuseNext(500);
    await expect(lookup(asked)).rejects.toThrow(/could not plan: 500/);
  });

  it("is at the address the page names", () => {
    expect(PLAN_URL).toBe("https://preview.example.com/api/maple/mock/plan");
  });
});
