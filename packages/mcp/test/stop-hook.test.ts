import { sampleComment } from "@maple-kit/core/testing";
import { describe, expect, it } from "vitest";

import { decideStop, MAX_BLOCKS } from "../src/stop-hook.js";

import type { Comment } from "@maple-kit/core";

function open(overrides: Partial<Comment> = {}): Comment {
  return { id: "c_1", status: "open", ...sampleComment(), ...overrides };
}

describe("the stop hook", () => {
  it("lets the agent finish when nothing is open", () => {
    expect(decideStop([], 0)).toEqual({});
  });

  it("blocks while a comment is open, and says which", () => {
    const decision = decideStop([open({ id: "c_7" })], 0);

    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("[c_7]");
    expect(decision.reason).toContain("resolve_comment");
  });

  it("names where each comment points", () => {
    const decision = decideStop(
      [
        open({ id: "a", anchor: { source: "src/App.tsx:4:3" } }),
        open({ id: "b", anchor: { component: "Header" } }),
      ],
      0,
    );

    expect(decision.reason).toContain("src/App.tsx:4:3");
    expect(decision.reason).toContain("Header");
  });

  it("warns that an orphan's location is stale", () => {
    const decision = decideStop([open({ status: "orphaned" })], 0);
    expect(decision.reason).toContain("orphaned");
  });

  it("truncates a long comment rather than pasting an essay", () => {
    const decision = decideStop([open({ body: "x".repeat(400) })], 0);
    expect(decision.reason!.length).toBeLessThan(300);
  });

  it("gives up after enough attempts rather than hanging the session", () => {
    const decision = decideStop([open()], MAX_BLOCKS);

    expect(decision.decision).toBeUndefined();
    expect(decision.reason).toContain("Letting the session end");
  });

  it("still blocks one attempt before the last", () => {
    expect(decideStop([open()], MAX_BLOCKS - 1).decision).toBe("block");
  });
});
