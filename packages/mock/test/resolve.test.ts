import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { createInventory, MANY, resolve, restCodec } from "@maple-kit/mock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API, createApiFake, ME, PROJECTS, SESSION } from "./msw/api.js";
import { RULES } from "./msw/identity.js";
import { createTestServer, useTestServer } from "./msw/server.js";

import type { MockState, Recipe } from "@maple-kit/core/mock";
import type { Codec, Inventory, Unmocked } from "@maple-kit/mock";

const api = createApiFake();
const server = createTestServer(...api.handlers);
useTestServer(server, { afterAll, afterEach, beforeAll });
afterEach(() => api.reset());

const options = {
  codecs: [restCodec],
  forward: (request: Request) => fetch(request),
  route: "/p",
  now: () => 5,
};

function recipe(key: string, state: MockState): Recipe {
  return { version: 2, calls: [{ key, state }] };
}

async function run(
  url: string,
  active?: Recipe,
  inventory: Inventory = createInventory(),
  init?: RequestInit,
) {
  return resolve(new Request(`${API}${url}`, init), active, inventory, options);
}

describe("resolve", () => {
  it("lets a request through when there is no recipe", async () => {
    await expect(run("/projects")).resolves.toBeUndefined();
    expect(api.reached).toEqual([]);
  });

  it.each([
    ["on its own route", "/p", 403],
    ["nowhere else", "/q", undefined],
  ])("applies a recipe that names a route %s", async (_, route, status) => {
    const active = { ...recipe("rest:GET /api/projects", "forbidden"), route: "/p" };
    const response = await resolve(new Request(`${API}/projects`), active, createInventory(), {
      ...options,
      route,
    });
    expect(response?.status).toBe(status);
  });

  it("lets through a call the recipe does not name", async () => {
    await expect(run("/me", recipe("rest:GET /api/projects", "empty"))).resolves.toBeUndefined();
    expect(api.reached).toEqual([]);
  });

  it("reshapes the server's own answer, keeping its headers", async () => {
    const response = await run("/me", recipe("rest:GET /api/me", "empty"));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-trace")).toBe("t1");
    await expect(response?.json()).resolves.toEqual(ME);
    expect(api.reached).toEqual(["GET /api/me"]);
  });

  it.each([
    ["empty", { ...PROJECTS, items: [], total: 0, nextCursor: null, hasMore: false }],
    [
      "one",
      { ...PROJECTS, items: [PROJECTS.items[0]], total: 1, nextCursor: null, hasMore: false },
    ],
  ] as const)("answers %s from the list", async (state, expected) => {
    const response = await run("/projects", recipe("rest:GET /api/projects", state));
    await expect(response?.json()).resolves.toEqual(expected);
  });

  it("answers many", async () => {
    const response = await run("/projects", recipe("rest:GET /api/projects", "many"));
    const body = (await response?.json()) as typeof PROJECTS;
    expect(body.items).toHaveLength(MANY);
  });

  it.each([
    ["long", { total: 1_234_567, nextCursor: "c2" }],
    ["sparse", { total: 2, nextCursor: "c2" }],
    ["mixed", { total: 2, nextCursor: "c2" }],
  ] as const)("answers %s from the server's own envelope", async (state, envelope) => {
    const response = await run("/projects", recipe("rest:GET /api/projects", state));
    const body = (await response?.json()) as typeof PROJECTS;
    expect(body).toMatchObject({ ...envelope, hasMore: true });
    expect(body.items.map((item) => item.id).slice(0, 2)).toEqual([1, 2]);
  });

  it("matches a call by its pattern, not its id", async () => {
    const response = await run("/projects/99", recipe("rest:GET /api/projects/:id", "forbidden"));
    expect(response?.status).toBe(403);
  });

  it.each([
    ["error", 500],
    ["forbidden", 403],
  ] as const)("answers %s without asking the server", async (state, status) => {
    const response = await run("/projects", recipe("rest:GET /api/projects", state));
    expect(response?.status).toBe(status);
    expect(api.reached).toEqual([]);
  });

  it("never sends a mutation it answers with a failure", async () => {
    const response = await run("/projects", recipe("rest:POST /api/projects", "error"), undefined, {
      method: "POST",
      body: "{}",
    });
    expect(response?.status).toBe(500);
    expect(api.reached).toEqual([]);
  });

  it("holds a loading call until the request is abandoned", async () => {
    const controller = new AbortController();
    const pending = resolve(
      new Request(`${API}/projects`, { signal: controller.signal }),
      recipe("rest:GET /api/projects", "loading"),
      createInventory(),
      options,
    );
    const settled = await Promise.race([
      pending.then(() => "settled"),
      wait(30).then(() => "held"),
    ]);
    expect(settled).toBe("held");
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(api.reached).toEqual([]);
  });

  /** Node links a request's signal to the caller's weakly; a collection used to cut it. */
  it("still hears the abort of a held call after a garbage collection", async () => {
    const controller = new AbortController();
    const pending = resolve(
      new Request(`${API}/projects`, { signal: controller.signal }),
      recipe("rest:GET /api/projects", "loading"),
      createInventory(),
      options,
    );
    await wait(30);
    collectGarbage();
    await wait(10);
    controller.abort();

    const outcome = pending.then(
      () => "settled",
      () => "rejected",
    );
    expect(await Promise.race([outcome, wait(500).then(() => "held")])).toBe("rejected");
  });

  it("lets go of a loading call abandoned before it was held", async () => {
    const controller = new AbortController();
    const request = new Request(`${API}/projects`, { signal: controller.signal });
    controller.abort();
    const pending = resolve(
      request,
      recipe("rest:GET /api/projects", "loading"),
      createInventory(),
      options,
    );
    await expect(pending).rejects.toThrow();
    expect(api.reached).toEqual([]);
  });

  it("records the real answer, not the mocked one", async () => {
    const inventory = createInventory();
    await run("/projects", recipe("rest:GET /api/projects", "empty"), inventory);
    expect(inventory.sample("rest:GET /api/projects", "/p")).toEqual({
      key: "rest:GET /api/projects",
      status: 200,
      body: PROJECTS,
      at: 5,
    });
  });

  it("falls back to the recorded answer when the server fails", async () => {
    const inventory = createInventory();
    inventory.record("/p", { key: "rest:GET /api/projects", status: 200, body: PROJECTS, at: 1 });
    api.fail("/api/projects");
    const response = await run("/projects", recipe("rest:GET /api/projects", "one"), inventory);
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ items: [PROJECTS.items[0]], total: 1 });
  });

  it("passes the server's failure on when nothing was recorded", async () => {
    api.fail("/api/projects");
    const response = await run("/projects", recipe("rest:GET /api/projects", "empty"));
    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({ message: "upstream timed out" });
  });

  /** The DoD's case: nothing recorded, the server failing, and the schema enough. */
  it("mocks a call with no sample from its schema alone", async () => {
    api.fail("/api/projects");
    const shape = {
      source: "supplied" as const,
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "object", properties: { id: { type: "integer" } } },
          },
          total: { type: "integer" },
          nextCursor: { type: "string" },
        },
        required: ["items", "total", "nextCursor"],
      },
    };
    const response = await resolve(
      new Request(`${API}/projects`),
      recipe("rest:GET /api/projects", "many"),
      createInventory(),
      { ...options, shape: (key) => (key === "rest:GET /api/projects" ? shape : undefined) },
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { items: { id: number }[]; nextCursor: string };
    expect(body.items).toHaveLength(MANY);
    expect(new Set(body.items.map((item) => item.id)).size).toBe(MANY);
    expect(body.nextCursor).toBe("text");
  });

  it("asks for no shape for a call it does not reshape", async () => {
    const asked: string[] = [];
    await resolve(
      new Request(`${API}/projects`),
      recipe("rest:GET /api/projects", "error"),
      createInventory(),
      {
        ...options,
        shape: (key) => {
          asked.push(key);
          return undefined;
        },
      },
    );
    expect(asked).toEqual([]);
  });

  it("returns a response it cannot read untouched", async () => {
    const response = await run("/page", recipe("rest:GET /api/page", "empty"));
    await expect(response?.text()).resolves.toBe("<p>hi</p>");
  });

  it.each<[string, string, () => void, Pick<Unmocked, "reason" | "status">]>([
    ["a response it cannot read", "/page", () => undefined, { reason: "unreadable", status: 200 }],
    [
      "a failure it has nothing to reshape",
      "/projects",
      () => api.fail("/api/projects"),
      { reason: "nothing to reshape", status: 500 },
    ],
  ])("says why a named call kept the server's answer: %s", async (_, path, before, told) => {
    before();
    const unmocked: Unmocked[] = [];
    const key = `rest:GET /api${path}`;
    await resolve(new Request(`${API}${path}`), recipe(key, "empty"), createInventory(), {
      ...options,
      onUnmocked: (note) => unmocked.push(note),
    });
    expect(unmocked).toEqual([{ codec: "rest", key, ...told }]);
  });

  it.each([
    ["a reshape", recipe("rest:GET /api/projects", "empty")],
    ["a failure it writes", recipe("rest:GET /api/projects", "error")],
    ["a call the recipe does not name", recipe("rest:GET /api/me", "empty")],
    ["no recipe", undefined],
  ])("says nothing of %s", async (_, active) => {
    const unmocked: Unmocked[] = [];
    await resolve(new Request(`${API}/projects`), active, createInventory(), {
      ...options,
      onUnmocked: (note) => unmocked.push(note),
    });
    expect(unmocked).toEqual([]);
  });

  it("reshapes a bare count", async () => {
    const response = await run("/count", recipe("rest:GET /api/count", "empty"));
    await expect(response?.json()).resolves.toBe(0);
  });
});

/** A full collection, from a test run without `--expose-gc`. */
function collectGarbage(): void {
  setFlagsFromString("--expose-gc");
  (runInNewContext("gc") as () => void)();
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

describe("resolve, under `as`", () => {
  const shownAs = (as: Recipe["as"], calls: Recipe["calls"] = []): Recipe => ({
    version: 2,
    calls,
    ...(as === undefined ? {} : { as }),
  });

  async function under(active: Recipe, url: string, init?: RequestInit) {
    const inventory = createInventory();
    const writes: string[] = [];
    await resolve(new Request(`${API}/session`), undefined, inventory, options).then(() =>
      inventory.record("/p", { key: "rest:GET /api/session", status: 200, body: SESSION, at: 1 }),
    );
    api.reset();
    const response = await resolve(new Request(`${API}${url}`, init), active, inventory, {
      ...options,
      identity: RULES,
      onWrite: (key) => writes.push(key),
    });
    return { response, writes };
  }

  it("tells the page the role and permissions the recipe names", async () => {
    const { response } = await under(
      shownAs({ role: "barista", permissions: { "billing:write": false } }),
      "/session",
    );
    await expect(response?.json()).resolves.toEqual({
      user: { name: "Reviewer", role: "barista" },
      permissions: ["project:delete"],
    });
    expect(api.reached).toEqual(["GET /api/session"]);
  });

  it("answers the page's own 403 for a call the shown role may not make, without asking", async () => {
    const { response } = await under(shownAs({ role: "guest" }), "/audit");
    expect(response?.status).toBe(403);
    expect(api.reached).toEqual([]);
  });

  it("lets a call through when the shown identity meets its need", async () => {
    const { response } = await under(shownAs({ role: "owner" }), "/audit");
    expect(response).toBeUndefined();
  });

  it("puts a call the recipe names in its named state, whatever it requires", async () => {
    const { response } = await under(
      shownAs({ role: "guest" }, [{ key: "rest:GET /api/audit", state: "empty" }]),
      "/audit",
    );
    expect(response?.status).toBe(200);
  });

  it("refuses a write the shown identity may not make, and never sends it", async () => {
    const { response, writes } = await under(
      shownAs({ permissions: { "project:delete": false } }),
      "/projects/1",
      { method: "DELETE" },
    );
    expect(response?.status).toBe(403);
    expect(api.reached).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("lets through a write it allows, and says the server acts as the reviewer", async () => {
    const { response, writes } = await under(shownAs({ role: "barista" }), "/projects", {
      method: "POST",
      body: "{}",
    });
    expect(response).toBeUndefined();
    expect(writes).toEqual(["rest:POST /api/projects"]);
  });

  it.each([
    ["reads", "POST", false, []],
    ["writes", "GET", true, ["rest:GET /api/projects"]],
  ] as const)(
    "believes a call that says it %s over the method",
    async (_, method, mutates, expected) => {
      const said: Codec = {
        ...restCodec,
        split: async (request) =>
          (await restCodec.split(request))?.map((call) => ({ ...call, mutates })),
      };
      const writes: string[] = [];
      const init = method === "POST" ? { method, body: "{}" } : { method };
      const response = await resolve(
        new Request(`${API}/projects`, init),
        shownAs({ role: "barista" }),
        createInventory(),
        { ...options, codecs: [said], identity: RULES, onWrite: (key) => writes.push(key) },
      );
      expect(response).toBeUndefined();
      expect(writes).toEqual(expected);
    },
  );

  it("changes nothing without identity rules", async () => {
    const response = await resolve(
      new Request(`${API}/audit`),
      shownAs({ role: "guest" }),
      createInventory(),
      options,
    );
    expect(response).toBeUndefined();
  });
});
