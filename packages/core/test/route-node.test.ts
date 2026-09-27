import http2 from "node:http2";

import { afterEach, describe, expect, it } from "vitest";

import { toNodeMiddleware } from "../src/route/node.js";

import type { AddressInfo } from "node:net";

const BASE = "/api/maple";

interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** Runs one GET through the middleware and reports the Request it built. */
function seenBy(headers: Record<string, string>): Promise<Seen> {
  return new Promise((resolve, reject) => {
    const middleware = toNodeMiddleware((incoming) => {
      resolve({ url: incoming.url, headers: Object.fromEntries(incoming.headers) });
      return Promise.resolve(new Response("ok"));
    }, BASE);
    const response = { setHeader: () => undefined, end: () => undefined, headersSent: false };

    middleware(
      { url: `${BASE}/me`, method: "GET", headers, on: () => undefined } as never,
      response as never,
      () => reject(new Error("passed on")),
    );
  });
}

describe("building the request from Node's headers", () => {
  it.each([
    {
      shape: "HTTP/1 with a host",
      headers: { host: "app.test", cookie: "a=1" },
      url: "http://app.test/api/maple/me",
    },
    {
      shape: "HTTP/2 with only :authority",
      headers: {
        ":method": "GET",
        ":path": `${BASE}/me`,
        ":scheme": "https",
        ":authority": "app.test:5173",
        cookie: "a=1",
      },
      url: "https://app.test:5173/api/maple/me",
    },
    {
      shape: "HTTP/2 with both host and :authority",
      headers: { ":authority": "other.test", ":scheme": "http", host: "app.test", cookie: "a=1" },
      url: "http://app.test/api/maple/me",
    },
    {
      shape: "HTTP/2 with neither",
      headers: { ":method": "GET", ":path": `${BASE}/me`, ":scheme": "https", cookie: "a=1" },
      url: "https://localhost/api/maple/me",
    },
  ])("$shape", async ({ headers, url }) => {
    const seen = await seenBy(headers);

    expect(seen.url).toBe(url);
    expect(seen.headers["cookie"]).toBe("a=1");
    expect(Object.keys(seen.headers).filter((name) => name.startsWith(":"))).toEqual([]);
  });

  it("answers 500 rather than rejecting when the handler throws", async () => {
    const middleware = toNodeMiddleware(() => Promise.reject(new Error("boom")), BASE);
    const ended = new Promise<number>((resolve) => {
      const response = {
        statusCode: 200,
        headersSent: false,
        end: () => resolve(response.statusCode),
      };
      middleware(
        { url: `${BASE}/me`, method: "GET", headers: { host: "x" } } as never,
        response as never,
        () => undefined,
      );
    });

    expect(await ended).toBe(500);
  });
});

describe("mounting on a real HTTP/2 server", () => {
  let server: http2.Http2Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("serves a cleartext HTTP/2 request", async () => {
    const middleware = toNodeMiddleware(
      (incoming) =>
        Promise.resolve(
          Response.json({ url: incoming.url, cookie: incoming.headers.get("cookie") }),
        ),
      BASE,
    );
    server = http2.createServer((request, response) =>
      middleware(request as never, response as never, () => response.end()),
    );
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const body = await get(`http://127.0.0.1:${port}`, `${BASE}/me`, { cookie: "a=1" });

    expect(JSON.parse(body)).toEqual({
      url: `http://127.0.0.1:${port}/api/maple/me`,
      cookie: "a=1",
    });
  });
});

function get(origin: string, path: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(origin);
    client.on("error", reject);
    const stream = client.request({ ":path": path, ...headers });
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      client.close();
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    stream.on("error", reject);
    stream.end();
  });
}
