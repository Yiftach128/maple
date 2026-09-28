import { createInventory } from "@maple-kit/mock";
import { mockHandlers } from "@maple-kit/mock/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API, createApiFake, ME, PROJECTS } from "./msw/api.js";
import { handlerFetch } from "./msw/fetch.js";
import { API_GRAPHQL, createGraphqlFake, GRAPHQL, QUERIES } from "./msw/graphql.js";
import { createTestServer, useTestServer } from "./msw/server.js";

import type { Recipe } from "@maple-kit/core/mock";

const api = createApiFake();
const graphql = createGraphqlFake();
const inventory = createInventory();

const recipe: Recipe = {
  version: 2,
  calls: [
    { key: "rest:GET /api/projects", state: "empty" },
    { key: "rest:GET /api/count", state: "error" },
    { key: "graphql:Projects", state: "empty" },
  ],
};

// A forward that reaches the host's handlers rather than a real network,
// which is where `bypass` would send it from a test.
const hosted = [...api.handlers, ...graphql.handlers];
const server = createTestServer(
  ...mockHandlers(recipe, { fetch: handlerFetch(hosted), inventory, route: () => "/p" }),
  ...hosted,
);
useTestServer(server, { afterAll, afterEach, beforeAll });
afterEach(() => {
  api.reset();
  graphql.reset();
});

describe("mockHandlers, under setupServer", () => {
  it("answers a named call in its state", async () => {
    const body = (await (await fetch(`${API}/projects`)).json()) as typeof PROJECTS;
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("answers a named failure without reaching the host's handlers", async () => {
    expect((await fetch(`${API}/count`)).status).toBe(500);
    expect(api.reached).toEqual([]);
  });

  it("falls through to the host's own handlers for every other call", async () => {
    await expect((await fetch(`${API}/me`)).json()).resolves.toEqual(ME);
    expect(api.reached).toEqual(["GET /api/me"]);
  });

  it.each([GRAPHQL, API_GRAPHQL])("reads GraphQL at %s by default, before REST", async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERIES.projects }),
    });
    await expect(response.json()).resolves.toEqual({ data: { projects: { items: [], total: 0 } } });
    expect(graphql.reached).toEqual(["POST projects"]);
  });

  it("records the real answer it reshaped", async () => {
    await fetch(`${API}/projects`);
    expect(inventory.sample("rest:GET /api/projects", "/p")?.body).toEqual(PROJECTS);
  });

  it("is the same export at /msw", async () => {
    const browser = await import("@maple-kit/mock/msw");
    expect(browser.mockHandlers).toBe(mockHandlers);
  });
});
