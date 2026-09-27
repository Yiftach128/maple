import { createCommentStore } from "@maple-kit/core";
import { githubGate } from "@maple-kit/core/connectors";
import { memoryStore, sampleComment } from "@maple-kit/core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestServer, useTestServer } from "../../core/test/msw/server.js";
import { createToolHandlers } from "../src/handlers.js";
import { serverLogger } from "../src/logger.js";
import { expiredGateToken } from "./msw/gate.js";

import type { Logger } from "@maple-kit/core";

const BRANCH = "feature/agent";
const HEAD = "9ab1c2d";

const server = createTestServer(expiredGateToken);
useTestServer(server, { beforeAll, afterEach, afterAll });
afterEach(() => vi.restoreAllMocks());

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

async function resolveAgainstExpiredGate(logger: Logger) {
  const store = createCommentStore(memoryStore({ heads: { [BRANCH]: HEAD } }));
  const comment = await store.append(sampleComment({ branch: BRANCH }));
  const gate = githubGate({ owner: "maple-kit", repo: "app", token: "expired" });
  return await createToolHandlers({ store, gate, logger }).resolveComment({
    id: comment.id,
    sha: HEAD,
  });
}

describe("a gate publish that fails on resolve", () => {
  it("is reported on stderr, and the resolve still succeeds", async () => {
    const stderr = captured();

    const updated = await resolveAgainstExpiredGate(serverLogger(stderr));

    expect(updated.status).toBe("resolved");
    expect(stderr.text()).toMatch(/ error .*could not publish the merge gate/);
    expect(stderr.text()).toContain("maple-mcp");
  });

  it("goes to process.stderr by default and never to stdout, which is the protocol", async () => {
    const toStderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const toStdout = vi.spyOn(process.stdout, "write");

    await resolveAgainstExpiredGate(serverLogger());

    expect(toStderr).toHaveBeenCalledWith(expect.stringContaining("could not publish"));
    expect(toStdout).not.toHaveBeenCalled();
  });
});
