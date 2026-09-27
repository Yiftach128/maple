import { createCommentStore } from "@maple-kit/core";
import { memoryStore, sampleComment } from "@maple-kit/core/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestServer, useTestServer } from "../../core/test/msw/server.js";
import { gateFromEnvironment, refreshFromEnvironment } from "../src/config.js";
import { createToolHandlers } from "../src/handlers.js";
import { serverLogger } from "../src/logger.js";
import { routeRefresh } from "../src/refresh.js";
import { BROKEN, createRouteFake, PUSHER, READER, ROUTE } from "./msw/route.js";

const BRANCH = "feature/agent";
const HEAD = "9ab1c2d";

const route = createRouteFake();
const server = createTestServer(...route.handlers);
useTestServer(server, { beforeAll, afterEach, afterAll });
beforeEach(() => route.reset());

/** A stream that remembers what was written to it. */
function captured(): { write(text: string): boolean; text(): string } {
  const chunks: string[] = [];
  return {
    write(text) {
      chunks.push(text);
      return true;
    },
    text: () => chunks.join(""),
  };
}

async function resolveWith(token: string, url = ROUTE) {
  const store = createCommentStore(memoryStore({ heads: { [BRANCH]: HEAD } }));
  const comment = await store.append(sampleComment({ branch: BRANCH }));
  const stderr = captured();
  const handlers = createToolHandlers({
    store,
    refresh: routeRefresh({ url, token }),
    logger: serverLogger(stderr),
  });
  const updated = await handlers.resolveComment({ id: comment.id, sha: HEAD });
  return { updated, stderr: stderr.text() };
}

describe("a resolve with MAPLE_URL set", () => {
  it("asks the route to refresh, with the branch and the caller's own token", async () => {
    const { updated, stderr } = await resolveWith(PUSHER);

    expect(updated.status).toBe("resolved");
    expect(route.asked()).toEqual([
      { authorization: `Bearer ${PUSHER}`, body: { branch: BRANCH } },
    ]);
    expect(stderr).toBe("");
  });

  it("sends no verdict: the route decides it", async () => {
    await resolveWith(PUSHER);
    expect(Object.keys(route.asked()[0]?.body as object)).toEqual(["branch"]);
  });

  it("tolerates a trailing slash on MAPLE_URL", async () => {
    await resolveWith(PUSHER, `${ROUTE}/`);
    expect(route.asked()).toHaveLength(1);
  });

  it.each([
    ["a token without push", READER, /403: This token cannot push.*needs push access/],
    ["a route that fails", BROKEN, /500: Something went wrong/],
  ])("reports %s on stderr, and the resolve still succeeds", async (_case, token, message) => {
    const { updated, stderr } = await resolveWith(token);

    expect(updated.status).toBe("resolved");
    expect(stderr).toMatch(/could not refresh the merge gate/);
    expect(stderr).toMatch(message);
    expect(stderr).not.toContain(token);
  });
});

describe("choosing how the gate is published", () => {
  const repo = { GITHUB_TOKEN: PUSHER, MAPLE_GITHUB_OWNER: "o", MAPLE_GITHUB_REPO: "r" };

  it("refuses to start with both MAPLE_URL and MAPLE_GATE_TOKEN", () => {
    const both = { ...repo, MAPLE_URL: ROUTE, MAPLE_GATE_TOKEN: "ghs_gate" };
    expect(() => refreshFromEnvironment(both)).toThrow(/MAPLE_URL and MAPLE_GATE_TOKEN are both/);
    expect(() => gateFromEnvironment(both)).toThrow(/cannot start with both/);
  });

  it.each([
    ["neither", {}, false, false],
    ["MAPLE_URL", { MAPLE_URL: ROUTE }, true, false],
    ["MAPLE_URL empty, as the plugin passes it", { MAPLE_URL: "" }, false, false],
    ["MAPLE_GATE_TOKEN", { MAPLE_GATE_TOKEN: "ghs_gate" }, false, true],
  ])("with %s", (_case, extra, refreshes, gates) => {
    const env = { ...repo, ...extra };
    expect(refreshFromEnvironment(env) !== undefined).toBe(refreshes);
    expect(gateFromEnvironment(env) !== undefined).toBe(gates);
  });
});
