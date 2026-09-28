import { createInventory, graphqlCodec, resolve, restCodec, trpcCodec } from "@maple-kit/mock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createGraphqlFake,
  GRAPHQL,
  GRAPHQL_RESPONSE,
  ME,
  MISMATCH,
  NOT_FOUND,
  ORIGIN,
  PROJECTS,
  PROJECTS_HASH,
  QUERIES,
} from "./msw/graphql.js";
import { RULES } from "./msw/identity.js";
import { createTestServer, useTestServer } from "./msw/server.js";

import type { MockState, Recipe } from "@maple-kit/core/mock";
import type { Answer, Inventory, Unmocked } from "@maple-kit/mock";

const fake = createGraphqlFake();
const server = createTestServer(...fake.handlers);
useTestServer(server, { afterAll, afterEach, beforeAll });
afterEach(() => fake.reset());

const codec = graphqlCodec();
const options = {
  codecs: [codec, restCodec],
  forward: (request: Request) => fetch(request),
  route: "/p",
  now: () => 5,
};

const APQ = { persistedQuery: { version: 1, sha256Hash: PROJECTS_HASH } };
const JSON_TYPE = { "content-type": "application/json" };
const EMPTY = { projects: { items: [], total: 0 } };
const FAILED = {
  data: null,
  errors: [{ message: "boom", path: ["projects"], extensions: { code: "INTERNAL_SERVER_ERROR" } }],
};

function post(body: unknown, headers: Record<string, string> = {}, url = GRAPHQL): Request {
  const init = {
    method: "POST",
    headers: { ...JSON_TYPE, ...headers },
    body: JSON.stringify(body),
  };
  return new Request(url, init);
}

function get(params: Record<string, string>): Request {
  return new Request(`${GRAPHQL}?${new URLSearchParams(params).toString()}`);
}

function recipe(key: string, state: MockState): Recipe {
  return { version: 2, calls: [{ key, state }] };
}

function run(request: Request, active?: Recipe, inventory: Inventory = createInventory()) {
  return resolve(request, active, inventory, options);
}

describe("graphqlCodec.split", () => {
  it.each([
    [
      "a named query",
      post({ query: QUERIES.projects, operationName: "Projects", variables: { first: 1 } }),
      { key: "graphql:Projects", mutates: false },
    ],
    [
      "a mutation",
      post({ query: QUERIES.create, variables: { name: "x" } }),
      { key: "graphql:CreateProject", mutates: true },
    ],
    [
      "the shorthand, by its hash",
      post({ query: QUERIES.me }),
      { key: "graphql:4b04480d", mutates: false },
    ],
    [
      "a GET",
      get({ query: QUERIES.projects, variables: "{}" }),
      { key: "graphql:Projects", mutates: false },
    ],
    [
      "APQ with a name, before the text is sent",
      post({ operationName: "Projects", extensions: APQ }),
      { key: "graphql:Projects" },
    ],
    [
      "APQ over GET",
      get({ operationName: "Projects", extensions: JSON.stringify(APQ) }),
      { key: "graphql:Projects" },
    ],
    ["a persisted id alone", post({ documentId: "abc123" }), { key: "graphql:abc123" }],
    [
      "a persisted hash alone",
      get({ extensions: JSON.stringify(APQ) }),
      { key: `graphql:${PROJECTS_HASH}` },
    ],
    [
      "the endpoint with a slash",
      post({ query: QUERIES.me }, {}, `${GRAPHQL}/`),
      { key: "graphql:4b04480d", mutates: false },
    ],
  ])("splits %s", async (_, request, call) => {
    await expect(codec.split(request)).resolves.toEqual([call]);
  });

  it("names a persisted request by its operation through the manifest", async () => {
    const manifest = { [PROJECTS_HASH]: QUERIES.projects, m1: QUERIES.create };
    const named = graphqlCodec({ manifest });
    await expect(named.split(post({ extensions: APQ }))).resolves.toEqual([
      { key: "graphql:Projects", mutates: false },
    ]);
    await expect(named.split(post({ documentId: "m1" }))).resolves.toEqual([
      { key: "graphql:CreateProject", mutates: true },
    ]);
    await expect(named.split(post({ documentId: "m2" }))).resolves.toEqual([{ key: "graphql:m2" }]);
  });

  it.each([
    [undefined, "/graphql", true],
    [undefined, "/api/graphql", true],
    ["/v1/gql/", "/v1/gql", true],
    ["/v1/gql", "/graphql", false],
    [["/graphql", "/v1/gql"], "/v1/gql", true],
  ] as const)("mounted at %j, finds a request to %s: %s", async (endpoint, path, found) => {
    const mounted = graphqlCodec(endpoint === undefined ? {} : { endpoint });
    const calls = await mounted.split(post({ query: QUERIES.me }, {}, `${ORIGIN}${path}`));
    expect(calls !== undefined).toBe(found);
  });

  it.each([
    ["another path", post({ query: QUERIES.me }, {}, `${ORIGIN}/api/projects`)],
    ["a path under the endpoint", post({ query: QUERIES.me }, {}, `${GRAPHQL}/schema`)],
  ])("does not claim %s", async (_, request) => {
    await expect(codec.split(request)).resolves.toBeUndefined();
  });

  it.each([
    ["a batch", post([{ query: QUERIES.me }, { query: QUERIES.projects }])],
    [
      "a body that is not JSON",
      new Request(GRAPHQL, { method: "POST", headers: JSON_TYPE, body: "{" }),
    ],
    [
      "a form body",
      new Request(GRAPHQL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "query=%7Bme%7D",
      }),
    ],
    ["a PUT", new Request(GRAPHQL, { method: "PUT", headers: JSON_TYPE, body: "{}" })],
    ["a GET that names nothing", new Request(GRAPHQL)],
    ["a body that names nothing", post({ variables: {} })],
    ["extensions that are not an object", get({ extensions: "[]" })],
  ])("owns %s at its endpoint, with no call in it", async (_, request) => {
    await expect(codec.split(request)).resolves.toEqual([]);
  });
});

describe("graphqlCodec.read", () => {
  const typed = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": GRAPHQL_RESPONSE } });

  it.each([
    ["data", Response.json({ data: ME }), { kind: "data", status: 200, body: ME }],
    [
      "data beside errors as partial",
      Response.json({ data: { me: null }, errors: [{ message: "x" }] }),
      { kind: "data", status: 200, body: { me: null }, partial: true },
    ],
    [
      "data in the GraphQL response type",
      typed({ data: ME }),
      { kind: "data", status: 200, body: ME },
    ],
    [
      "an execution error at 200 as a 500",
      Response.json(FAILED),
      { kind: "data", status: 500, body: FAILED },
    ],
    [
      "a persisted-query miss at 200 as a 500",
      Response.json(NOT_FOUND),
      { kind: "data", status: 500, body: NOT_FOUND },
    ],
    [
      "a request error at its own status",
      typed({ errors: [{ message: "x" }] }, 400),
      { kind: "data", status: 400, body: { errors: [{ message: "x" }] } },
    ],
  ])("reads %s", async (_, response, answer) => {
    await expect(codec.read(response, [])).resolves.toEqual([answer]);
  });

  it.each([
    ["HTML", new Response("<p>", { headers: { "content-type": "text/html" } })],
    ["broken JSON", new Response("{", { headers: JSON_TYPE })],
    ["a JSON array", Response.json([{ data: ME }])],
    ["a JSON string", Response.json("x")],
  ])("does not read %s", async (_, response) => {
    await expect(codec.read(response, [])).resolves.toBeUndefined();
  });
});

describe("graphqlCodec.join", () => {
  it.each([
    ["error", "Internal Server Error", "INTERNAL_SERVER_ERROR"],
    ["forbidden", "Forbidden", "FORBIDDEN"],
  ] as const)("writes a %s as a GraphQL error at 200", async (state, message, code) => {
    const response = codec.join([], [{ kind: "failure", state }]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      data: null,
      errors: [{ message, extensions: { code } }],
    });
  });

  it("puts data back in its envelope", async () => {
    const response = codec.join([], [{ kind: "data", status: 200, body: ME }]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: ME });
  });

  it("writes an error the server answered as it came, at the server's status", async () => {
    const errors = [{ message: "x" }];
    const real = Response.json({ errors }, { status: 400 });
    const answer: Answer = { kind: "data", status: 400, body: { errors } };
    const response = codec.join([], [answer], real);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ errors });
  });

  it("keeps the server's content type and headers, less the ones a new body invalidates", () => {
    const real = new Response("x", {
      headers: {
        "content-type": `${GRAPHQL_RESPONSE}; charset=utf-8`,
        "x-trace": "t1",
        "content-length": "1",
        "content-encoding": "gzip",
      },
    });
    const response = codec.join([], [{ kind: "data", status: 200, body: ME }], real);
    expect(response.headers.get("content-type")).toBe(GRAPHQL_RESPONSE);
    expect(response.headers.get("x-trace")).toBe("t1");
    expect(response.headers.get("content-encoding")).toBeNull();
  });
});

describe("graphqlCodec against a GraphQL server", () => {
  it("lets through an operation the recipe does not name", async () => {
    const response = await run(post({ query: QUERIES.me }), recipe("graphql:Projects", "empty"));
    expect(response).toBeUndefined();
    expect(fake.reached).toEqual([]);
  });

  it.each([
    ["empty", EMPTY],
    ["one", { projects: { items: [PROJECTS.projects.items[0]], total: 1 } }],
  ] as const)("reshapes the data the page's own operation fetched into %s", async (state, data) => {
    const request = post({ query: QUERIES.projects, operationName: "Projects" });
    const response = await run(request, recipe("graphql:Projects", state));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-trace")).toBe("t1");
    await expect(response?.json()).resolves.toEqual({ data });
    expect(fake.reached).toEqual(["POST projects"]);
  });

  it("reshapes a GET the same way", async () => {
    const response = await run(
      get({ query: QUERIES.projects }),
      recipe("graphql:Projects", "empty"),
    );
    await expect(response?.json()).resolves.toEqual({ data: EMPTY });
    expect(fake.reached).toEqual(["GET projects"]);
  });

  it.each([
    ["error", "INTERNAL_SERVER_ERROR"],
    ["forbidden", "FORBIDDEN"],
  ] as const)("answers %s without asking the server", async (state, code) => {
    const request = post({ query: QUERIES.create, variables: { name: "x" } });
    const response = await run(request, recipe("graphql:CreateProject", state));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      data: null,
      errors: [{ extensions: { code } }],
    });
    expect(fake.reached).toEqual([]);
  });

  it("answers a failure nothing was fetched for as JSON, whatever the page accepts", async () => {
    const accept = { accept: `${GRAPHQL_RESPONSE}, application/json;q=0.9` };
    const request = post({ query: QUERIES.create, variables: { name: "x" } }, accept);
    const response = await run(request, recipe("graphql:CreateProject", "error"));
    expect(response?.headers.get("content-type")).toBe("application/json");
  });

  it("answers in the type the page asked for", async () => {
    const accept = { accept: `${GRAPHQL_RESPONSE}, application/json;q=0.9` };
    const request = post({ query: QUERIES.projects }, accept);
    const response = await run(request, recipe("graphql:Projects", "empty"));
    expect(response?.headers.get("content-type")).toBe(GRAPHQL_RESPONSE);
    await expect(response?.json()).resolves.toEqual({ data: EMPTY });
  });

  it("never records a response without data, and sends it back as it came", async () => {
    fake.fail("projects");
    const inventory = createInventory();
    const request = post({ query: QUERIES.projects });
    const response = await run(request, recipe("graphql:Projects", "empty"), inventory);
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual(FAILED);
    expect(inventory.sample("graphql:Projects", "/p")).toBeUndefined();
  });

  it("sends a request error back at the server's own status", async () => {
    const request = post({ query: "{ nothing { id } }" });
    const [call] = (await codec.split(request.clone())) ?? [];
    const response = await run(request, recipe(call?.key ?? "", "empty"));
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      errors: [
        {
          message: 'Cannot query field "nothing" on type "Query".',
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    });
  });

  it("reshapes a partial result, but keeps the last whole one as the sample", async () => {
    const inventory = createInventory();
    await run(post({ query: QUERIES.projects }), recipe("graphql:Projects", "one"), inventory);
    fake.failPartly("projects");
    const request = post({ query: QUERIES.projects });
    const response = await run(request, recipe("graphql:Projects", "empty"), inventory);
    await expect(response?.json()).resolves.toEqual({ data: { projects: null } });
    expect(inventory.sample("graphql:Projects", "/p")?.body).toEqual(PROJECTS);
  });

  it("reshapes the last recorded answer when the server fails", async () => {
    const inventory = createInventory();
    await run(post({ query: QUERIES.projects }), recipe("graphql:Projects", "one"), inventory);
    fake.fail("projects");
    const request = post({ query: QUERIES.projects });
    const response = await run(request, recipe("graphql:Projects", "empty"), inventory);
    await expect(response?.json()).resolves.toEqual({ data: EMPTY });
    expect(fake.reached).toEqual(["POST projects", "POST projects"]);
  });

  it.each([
    ["a batch", post([{ query: QUERIES.me }, { query: QUERIES.projects }])],
    [
      "a body that is not JSON",
      new Request(GRAPHQL, { method: "POST", headers: JSON_TYPE, body: "{" }),
    ],
  ])("passes %s through untouched, never as a REST call, and says so", async (_, request) => {
    const writes: string[] = [];
    const unmocked: Unmocked[] = [];
    const active: Recipe = {
      version: 2,
      calls: [{ key: "rest:POST /graphql", state: "empty" }],
      as: { role: "barista" },
    };
    const response = await resolve(request, active, createInventory(), {
      ...options,
      codecs: [trpcCodec(), graphqlCodec(), restCodec],
      identity: RULES,
      onWrite: (key) => writes.push(key),
      onUnmocked: (note) => unmocked.push(note),
    });
    expect(response).toBeUndefined();
    expect(writes).toEqual([]);
    expect(unmocked).toEqual([{ codec: "graphql", reason: "no call" }]);
    expect(fake.reached).toEqual([]);
  });

  it("says nothing of a request it cannot name when no recipe applies", async () => {
    const unmocked: Unmocked[] = [];
    await resolve(post([{ query: QUERIES.me }]), undefined, createInventory(), {
      ...options,
      onUnmocked: (note) => unmocked.push(note),
    });
    expect(unmocked).toEqual([]);
  });

  it.each([
    ["a mutation", QUERIES.create, ["graphql:CreateProject"]],
    ["a query, POST though it is", QUERIES.projects, []],
  ])("reports %s under `as` by what it is, not by the method", async (_, query, expected) => {
    const writes: string[] = [];
    const active: Recipe = { version: 2, calls: [], as: { role: "barista" } };
    const response = await resolve(post({ query }), active, createInventory(), {
      ...options,
      identity: RULES,
      onWrite: (key) => writes.push(key),
    });
    expect(response).toBeUndefined();
    expect(writes).toEqual(expected);
  });

  it.each([
    ["without a manifest, as a write, by its method", graphqlCodec(), [`graphql:${PROJECTS_HASH}`]],
    [
      "with one, as the query it is",
      graphqlCodec({ manifest: { [PROJECTS_HASH]: QUERIES.projects } }),
      [],
    ],
  ])("reports a persisted query sent by POST under `as` %s", async (_, persisted, expected) => {
    const writes: string[] = [];
    const active: Recipe = { version: 2, calls: [], as: { role: "barista" } };
    await resolve(post({ extensions: APQ }), active, createInventory(), {
      ...options,
      codecs: [persisted, restCodec],
      identity: RULES,
      onWrite: (key) => writes.push(key),
    });
    expect(writes).toEqual(expected);
  });

  describe("under APQ", () => {
    const miss = () => post({ operationName: "Projects", extensions: APQ });
    const retry = () =>
      post({ operationName: "Projects", query: QUERIES.projects, extensions: APQ });

    it("lets the miss through so the page retries, then reshapes the retry", async () => {
      const inventory = createInventory();
      const unmocked: Unmocked[] = [];
      const told = { ...options, onUnmocked: (note: Unmocked) => unmocked.push(note) };
      const active = recipe("graphql:Projects", "empty");
      const first = await resolve(miss(), active, inventory, told);
      expect(first?.status).toBe(200);
      await expect(first?.json()).resolves.toEqual(NOT_FOUND);
      expect(inventory.sample("graphql:Projects", "/p")).toBeUndefined();
      const second = await resolve(retry(), active, inventory, told);
      await expect(second?.json()).resolves.toEqual({ data: EMPTY });
      expect(fake.reached).toEqual([`POST #${PROJECTS_HASH}`, "POST projects"]);
      expect(unmocked).toEqual([
        { codec: "graphql", key: "graphql:Projects", reason: "nothing to reshape", status: 200 },
      ]);
    });

    it("answers a miss from the recorded sample, and the page never retries", async () => {
      const inventory = createInventory();
      const active = recipe("graphql:Projects", "empty");
      await run(retry(), active, inventory);
      fake.reset();
      const response = await run(miss(), active, inventory);
      await expect(response?.json()).resolves.toEqual({ data: EMPTY });
      expect(fake.reached).toEqual([`POST #${PROJECTS_HASH}`]);
    });

    it("sends a hash that is not its text's back as the server refused it", async () => {
      const request = post({ operationName: "Projects", query: QUERIES.me, extensions: APQ });
      const response = await run(request, recipe("graphql:Projects", "empty"));
      expect(response?.status).toBe(400);
      await expect(response?.json()).resolves.toEqual(MISMATCH);
      expect(fake.reached).toEqual([`POST #${PROJECTS_HASH}`]);
    });

    it("names a persisted document through the manifest, text or no text", async () => {
      const manifest = { [PROJECTS_HASH]: QUERIES.projects };
      const knowing = createGraphqlFake(manifest);
      server.use(...knowing.handlers);
      const named = { ...options, codecs: [graphqlCodec({ manifest }), restCodec] };
      const active = recipe("graphql:Projects", "empty");
      const response = await resolve(post({ extensions: APQ }), active, createInventory(), named);
      await expect(response?.json()).resolves.toEqual({ data: EMPTY });
      expect(knowing.reached).toEqual(["POST projects"]);
    });
  });
});
