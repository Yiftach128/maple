import { readPlan } from "@maple-kit/core/mock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { jevClassifier } from "../src/index.js";
import { PAGE_CALLS, recordedPlanner } from "./msw/planner.js";
import { createTestServer, useTestServer } from "./msw/server.js";

const server = createTestServer(...recordedPlanner());
useTestServer(server, { afterAll, afterEach, beforeAll });

/** The Vite example's page: three calls, one flag, the session's three roles. */
function plan(request: string) {
  return jevClassifier({ apiKey: "test-key" }).plan?.({
    request,
    route: "/",
    calls: PAGE_CALLS,
    flags: [{ key: "merge-forecast", type: "boolean" }],
    roles: ["owner", "member", "guest"],
  });
}

describe("a sentence naming a role or a flag and a state", () => {
  it.each<[string, string[], string | undefined, boolean | undefined]>([
    ["as a member, with the merge forecast on", [], "member", true],
    ["show the reviews table empty", ["rest:GET /api/reviews"], undefined, undefined],
    [
      "as a member with the merge forecast on, and the reviews table empty",
      ["rest:GET /api/reviews"],
      "member",
      true,
    ],
  ])("%j mocks %j", async (request, mocked, role, forecast) => {
    const [best] = readPlan((await plan(request)) ?? null).suggestions;

    expect(best?.calls).toEqual(mocked);
    expect(best?.as?.role).toBe(role);
    expect(best?.flags?.["merge-forecast"]).toBe(forecast);
  });

  it("puts the state only on the call the sentence names, not on the session", async () => {
    const planned = await plan(
      "as a member with the merge forecast on, and the reviews table empty",
    );

    expect(planned?.state).toBe("empty");
    expect(planned?.calls.map((call) => [call.key, call.concerned])).toEqual([
      ["rest:GET /api/session", false],
      ["rest:GET /api/audit", false],
      ["rest:GET /api/reviews", true],
    ]);
  });

  it("reports an endpoint that errors as a plain error", async () => {
    await expect(plan("a sentence nobody recorded")).rejects.toThrow(/could not plan/);
  });
});
