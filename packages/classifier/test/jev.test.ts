import { DEFAULT_PILLARS, MOCK_PLAN_STATES } from "@maple-kit/core/connectors";
import { runClassifierContract } from "@maple-kit/core/testing";
import { delay, http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { jevClassifier } from "../src/index.js";
import { createTestServer, useTestServer } from "./msw/server.js";
import { createSystemOneFake } from "./msw/systemone.js";

const fake = createSystemOneFake();
const server = createTestServer(...fake.handlers);

useTestServer(server, { afterAll, afterEach, beforeAll });
afterEach(() => fake.reset());

/** Calls a page recorded, as a planner is given them. */
const CALLS = [
  { key: "trpc:roast.list", summary: "Roast[]: every roast" },
  { key: "trpc:user.me", summary: "User: who is signed in" },
  { key: "rest:POST /api/roasts", summary: "Roast: creates one" },
];

/** The connector every test here builds, against the fake endpoint. */
function connector(options: Partial<Parameters<typeof jevClassifier>[0]> = {}) {
  return jevClassifier({ apiKey: "test-key", ...options });
}

runClassifierContract({
  create: () => Promise.resolve({ connector: connector() }),
  name: "jev",
});

describe("jevClassifier", () => {
  it("carries every pillar and the kind in one request each", async () => {
    const jev = connector();

    await jev.score?.({ body: "The Save button is cut off." });
    expect(fake.asked).toHaveLength(1);
    expect(Object.keys(fake.asked[0]?.questions ?? {})).toEqual(
      DEFAULT_PILLARS.map((pillar) => `pillar:${pillar.id}`),
    );

    await jev.classify?.({ body: "The Save button is cut off." });
    expect(fake.asked).toHaveLength(2);
    expect(Object.keys(fake.asked[1]?.questions ?? {})).toEqual(["kind"]);
  });

  it("sends the comment as the whole state, and the flagship alias", async () => {
    await connector().score?.({ body: "the sav" });

    expect(fake.asked[0]?.state).toEqual({ comment: "the sav" });
    expect(fake.asked[0]?.model).toBe("jev-latest");
  });

  it("asks a score question per pillar and a choice for the kind", async () => {
    await connector().score?.({ body: "x" });
    await connector().classify?.({ body: "x" });

    expect(fake.asked[0]?.questions["pillar:specific"]?.type).toBe("score");
    expect(fake.asked[0]?.questions["pillar:specific"]?.criteria).toHaveLength(3);
    expect(fake.asked[1]?.questions["kind"]?.type).toBe("choice");
    expect(Object.keys(fake.asked[1]?.questions["kind"]?.criteria as object)).toContain("praise");
  });

  it("returns jev's own probabilities rather than a spread around a level", async () => {
    const scores = await connector().score?.({ body: "x", pillars: ["specific"] });

    expect(scores?.[0]?.distribution).toEqual([0.15, 0.7, 0.15]);
    expect(scores?.[0]?.level).toBe(1);
    expect(scores?.[0]?.confidence).toBeCloseTo(0.6, 10);
  });

  it("asks a model and a base url a deployment chose", async () => {
    const local = createSystemOneFake("http://localhost:8080/v1/systemone");
    server.use(...local.handlers);

    await connector({ baseUrl: "http://localhost:8080/v1", model: "jev-preview" }).classify?.({
      body: "x",
    });

    expect(local.asked).toHaveLength(1);
    expect(local.asked[0]?.model).toBe("jev-preview");
    expect(fake.asked).toHaveLength(0);
  });

  it("scores only the pillars a host configured", async () => {
    const only = [DEFAULT_PILLARS[0]!];
    const jev = connector({ pillars: only });

    expect(jev.pillars).toEqual(only);
    expect(await jev.score?.({ body: "x" })).toHaveLength(1);
  });

  it("reports a refused request as a plain error naming the connector", async () => {
    fake.failNext(401, { detail: "InvalidKey" });

    await expect(connector().classify?.({ body: "x" })).rejects.toThrow(/^Classifier "jev"/);
    expect(await connector().classify?.({ body: "x" })).toBeDefined();
  });

  it("reports a rate limit and an overload the same way, without retrying", async () => {
    for (const status of [429, 529]) {
      fake.failNext(status);
      await expect(connector().score?.({ body: "x" })).rejects.toThrow(/could not score/);
    }
    expect(fake.asked).toHaveLength(0);
  });

  it("opens no request at all for a keystroke already superseded", async () => {
    const aborted = AbortSignal.abort();

    await expect(connector().classify?.({ body: "x", signal: aborted })).rejects.toThrow();
    expect(fake.asked).toHaveLength(0);
  });

  it("abandons a judgement in flight when the next keystroke arrives", async () => {
    const slow = createSystemOneFake("https://slow.example/v1/systemone");
    server.use(
      ...slow.handlers,
      http.post("https://slow.example/v1/systemone", async () => {
        await delay(200);
        return HttpResponse.json({ answers: {}, model: "jev-1.13.0" });
      }),
    );

    const controller = new AbortController();
    const judging = connector({ baseUrl: "https://slow.example/v1" }).score?.({
      body: "x",
      signal: controller.signal,
    });
    controller.abort();

    await expect(judging).rejects.toThrow();
  });

  it("plans a sentence in one request: its state, and one question per call", async () => {
    await connector().plan?.({ request: "no roasts", route: "/roasts", calls: CALLS });

    expect(fake.asked).toHaveLength(1);
    const questions = fake.asked[0]?.questions ?? {};
    expect(Object.keys(questions)).toEqual(["state", "call:0", "call:1", "call:2"]);
    expect(questions["state"]?.type).toBe("choice");
    expect(Object.keys(questions["state"]?.criteria as object)).toEqual(MOCK_PLAN_STATES);
    expect(questions["call:1"]?.type).toBe("noul");
    expect(questions["call:1"]?.instructions).toContain("trpc:user.me");
  });

  it("sends the sentence, the route and the calls as the state, and nothing else", async () => {
    await connector().plan?.({ request: "no roasts", route: "/roasts", calls: CALLS });

    expect(fake.asked[0]?.state).toEqual({ request: "no roasts", route: "/roasts", calls: CALLS });
  });

  it("keeps jev's own probabilities for the state and for every call", async () => {
    const plan = await connector().plan?.({ request: "x", route: "/", calls: CALLS });

    expect(plan?.state).toBe(MOCK_PLAN_STATES[1]);
    expect(plan?.distribution[MOCK_PLAN_STATES[1]!]).toBeCloseTo(0.7, 10);
    expect(plan?.confidence).toBeCloseTo(0.7, 10);
    expect(plan?.calls).toEqual([
      { key: "trpc:roast.list", concerned: true, p: 0.8 },
      { key: "trpc:user.me", concerned: false, p: 0.2 },
      { key: "rest:POST /api/roasts", concerned: true, p: 0.8 },
    ]);
  });

  it("asks only for the state when the route has made no calls", async () => {
    const plan = await connector().plan?.({ request: "empty", route: "/", calls: [] });

    expect(Object.keys(fake.asked[0]?.questions ?? {})).toEqual(["state"]);
    expect(plan?.calls).toEqual([]);
  });

  describe("with flags and roles", () => {
    const FLAGS = [
      { key: "new-roaster", type: "boolean" as const },
      { key: "tier", type: "string" as const, variants: ["gold", "free"] },
    ];
    const layered = {
      request: "x",
      route: "/roasts",
      calls: CALLS,
      flags: FLAGS,
      roles: ["owner", "barista"],
    };

    it("asks for them in a second request, leaving the first as it is without them", async () => {
      await connector().plan?.(layered);

      expect(fake.asked).toHaveLength(2);
      const asksState = (asked: (typeof fake.asked)[number]) => "state" in asked.questions;
      const data = fake.asked.find(asksState);
      const layers = fake.asked.find((asked) => !asksState(asked));
      expect(data?.state).toEqual({ request: "x", route: "/roasts", calls: CALLS });
      expect(Object.keys(layers?.questions ?? {})).toEqual(["flag:0", "flag:1", "role"]);
      expect(layers?.state).toEqual({
        request: "x",
        route: "/roasts",
        flags: [
          { key: "new-roaster", values: ["on", "off"] },
          { key: "tier", values: ["gold", "free"] },
        ],
        roles: ["owner", "barista"],
      });
      expect(layers?.questions["flag:0"]?.instructions).toContain("new-roaster");
      expect(Object.keys(layers?.questions["flag:1"]?.criteria as object)).toEqual([
        "gold",
        "free",
        "leave-unchanged",
      ]);
    });

    it("reads each flag's likeliest value and the likeliest role", async () => {
      const plan = await connector().plan?.(layered);

      expect(plan?.flags).toEqual([
        { key: "new-roaster", value: false, concerned: true, p: 0.7 },
        { key: "tier", value: "free", concerned: true, p: 0.7 },
      ]);
      expect(plan?.role).toEqual({ role: "barista", p: 0.7 });
    });

    it("names no role where naming none is likelier", async () => {
      const plan = await connector().plan?.({ ...layered, flags: [], roles: ["owner"] });
      expect(plan?.role).toBeUndefined();
      expect(plan?.flags).toEqual([]);
    });

    it("judges the calls on the sentence less the role and flags it names", async () => {
      await connector().plan?.({ ...layered, request: "no roasts as a barista, new roaster on" });

      const data = fake.asked.find((asked) => "state" in asked.questions);
      expect(data?.state).toEqual({
        request: "no roasts as a barista, new roaster on",
        data: "no roasts",
        route: "/roasts",
        calls: CALLS,
      });
      expect(data?.questions["call:0"]?.instructions).toContain("`data`");
      expect(data?.questions["state"]?.instructions).not.toContain("`data`");
    });

    it("asks once, as without them, when the request lists none", async () => {
      await connector().plan?.({ ...layered, flags: [], roles: [] });
      expect(fake.asked).toHaveLength(1);
    });
  });

  it("reports an account out of credit as a plain error, without retrying", async () => {
    fake.failNext(402, { detail: "PaymentRequired" });

    await expect(connector().plan?.({ request: "x", route: "/", calls: CALLS })).rejects.toThrow(
      /^Classifier "jev" could not plan/,
    );
    expect(fake.asked).toHaveLength(0);
  });

  it("abandons a plan the endpoint never answers, at its timeout", async () => {
    fake.stallNext();
    const started = Date.now();

    await expect(
      connector({ timeoutMs: 50 }).plan?.({ request: "x", route: "/", calls: CALLS }),
    ).rejects.toThrow(/could not plan/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("costs nothing until something is judged", () => {
    expect(() => connector({ apiKey: "" })).not.toThrow();
    expect(fake.asked).toHaveLength(0);
  });
});
