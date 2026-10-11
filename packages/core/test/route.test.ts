import { describe, expect, it } from "vitest";

import { createMapleHandler } from "../src/route/index.js";
import { createCommentStore } from "../src/store.js";
import { sampleComment } from "../src/testing/fixtures.js";
import { memoryGate } from "../src/testing/memory-gate.js";
import { memoryStore } from "../src/testing/memory-store.js";

import type { IdentityConnector, StoreConnector } from "../src/connectors/types.js";
import type { StoreResolver } from "../src/route/index.js";
import type { CommentStore } from "../src/store.js";

const BASE = "https://preview.example.com";

function handler(
  overrides: {
    store?: CommentStore | StoreResolver;
    identity?: IdentityConnector;
    gate?: Parameters<typeof createMapleHandler>[0]["gate"];
  } = {},
) {
  const { gate, ...rest } = overrides;
  return createMapleHandler({
    store: overrides.store ?? createCommentStore(memoryStore()),
    ...rest,
    ...(gate === undefined ? {} : { gate }),
  });
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const reviewer: IdentityConnector = {
  name: "test-identity",
  resolveUser: (incoming) =>
    Promise.resolve(
      incoming.headers["cookie"] === "session=valid" ? { id: "u_7", name: "Reviewer" } : null,
    ),
};

describe("routing", () => {
  it("serves nothing outside its base path", async () => {
    expect((await handler()(request("GET", "/comments?branch=main"))).status).toBe(404);
  });

  it("can be mounted somewhere else", async () => {
    const handle = createMapleHandler({
      store: createCommentStore(memoryStore()),
      basePath: "/_maple",
    });
    expect((await handle(request("GET", "/_maple/comments?branch=main"))).status).toBe(200);
  });

  it("answers 404 for a path it does not have", async () => {
    expect((await handler()(request("GET", "/api/maple/nothing"))).status).toBe(404);
  });

  it("answers 405 for the wrong method on a path it does have", async () => {
    expect((await handler()(request("DELETE", "/api/maple/comments"))).status).toBe(405);
  });

  it("never caches a response", async () => {
    const response = await handler()(request("GET", "/api/maple/comments?branch=main"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

/** A host that only mocks mounts the route without a store, as `assist` without a classifier. */
describe("a route with no store", () => {
  const storeless = createMapleHandler({});

  it.each([
    ["GET", "/api/maple/comments?branch=main"],
    ["POST", "/api/maple/comments"],
    ["PATCH", "/api/maple/comments/c_1"],
    ["GET", "/api/maple/approvals?branch=main"],
  ])("answers 404 to %s %s", async (method, path) => {
    const response = await storeless(request(method, path, method === "GET" ? undefined : {}));
    expect(response.status).toBe(404);
  });

  it("still says who is asking", async () => {
    const response = await storeless(request("GET", "/api/maple/me"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: null, media: false });
  });

  it("still answers 405 before 404 for a wrong method", async () => {
    expect((await storeless(request("DELETE", "/api/maple/comments"))).status).toBe(405);
  });
});

describe("listing comments", () => {
  it("requires a branch rather than guessing one", async () => {
    const response = await handler()(request("GET", "/api/maple/comments"));
    expect(response.status).toBe(400);
  });

  it("returns the page the store returned", async () => {
    const store = createCommentStore(memoryStore());
    await store.append(sampleComment({ branch: "main" }));

    const response = await handler({ store })(request("GET", "/api/maple/comments?branch=main"));
    const page = (await response.json()) as { comments: unknown[] };
    expect(page.comments).toHaveLength(1);
  });

  it("passes the limit and cursor through", async () => {
    const store = createCommentStore(memoryStore());
    for (const body of ["a", "b", "c"]) await store.append(sampleComment({ branch: "main", body }));

    const first = await handler({ store })(
      request("GET", "/api/maple/comments?branch=main&limit=2"),
    );
    const page = (await first.json()) as { comments: unknown[]; cursor?: string };
    expect(page.comments).toHaveLength(2);
    expect(page.cursor).toBeTruthy();
  });

  it("ignores a status it does not recognise rather than failing", async () => {
    const response = await handler()(
      request("GET", "/api/maple/comments?branch=main&status=nonsense"),
    );
    expect(response.status).toBe(200);
  });

  it("turns a store's complaint into a 400, not a 500", async () => {
    const response = await handler()(request("GET", "/api/maple/comments?branch=main&limit=-1"));
    expect(response.status).toBe(400);
  });
});

describe("writing a comment", () => {
  it("rejects a body that is not a comment", async () => {
    expect((await handler()(request("POST", "/api/maple/comments", { hi: 1 }))).status).toBe(400);
  });

  it("rejects a body that is not JSON at all", async () => {
    const response = await handler()(
      new Request(`${BASE}/api/maple/comments`, { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
  });

  it("stamps the author from the session, never from the request", async () => {
    const draft = {
      ...sampleComment({ branch: "main" }),
      author: { id: "u_666", name: "Somebody Else", provenance: "server" },
    };
    const response = await handler({ identity: reviewer })(
      new Request(`${BASE}/api/maple/comments`, {
        method: "POST",
        body: JSON.stringify(draft),
        headers: { cookie: "session=valid" },
      }),
    );

    const stored = (await response.json()) as { author: { id: string; provenance: string } };
    expect(response.status).toBe(201);
    expect(stored.author.id).toBe("u_7");
    expect(stored.author.provenance).toBe("server");
  });

  it("refuses a comment from an identity named like Maple's own advisory author", async () => {
    const store = createCommentStore(memoryStore());
    const lintLike: IdentityConnector = {
      name: "lint-like",
      resolveUser: () => Promise.resolve({ id: "maple-lint", name: "Reviewer" }),
    };
    const response = await handler({ store, identity: lintLike })(
      request("POST", "/api/maple/comments", sampleComment({ branch: "main" })),
    );
    expect(response.status).toBe(403);
    expect((await store.list({ branch: "main" })).comments).toHaveLength(0);
  });

  it.each([
    { name: "the default list", advisoryAuthors: undefined, id: "maple-lint", status: 403 },
    { name: "a custom list", advisoryAuthors: ["design-bot"], id: "design-bot", status: 403 },
    {
      name: "a custom list, default id",
      advisoryAuthors: ["design-bot"],
      id: "maple-lint",
      status: 201,
    },
    { name: "an empty list", advisoryAuthors: [], id: "maple-lint", status: 201 },
  ])("gates posting as an advisory author by $name", async ({ advisoryAuthors, id, status }) => {
    const store = createCommentStore(memoryStore());
    const identity: IdentityConnector = {
      name: "table",
      resolveUser: () => Promise.resolve({ id, name: "Reviewer" }),
    };
    const response = await handler({
      store,
      identity,
      ...(advisoryAuthors === undefined ? {} : { advisoryAuthors }),
    })(request("POST", "/api/maple/comments", sampleComment({ branch: "main" })));
    expect(response.status).toBe(status);
  });

  it("drops a resolution posted with a new comment, which cannot arrive resolved", async () => {
    const store = createCommentStore(memoryStore());
    const draft = {
      ...sampleComment({ branch: "main" }),
      resolution: { sha: "deadbee", at: "2020-01-01T00:00:00.000Z" },
    };

    const response = await handler({ store })(request("POST", "/api/maple/comments", draft));
    const stored = (await response.json()) as { resolution?: unknown };
    expect(response.status).toBe(201);
    expect(stored.resolution).toBeUndefined();
  });

  it("marks a comment written without a session as a guest's", async () => {
    const response = await handler({ identity: reviewer })(
      request("POST", "/api/maple/comments", sampleComment({ branch: "main" })),
    );

    const stored = (await response.json()) as { author: { provenance: string } };
    expect(stored.author.provenance).toBe("guest");
  });

  it("keeps the label and the commit the page described itself with", async () => {
    const draft = sampleComment({
      branch: "feature/long-name",
      label: "web-482",
      commit: "a1b2c3d",
    });

    const response = await handler()(request("POST", "/api/maple/comments", draft));
    const stored = (await response.json()) as { label?: string; commit?: string; branch: string };
    expect(response.status).toBe(201);
    expect(stored.label).toBe("web-482");
    expect(stored.commit).toBe("a1b2c3d");
    expect(stored.branch).toBe("feature/long-name");
  });

  it("takes a comment that describes neither", async () => {
    const response = await handler()(
      request("POST", "/api/maple/comments", sampleComment({ branch: "main" })),
    );
    const stored = (await response.json()) as { label?: string; commit?: string };
    expect(response.status).toBe(201);
    expect(stored.label).toBeUndefined();
    expect(stored.commit).toBeUndefined();
  });

  it("refuses a commit that is not one, rather than writing it into the fence", async () => {
    const draft = sampleComment({ branch: "main", commit: "not-a-sha" });
    expect((await handler()(request("POST", "/api/maple/comments", draft))).status).toBe(400);
  });

  it("refuses a label that is not a string", async () => {
    const draft = { ...sampleComment({ branch: "main" }), label: 42 };
    expect((await handler()(request("POST", "/api/maple/comments", draft))).status).toBe(400);
  });
});

describe("a reviewer's colour slot", () => {
  function signedInAs(id: string): IdentityConnector {
    return { name: "test-identity", resolveUser: () => Promise.resolve({ id, name: "Reviewer" }) };
  }

  async function slotFor(id: string, body: unknown = sampleComment({ branch: "main" })) {
    const response = await handler({ identity: signedInAs(id) })(
      request("POST", "/api/maple/comments", body),
    );
    const stored = (await response.json()) as { author: { colorSlot?: number } };
    return stored.author.colorSlot;
  }

  it.each(["u_7", "u_1", "reviewer@example.com", "\u00fcn\u00efc\u00f8d\u00e9"])(
    "gives %s one of the ten slots, and the same one every time",
    async (id) => {
      const first = await slotFor(id);
      const second = await slotFor(id);

      expect(first).toBe(second);
      expect(Number.isInteger(first)).toBe(true);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(10);
    },
  );

  it("derives it from the id alone, so two machines agree without talking", async () => {
    expect(await slotFor("u_7")).toBe(8);
    expect(await slotFor("u_1")).toBe(6);
  });

  it("ignores a slot the client asked for, the way it ignores an author", async () => {
    const draft = {
      ...sampleComment({ branch: "main" }),
      author: { id: "u_666", name: "Somebody Else", provenance: "server", colorSlot: 3 },
    };

    expect(await slotFor("u_7", draft)).toBe(8);
  });

  it("leaves a guest without one, because the page assigns theirs", async () => {
    const response = await handler({ identity: reviewer })(
      request("POST", "/api/maple/comments", sampleComment({ branch: "main" })),
    );
    const stored = (await response.json()) as { author: { colorSlot?: number } };

    expect(stored.author.colorSlot).toBeUndefined();
  });
});

describe("changing a status", () => {
  it("changes it", async () => {
    const store = createCommentStore(memoryStore());
    const stored = await store.append(sampleComment({ branch: "main" }));

    const response = await handler({ store })(
      request("PATCH", `/api/maple/comments/${stored.id}`, { status: "resolved" }),
    );
    expect(((await response.json()) as { status: string }).status).toBe("resolved");
  });

  it("records a resolution and stamps the time itself", async () => {
    const store = createCommentStore(memoryStore());
    const stored = await store.append(sampleComment({ branch: "main" }));

    const response = await handler({ store })(
      request("PATCH", `/api/maple/comments/${stored.id}`, {
        status: "resolved",
        resolution: {
          sha: "9f1c0de",
          note: "Matched the padding.",
          at: "1999-01-01T00:00:00.000Z",
        },
      }),
    );

    const updated = (await response.json()) as { resolution?: { sha: string; at: string } };
    expect(updated.resolution?.sha).toBe("9f1c0de");
    expect(updated.resolution?.at).not.toBe("1999-01-01T00:00:00.000Z");
    expect(Date.parse(updated.resolution?.at ?? "")).toBeGreaterThan(Date.now() - 60_000);
  });

  it("rejects a resolution with no sha rather than storing an empty claim", async () => {
    const store = createCommentStore(memoryStore());
    const stored = await store.append(sampleComment({ branch: "main" }));

    const response = await handler({ store })(
      request("PATCH", `/api/maple/comments/${stored.id}`, {
        status: "resolved",
        resolution: { note: "Trust me." },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a status that is not one", async () => {
    const response = await handler()(
      request("PATCH", "/api/maple/comments/c_1", { status: "definitely-not" }),
    );
    expect(response.status).toBe(400);
  });

  it("says 501 when the store cannot change a status at all", async () => {
    const response = await handler({
      store: createCommentStore(memoryStore({ appendOnly: true })),
    })(request("PATCH", "/api/maple/comments/c_1", { status: "resolved" }));
    expect(response.status).toBe(501);
  });
});

describe("identity", () => {
  it("reports the reviewer when the session says who they are", async () => {
    const response = await handler({ identity: reviewer })(
      new Request(`${BASE}/api/maple/me`, { headers: { cookie: "session=valid" } }),
    );
    expect((await response.json()) as unknown).toEqual({
      user: { id: "u_7", name: "Reviewer" },
      media: false,
      approval: { required: false },
    });
  });

  it("reports nobody rather than failing when there is no identity connector", async () => {
    const response = await handler()(request("GET", "/api/maple/me"));
    expect((await response.json()) as unknown).toEqual({
      user: null,
      media: false,
      approval: { required: false },
    });
  });
});

describe("when something breaks", () => {
  it("does not hand the store's message to the browser", async () => {
    const exploding: StoreConnector = {
      name: "exploding",
      list: () => Promise.reject(new Error("token ghp_secret expired for org/private-repo")),
      append: () => Promise.reject(new Error("no")),
    };

    const response = await handler({ store: createCommentStore(exploding) })(
      request("GET", "/api/maple/comments?branch=main"),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain("ghp_secret");
    expect(body).not.toContain("private-repo");
  });
});

describe("mounting on a Node server", () => {
  it("passes a request outside the base path straight on", async () => {
    const { toNodeMiddleware } = await import("../src/route/node.js");
    const middleware = toNodeMiddleware(() => Promise.resolve(new Response("no")), "/api/maple");

    let passed = false;
    middleware({ url: "/index.html", headers: {} } as never, {} as never, () => (passed = true));
    expect(passed).toBe(true);
  });

  /** A screenshot through a UTF-8 string comes back as an image no decoder
   * will open, and neither half of the round trip said anything about it. */
  it("carries bytes in and out, not text", async () => {
    const { toNodeMiddleware } = await import("../src/route/node.js");
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    let seen: Uint8Array | undefined;
    const middleware = toNodeMiddleware(async (incoming) => {
      seen = new Uint8Array(await incoming.arrayBuffer());
      return new Response(png);
    }, "/api/maple");

    const written = await through(middleware, png);
    expect(seen).toEqual(png);
    expect(written).toEqual(png);
  });

  it("does not pass on a request inside it", async () => {
    const { toNodeMiddleware } = await import("../src/route/node.js");
    const middleware = toNodeMiddleware(() => Promise.resolve(new Response("ok")), "/api/maple");

    let passed = false;
    middleware(
      { url: "/api/maple/me", method: "GET", headers: { host: "x" }, on: () => undefined } as never,
      { setHeader: () => undefined, end: () => undefined } as never,
      () => (passed = true),
    );
    expect(passed).toBe(false);
  });
});

describe("a store chosen per request", () => {
  it("asks the resolver, and uses what it hands back", async () => {
    const store = createCommentStore(memoryStore());
    const seen: string[] = [];
    const resolve: StoreResolver = (incoming) => {
      seen.push(incoming.headers["cookie"] ?? "");
      return store;
    };

    const response = await handler({ store: resolve })(
      new Request(`${BASE}/api/maple/comments?branch=main`, {
        headers: { cookie: "maple_gh=t" },
      }),
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual(["maple_gh=t"]);
  });

  it("asks again on the next request, because the token is not the process's", async () => {
    let asked = 0;
    const resolve: StoreResolver = () => {
      asked += 1;
      return createCommentStore(memoryStore());
    };
    const handle = handler({ store: resolve });

    await handle(request("GET", "/api/maple/comments?branch=main"));
    await handle(request("GET", "/api/maple/comments?branch=main"));
    expect(asked).toBe(2);
  });

  it("takes a resolver that answers with a promise", async () => {
    const resolve: StoreResolver = () => Promise.resolve(createCommentStore(memoryStore()));
    const response = await handler({ store: resolve })(
      request("GET", "/api/maple/comments?branch=main"),
    );
    expect(response.status).toBe(200);
  });

  it("answers 401 when the reviewer has no store, rather than writing as somebody", async () => {
    const handle = handler({ store: () => null });

    const listed = await handle(request("GET", "/api/maple/comments?branch=main"));
    const written = await handle(
      request("POST", "/api/maple/comments", sampleComment({ branch: "main" })),
    );

    expect(listed.status).toBe(401);
    expect(written.status).toBe(401);
  });

  it("answers who the reviewer is without resolving a store at all", async () => {
    const resolve: StoreResolver = () => {
      throw new Error("the identity route must not need a store");
    };

    const response = await handler({ store: resolve, identity: reviewer })(
      request("GET", "/api/maple/me"),
    );
    expect(response.status).toBe(200);
  });

  it("answers 405 before it asks for a store, a wrong method being no credential problem", async () => {
    let asked = 0;
    const resolve: StoreResolver = () => {
      asked += 1;
      return createCommentStore(memoryStore());
    };

    const response = await handler({ store: resolve })(request("DELETE", "/api/maple/comments"));
    expect(response.status).toBe(405);
    expect(asked).toBe(0);
  });

  it("reports a resolver that threw as a failure, not as an empty page", async () => {
    const resolve: StoreResolver = () => {
      throw new Error("the token could not be read");
    };
    const response = await handler({ store: resolve })(
      request("GET", "/api/maple/comments?branch=main"),
    );
    expect(response.status).toBe(500);
  });
});

/** Drives the middleware with a body and collects what it wrote back. */
function through(
  middleware: (request: never, response: never, next: () => void) => void,
  body: Uint8Array,
): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const listeners = new Map<string, (chunk?: unknown) => void>();
    const request = {
      url: "/api/maple/media",
      method: "POST",
      headers: { host: "x" },
      on: (event: string, listener: (chunk?: unknown) => void) => listeners.set(event, listener),
    };
    const response = {
      setHeader: () => undefined,
      end: (written: Uint8Array) => resolve(new Uint8Array(written)),
    };

    middleware(request as never, response as never, () => undefined);
    queueMicrotask(() => {
      listeners.get("data")?.(Buffer.from(body));
      listeners.get("end")?.();
    });
  });
}

describe("publishing a set of comments at once", () => {
  it("takes an array and answers with what it stored, in order", async () => {
    const handle = handler();
    const response = await handle(
      request("POST", "/api/maple/comments", [
        sampleComment({ branch: "main", body: "first" }),
        sampleComment({ branch: "main", body: "second" }),
      ]),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { comments: { body: string; id: string }[] };
    expect(body.comments.map((one) => one.body)).toEqual(["first", "second"]);
    expect(new Set(body.comments.map((one) => one.id)).size).toBe(2);
  });

  it("still answers one comment with one comment, not a list", async () => {
    const response = await handler()(
      request("POST", "/api/maple/comments", sampleComment({ branch: "main" })),
    );
    expect((await response.json()) as { comments?: unknown }).not.toHaveProperty("comments");
  });

  it("refuses the whole set when one of them is not a comment", async () => {
    const response = await handler()(
      request("POST", "/api/maple/comments", [sampleComment({ branch: "main" }), { body: "no" }]),
    );
    expect(response.status).toBe(400);
  });

  it("stores nothing and complains about nothing for an empty set", async () => {
    const handle = handler({ store: createCommentStore(memoryStore()) });
    const response = await handle(request("POST", "/api/maple/comments", []));
    expect(response.status).toBe(201);
    expect((await response.json()) as { comments: unknown[] }).toEqual({ comments: [] });
  });

  it("falls back to one at a time where the store takes no batch", async () => {
    const handle = handler({ store: createCommentStore(memoryStore({ withoutBatch: true })) });
    const response = await handle(
      request("POST", "/api/maple/comments", [
        sampleComment({ branch: "main", body: "first" }),
        sampleComment({ branch: "main", body: "second" }),
      ]),
    );

    const body = (await response.json()) as { comments: { body: string }[] };
    expect(body.comments.map((one) => one.body)).toEqual(["first", "second"]);
  });
});

describe("what the gate hears about a new comment", () => {
  it("publishes a verdict, so a comment turns a green check red", async () => {
    const gate = memoryGate();
    const branch = "feat/new-comment";
    const handle = handler({
      store: createCommentStore(memoryStore({ heads: { [branch]: "abcdef1" } })),
      gate,
    });

    await handle(request("POST", "/api/maple/comments", sampleComment({ branch })));

    expect(gate.history({ branch, sha: "abcdef1" }).at(-1)).toMatchObject({
      conclusion: "blocked",
      reason: "comments-open",
    });
  });
});
