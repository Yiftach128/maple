/**
 * `POST /gate/refresh`: an agent asks, and the route decides and publishes.
 *
 * Everything the route calls is GitHub, so all three upstreams are faked: the
 * repository (push access), the App (installation tokens) and the check runs.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createInstallationAuth } from "../src/auth/installation.js";
import { githubGate } from "../src/connectors/github-gate.js";
import { createLogger } from "../src/logger/index.js";
import { memorySink } from "../src/logger/sinks/memory.js";
import { createMapleHandler } from "../src/route/index.js";
import { createCommentStore } from "../src/store.js";
import { sampleComment } from "../src/testing/fixtures.js";
import { memoryStore } from "../src/testing/memory-store.js";
import { pkcs1 } from "./keys.js";
import { createAppFake } from "./msw/github-app.js";
import { createChecksFake, MAPLE_APP } from "./msw/github-checks.js";
import { createRepoFake } from "./msw/github-repo.js";
import { createTestServer, useTestServer } from "./msw/server.js";

import type { RouteOptions } from "../src/route/index.js";
import type { CommentStore } from "../src/store.js";

const BASE = "https://preview.example.com";
const BRANCH = "feat/leaf";
const SHA = "f00dcafef00dcafef00dcafef00dcafef00dcafe";
const INSTALLATION = "7654321";
const HOUR = 60 * 60 * 1000;

const PUSHER = "ghp_pusher";
const READER = "ghp_reader";

let at = Date.parse("2026-09-27T12:00:00.000Z");
const now = (): number => at;

const app = createAppFake(INSTALLATION, now);
const checks = createChecksFake();
const repo = createRepoFake({
  [PUSHER]: "push",
  [READER]: "read",
  ghp_hidden: "hidden",
  ghp_forbidden: "forbidden",
  ghp_down: "down",
});
const server = createTestServer(...app.handlers, ...checks.handlers, ...repo.handlers);
useTestServer(server, { beforeAll, afterEach, afterAll });

beforeEach(() => {
  at = Date.parse("2026-09-27T12:00:00.000Z");
  app.reset();
  checks.reset();
  repo.reset();
});

async function withOpen(
  count: number,
  heads: Readonly<Record<string, string>> = { [BRANCH]: SHA },
): Promise<CommentStore> {
  const store = createCommentStore(memoryStore({ heads }));
  for (let index = 0; index < count; index += 1) {
    await store.append(sampleComment({ branch: BRANCH, body: `comment ${String(index)}` }));
  }
  return store;
}

/** The route as a host wires it: the gate App's installation auth, one per process. */
function mounted(store: CommentStore, extra: Partial<RouteOptions> = {}) {
  const installation = createInstallationAuth({
    appId: String(MAPLE_APP),
    installationId: INSTALLATION,
    privateKey: pkcs1,
    now,
  });
  return createMapleHandler({
    store,
    gate: async () =>
      githubGate({
        owner: "maple-kit",
        repo: "app",
        token: await installation.token(),
        appId: MAPLE_APP,
      }),
    gateRefresh: { owner: "maple-kit", repo: "app", now },
    ...extra,
  });
}

function refresh(body: unknown, token?: string, method = "POST"): Request {
  return new Request(`${BASE}/api/maple/gate/refresh`, {
    method,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

describe("refreshing the gate", () => {
  it("publishes the verdict the store decides and says what it published", async () => {
    const handle = mounted(await withOpen(2));

    const response = await handle(refresh({ branch: BRANCH }, PUSHER));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      branch: BRANCH,
      sha: SHA,
      verdict: { conclusion: "blocked", reason: "comments-open", open: 2, total: 2 },
    });
    expect(checks.runsOn(SHA).at(-1)?.status).toBe("in_progress");
  });

  it("clears the check once every comment is resolved, with no push", async () => {
    const store = await withOpen(1);
    await store.setStatus("mem_1", "resolved");
    const handle = mounted(store);

    await handle(refresh({ branch: BRANCH }, PUSHER));

    expect(checks.runsOn(SHA).at(-1)).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("ignores any verdict the caller sends", async () => {
    const handle = mounted(await withOpen(1));

    const response = await handle(
      refresh({ branch: BRANCH, conclusion: "clear", verdict: { conclusion: "clear" } }, PUSHER),
    );

    expect(
      ((await response.json()) as { verdict: { conclusion: string } }).verdict.conclusion,
    ).toBe("blocked");
    expect(checks.runsOn(SHA).at(-1)?.conclusion).toBeNull();
  });

  it("mints a fresh installation token once the cached one has expired", async () => {
    const handle = mounted(await withOpen(1));

    await handle(refresh({ branch: BRANCH }, PUSHER));
    at += 2 * HOUR;
    const response = await handle(refresh({ branch: BRANCH }, PUSHER));

    expect(response.status).toBe(200);
    expect(app.mints()).toBe(2);
  });

  it("answers 409 for a branch with no head commit, and publishes nothing", async () => {
    const handle = mounted(await withOpen(1, {}));

    const response = await handle(refresh({ branch: BRANCH }, PUSHER));

    expect(response.status).toBe(409);
    expect(checks.runsOn(SHA)).toHaveLength(0);
  });
});

describe("who may refresh", () => {
  it.each([
    ["no token at all", undefined, 401],
    ["a token GitHub does not accept", "ghp_expired", 401],
    ["a token that can only read", READER, 403],
    ["a token that cannot see the repository", "ghp_hidden", 403],
    ["a token GitHub forbids", "ghp_forbidden", 403],
  ])("refuses %s", async (_case, token, status) => {
    const handle = mounted(await withOpen(1));

    const response = await handle(refresh({ branch: BRANCH }, token));

    expect(response.status).toBe(status);
    expect(checks.runsOn(SHA)).toHaveLength(0);
    expect(app.mints()).toBe(0);
  });

  it("asks GitHub once per token, until the answer is a minute old", async () => {
    const handle = mounted(await withOpen(1));

    await handle(refresh({ branch: BRANCH }, PUSHER));
    await handle(refresh({ branch: BRANCH }, PUSHER));
    expect(repo.calls()).toBe(1);

    at += 61 * 1000;
    await handle(refresh({ branch: BRANCH }, PUSHER));
    expect(repo.calls()).toBe(2);
  });

  it("fails without logging the token when GitHub cannot answer", async () => {
    const sink = memorySink();
    const handle = mounted(await withOpen(1), { logger: createLogger({ sinks: [sink] }) });

    const response = await handle(refresh({ branch: BRANCH }, "ghp_down"));

    expect(response.status).toBe(500);
    const logged = sink.records.map(
      (record) => `${record.message} ${String(record.error?.message)}`,
    );
    expect(logged.join("\n")).toMatch(/GitHub 502/);
    expect(logged.join("\n")).not.toContain("ghp_down");
  });

  it("builds the store on the caller's own token when told how", async () => {
    const store = await withOpen(1);
    const seen: string[] = [];
    const handle = mounted(await withOpen(0), {
      gateRefresh: {
        owner: "maple-kit",
        repo: "app",
        now,
        store: (token) => {
          seen.push(token);
          return store;
        },
      },
    });

    const response = await handle(refresh({ branch: BRANCH }, PUSHER));

    expect(response.status).toBe(200);
    expect(seen).toEqual([PUSHER]);
  });
});

describe("a malformed refresh", () => {
  it.each([
    ["without a branch", refresh({}, PUSHER), 400],
    ["with a GET", refresh(undefined, PUSHER, "GET"), 405],
  ])("is refused %s", async (_case, request, status) => {
    const handle = mounted(await withOpen(1));
    expect((await handle(request)).status).toBe(status);
  });

  it("is not found where the route was not given gateRefresh", async () => {
    const handle = createMapleHandler({ store: await withOpen(1) });
    expect((await handle(refresh({ branch: BRANCH }, PUSHER))).status).toBe(404);
  });

  it("is not found where the route publishes no gate", async () => {
    const handle = createMapleHandler({
      store: await withOpen(1),
      gateRefresh: { owner: "maple-kit", repo: "app", now },
    });
    expect((await handle(refresh({ branch: BRANCH }, PUSHER))).status).toBe(404);
  });
});
