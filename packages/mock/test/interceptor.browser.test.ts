import { createClient } from "@launchdarkly/js-client-sdk";
import { createLogger, memorySink } from "@maple-kit/core/logger";
import { linkRecipe, readRecipeCookie, RECIPE_COOKIE } from "@maple-kit/core/mock";
import { installMock, pathPattern, RECIPE_STORAGE_KEY, seenFlags } from "@maple-kit/mock";
import { launchDarklyFlags } from "@maple-kit/mock/launchdarkly";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { API, createApiFake, ME, PROJECTS, SESSION } from "./msw/api.js";
import { handlerFetch } from "./msw/fetch.js";
import { API_GRAPHQL, createGraphqlFake, GRAPHQL, QUERIES } from "./msw/graphql.js";
import { RULES } from "./msw/identity.js";
import { createLaunchDarklyFake, LD_BASE, LD_ENV } from "./msw/launchdarkly.js";

import type { MockState, Recipe } from "@maple-kit/core/mock";
import type { MockHandle } from "@maple-kit/mock";

const api = createApiFake();
const graphql = createGraphqlFake();
const nativeFetch = globalThis.fetch;
const page = location.href;
let handle: MockHandle | undefined;

function recipe(...calls: [string, MockState][]): Recipe {
  return { version: 2, calls: calls.map(([key, state]) => ({ key, state })) };
}

/** Opens this page as a shared link would, then installs the interceptor. */
function install(active?: Recipe, options: Parameters<typeof installMock>[0] = {}): MockHandle {
  history.replaceState(null, "", linkRecipe(page, active));
  handle = installMock({ fetch: globalThis.fetch, ...options });
  return handle;
}

function xhr(method: string, url: string): Promise<XMLHttpRequest> {
  return new Promise((done, fail) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.addEventListener("loadend", () => done(request));
    request.addEventListener("error", () => fail(new Error("xhr failed")));
    request.send();
  });
}

beforeEach(() => {
  globalThis.fetch = handlerFetch([...api.handlers, ...graphql.handlers]);
  sessionStorage.clear();
});

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  globalThis.fetch = nativeFetch;
  history.replaceState(null, "", page);
  document.cookie = `${RECIPE_COOKIE}=; Max-Age=0; Path=/`;
  api.reset();
  graphql.reset();
});

describe("installMock, in a real browser", () => {
  it("answers fetch with the linked state and lets every other call through", async () => {
    install(recipe(["rest:GET /api/projects", "empty"]));

    const projects = (await (await fetch(`${API}/projects`)).json()) as typeof PROJECTS;
    const me: unknown = await (await fetch(`${API}/me`)).json();

    expect(projects.items).toEqual([]);
    expect(projects.total).toBe(0);
    expect(me).toEqual(ME);
    expect(api.reached).toEqual(["GET /api/projects", "GET /api/me"]);
  });

  it("answers XMLHttpRequest the same way", async () => {
    install(recipe(["rest:GET /api/projects", "one"], ["rest:GET /api/me", "forbidden"]));

    const projects = await xhr("GET", `${API}/projects`);
    const me = await xhr("GET", `${API}/me`);

    expect(JSON.parse(projects.responseText)).toMatchObject({ items: [PROJECTS.items[0]] });
    expect(me.status).toBe(403);
    expect(api.reached).toEqual(["GET /api/projects"]);
  });

  it("reads GraphQL at both of its endpoints before REST, by default", async () => {
    install(recipe(["graphql:Projects", "empty"], ["rest:GET /api/projects", "one"]));
    const query = (url: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: QUERIES.projects }),
      });

    const empty = { data: { projects: { items: [], total: 0 } } };
    await expect((await query(GRAPHQL)).json()).resolves.toEqual(empty);
    await expect((await query(API_GRAPHQL)).json()).resolves.toEqual(empty);
    const projects: unknown = await (await fetch(`${API}/projects`)).json();

    expect(projects).toMatchObject({ items: [PROJECTS.items[0]] });
    expect(graphql.reached).toEqual(["POST projects", "POST projects"]);
  });

  it("says at debug why a named call kept the server's answer", async () => {
    const sink = memorySink();
    install(recipe(["rest:GET /api/page", "empty"]), {
      logger: createLogger({ sinks: [sink], level: "debug" }),
    });
    await (await fetch(`${API}/page`)).text();

    expect(sink.records.map(({ level, message, fields }) => ({ level, message, fields }))).toEqual([
      {
        level: "debug",
        message: "A call went through unmocked: its codec could not read the response.",
        fields: {
          codec: "rest",
          key: "rest:GET /api/page",
          reason: "unreadable",
          status: 200,
          path: "/api/page",
        },
      },
    ]);
  });

  it.each([
    ["long", (items: { name: string }[]) => items.every((item) => item.name.length >= 32)],
    ["sparse", (items: { name: string }[]) => items.length === PROJECTS.items.length],
    ["mixed", (items: { name: string }[]) => items.some((item) => item.name.length >= 32)],
  ] as const)("answers %s from the server's own list", async (state, holds) => {
    install(recipe(["rest:GET /api/projects", state]));
    const projects = (await (await fetch(`${API}/projects`)).json()) as typeof PROJECTS;
    expect(holds(projects.items)).toBe(true);
    expect(new Set(projects.items.map((item) => item.id)).size).toBe(projects.items.length);
    expect(api.reached).toEqual(["GET /api/projects"]);
  });

  it("keeps a linked recipe for the tab", () => {
    const active = recipe(["rest:GET /api/projects", "empty"]);
    install(active);
    expect(JSON.parse(sessionStorage.getItem(RECIPE_STORAGE_KEY) ?? "null")).toEqual(active);
  });

  it("records what the page fetched, per route, and nothing it mocked", async () => {
    const { inventory } = install(recipe(["rest:GET /api/projects", "empty"]));
    await fetch(`${API}/me`);
    await fetch(`${API}/projects`);

    const keys = () => inventory.calls(pathPattern(location.pathname)).map((sample) => sample.key);
    await expect
      .poll(() => keys().toSorted((left, right) => left.localeCompare(right)))
      .toEqual(["rest:GET /api/me", "rest:GET /api/projects"]);
    expect(
      inventory.sample("rest:GET /api/projects", pathPattern(location.pathname))?.body,
    ).toEqual(PROJECTS);
  });

  it("drops a recipe it cannot read, says so, and mocks nothing", async () => {
    sessionStorage.setItem(RECIPE_STORAGE_KEY, "{");
    const sink = memorySink();
    install(undefined, { logger: createLogger({ sinks: [sink] }) });

    expect(handle?.recipe).toBeUndefined();
    expect(sessionStorage.getItem(RECIPE_STORAGE_KEY)).toBeNull();
    expect(sink.records.map((line) => line.message)).toEqual([
      "Ignoring a mock recipe that could not be read.",
    ]);
    expect(await (await fetch(`${API}/projects`)).json()).toEqual(PROJECTS);
  });

  it("neither mocks nor records a request it is told to ignore", async () => {
    const { inventory } = install(recipe(["rest:GET /api/projects", "error"]), {
      ignore: (url) => url.pathname === "/api/projects",
    });
    const response = await fetch(`${API}/projects`);
    expect(response.status).toBe(200);
    expect(inventory.calls(pathPattern(location.pathname))).toEqual([]);
  });

  it("lets the page cancel an endless stream it does not read", async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode(`data: ${String(pulled)}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = { "content-type": "text/event-stream" };
    globalThis.fetch = () => Promise.resolve(new Response(endless, { headers }));
    install(recipe(["rest:GET /api/projects", "empty"]));

    const reader = (await fetch(`${API}/events`)).body?.getReader();
    for (let chunk = 0; chunk < 3; chunk++) await reader?.read();
    await reader?.cancel();

    // The page's cancel settles only once every copy of the stream is cancelled.
    expect(cancelled).toBe(true);
  });

  it("installs once, and restores fetch when disposed", () => {
    const stub = globalThis.fetch;
    const first = install();
    expect(installMock()).toBe(first);
    expect(globalThis.fetch).not.toBe(stub);
    first.dispose();
    handle = undefined;
    expect(globalThis.fetch).toBe(stub);
  });
});

describe("the cookie a server reads the recipe from", () => {
  const layered: Recipe = {
    ...recipe(["rest:GET /api/projects", "empty"]),
    flags: { roaster: true },
  };

  it("keeps a linked recipe's flags and identity, and none of its calls", () => {
    install({ ...layered, as: { role: "barista" } });
    expect(readRecipeCookie(document.cookie)).toEqual({
      version: 2,
      calls: [],
      flags: { roaster: true },
      as: { role: "barista" },
    });
  });

  it("clears it when the recipe has no layer a server evaluates", () => {
    document.cookie = `${RECIPE_COOKIE}=stale; Path=/`;
    install(recipe(["rest:GET /api/projects", "empty"]));
    expect(document.cookie).not.toContain(`${RECIPE_COOKIE}=`);
  });

  it("clears it with no mock on, and when the recipe cannot be read", () => {
    document.cookie = `${RECIPE_COOKIE}=stale; Path=/`;
    install();
    expect(document.cookie).not.toContain(`${RECIPE_COOKIE}=`);

    handle?.dispose();
    document.cookie = `${RECIPE_COOKIE}=stale; Path=/`;
    sessionStorage.setItem(RECIPE_STORAGE_KEY, "{");
    install();
    expect(document.cookie).not.toContain(`${RECIPE_COOKIE}=`);
  });

  it("says so when the layers are too long for a cookie, and still mocks the page", async () => {
    const flags = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`f${i}`, "x".repeat(20)]),
    );
    const sink = memorySink();
    install({ ...layered, flags }, { logger: createLogger({ sinks: [sink] }) });

    expect(document.cookie).not.toContain(`${RECIPE_COOKIE}=`);
    expect(sink.records.map((line) => line.message)).toContain(
      "The mock's flags and identity are too long for a cookie; the server sees none.",
    );
    expect(((await (await fetch(`${API}/projects`)).json()) as typeof PROJECTS).items).toEqual([]);
  });
});

describe("the recipe a comment records", () => {
  it("is the recipe when it applies on this route, and nothing on another", () => {
    const here = pathPattern(location.pathname);
    const scoped = { ...recipe(["rest:GET /api/me", "empty"]), route: here };
    expect(install(scoped).current?.()).toEqual(scoped);
    handle?.dispose();

    const elsewhere = { ...recipe(["rest:GET /api/me", "empty"]), route: "/somewhere-else" };
    expect(install(elsewhere).current?.()).toBeUndefined();
    handle?.dispose();

    const everywhere = recipe(["rest:GET /api/me", "empty"]);
    expect(install(everywhere).current?.()).toEqual(everywhere);
  });

  it("is nothing with no mock on", () => {
    expect(install().current?.()).toBeUndefined();
  });

  it("offers the host's identity rules to the box without an `as`, reading the route once", async () => {
    let asked = 0;
    const routeFetch: typeof fetch = (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/mock/identity")) asked += 1;
      return Promise.resolve(Response.json({ identity: RULES }));
    };
    const mocked = install(undefined, { route: "/api/maple", fetch: routeFetch });

    expect(await mocked.identity?.()).toEqual(RULES);
    expect(await mocked.identity?.()).toEqual(RULES);
    expect(asked).toBe(1);
  });

  it("offers no identity where the page names neither rules nor a route", () => {
    expect(install().identity).toBeUndefined();
  });

  it("shows the page who the recipe says, refuses what that identity may not do, and says when a write reaches the server", async () => {
    const sink = memorySink();
    sessionStorage.setItem(
      "maple-mock-inventory",
      JSON.stringify([
        [pathPattern(location.pathname), [{ key: RULES.call, status: 200, body: SESSION, at: 1 }]],
      ]),
    );
    const mocked = install(
      { version: 2, calls: [], as: { role: "guest", permissions: { "project:delete": false } } },
      { identity: RULES, logger: createLogger({ sinks: [sink] }) },
    );

    const session = (await (await fetch(`${API}/session`)).json()) as typeof SESSION;
    const audit = await fetch(`${API}/audit`);
    const remove = await fetch(`${API}/projects/1`, { method: "DELETE" });
    const create = await fetch(`${API}/projects`, { method: "POST", body: "{}" });

    expect(session).toEqual({
      user: { ...SESSION.user, role: "guest" },
      permissions: ["billing:write"],
    });
    expect([audit.status, remove.status, create.status]).toEqual([403, 403, 201]);
    expect(api.reached).toEqual(["GET /api/session", "POST /api/projects"]);
    expect(mocked.writes?.list()).toEqual(["rest:POST /api/projects"]);
    expect(sink.records.map((record) => record.message)).toContain(
      "A write reached the server, which acts as you, not as the page shows.",
    );
  });
});

/**
 * The client, as far as these tests use it. The SDK's own declarations import
 * extensionless ESM paths, which `nodenext` does not resolve.
 */
interface FlagClient {
  start(): Promise<{ status: string }>;
  variation(key: string, fallback: unknown): unknown;
  close(): Promise<void>;
}

describe("installMock with LaunchDarkly's own browser SDK", () => {
  const ld = createLaunchDarklyFake();
  const endpoints = { baseUri: LD_BASE, streamUri: LD_BASE, eventsUri: LD_BASE };
  const named: Recipe = { version: 2, calls: [], flags: { "new-roaster": true } };

  beforeEach(() => {
    globalThis.fetch = handlerFetch([...api.handlers, ...ld.handlers]);
  });
  afterEach(() => ld.reset());

  async function started(): Promise<{ client: FlagClient; status: string }> {
    const client = createClient(
      LD_ENV,
      { kind: "user", key: "reviewer" },
      {
        ...endpoints,
        fetchGoals: false,
        sendEvents: false,
        disableCache: true,
        streaming: false,
      },
    ) as unknown as FlagClient;
    const { status } = await client.start();
    return { client, status };
  }

  it("answers the flags the recipe names, and records every flag's real value", async () => {
    install(named, { flags: [launchDarklyFlags(endpoints)] });
    const { client } = await started();

    expect(client.variation("new-roaster", false)).toBe(true);
    expect(client.variation("roast-limit", 0)).toBe(3);
    expect(seenFlags().list()).toEqual(
      expect.arrayContaining([
        { key: "new-roaster", type: "boolean", value: false },
        { key: "roast-limit", type: "number", value: 3 },
      ]),
    );
    await client.close();
  });

  it("lets the SDK's own answer through without a recipe", async () => {
    install(undefined, { flags: [launchDarklyFlags(endpoints)] });
    const { client } = await started();
    expect(client.variation("new-roaster", true)).toBe(false);
    await client.close();
  });

  it("lets a failed poll through as it came", async () => {
    ld.fail();
    install(named, { flags: [launchDarklyFlags(endpoints)] });
    const { client, status } = await started();
    expect(status).not.toBe("complete");
    expect(client.variation("new-roaster", false)).toBe(false);
    await client.close();
  });
});
