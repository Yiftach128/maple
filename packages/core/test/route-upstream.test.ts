import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { githubStore } from "../src/connectors/github.js";
import { MapleStoreError, UpstreamError } from "../src/errors.js";
import { createMapleHandler } from "../src/route/index.js";
import { createCommentStore } from "../src/store.js";
import { createTestServer, useTestServer } from "./msw/server.js";

const API = "https://api.github.com";
const BASE = "https://preview.example.com";
const server = createTestServer();

useTestServer(server, { beforeAll, afterEach, afterAll });

function handler() {
  const connector = githubStore({ owner: "maple-kit", repo: "app", token: "ghs_secret-token" });
  return createMapleHandler({ store: createCommentStore(connector) });
}

function answerPulls(status: number, body: { message: string }) {
  server.use(
    http.get(`${API}/repos/maple-kit/app/pulls`, () => HttpResponse.json(body, { status })),
  );
}

const refusals = [
  {
    status: 401,
    message: "Bad credentials",
    expected: 502,
    text: /GitHub refused the request \(401\): Bad credentials/,
  },
  {
    status: 403,
    message: "Request forbidden by administrative rules.",
    expected: 502,
    text: /GitHub refused the request \(403\): Request forbidden/,
  },
  {
    status: 404,
    message: "Not Found",
    expected: 502,
    text: /GitHub could not find the repository or pull request \(404\): Not Found/,
  },
  { status: 422, message: "Validation Failed", expected: 400, text: /not valid for this store/ },
  { status: 503, message: "Unavailable", expected: 503, text: /could not be reached/ },
];

describe("when GitHub refuses the route's own call", () => {
  it.each(refusals)(
    "answers $status with $expected",
    async ({ status, message, expected, text }) => {
      answerPulls(status, { message });

      const response = await handler()(new Request(`${BASE}/api/maple/comments?branch=main`));
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(expected);
      expect(body.error).toMatch(text);
      expect(JSON.stringify(body)).not.toContain("ghs_secret-token");
    },
  );
});

describe("what the connector keeps of a refusal", () => {
  it.each([401, 403, 404])("carries GitHub's %i as a structured reason", async (status) => {
    answerPulls(status, { message: "nope" });
    const connector = githubStore({ owner: "maple-kit", repo: "app", token: "t" });

    const error = await createCommentStore(connector)
      .list({ branch: "main" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MapleStoreError);
    expect((error as MapleStoreError).reason).toBe("rejected");
    expect((error as MapleStoreError).upstream).toBeInstanceOf(UpstreamError);
    expect((error as MapleStoreError).upstream).toMatchObject({ service: "GitHub", status });
  });

  it("leaves a plain connector error without an upstream", async () => {
    const connector = githubStore({ owner: "maple-kit", repo: "app", token: "t" });
    const error = await createCommentStore(connector)
      .list({ branch: "main", limit: -1 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MapleStoreError);
    expect((error as MapleStoreError).upstream).toBeUndefined();
  });
});
