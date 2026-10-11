import { describe, expect, it } from "vitest";

import { ADVISORY_AUTHORS, BLOCKING_STATUSES, decideGate } from "../src/gate/decide.js";
import { storedComment } from "../src/testing/fixtures.js";

import type { Approval, Comment, CommentStatus, GateReason } from "../src/types.js";

function at(status: CommentStatus, body = "Fix the spacing") {
  return storedComment({ id: `c_${status}`, status, body });
}

describe("what holds the gate", () => {
  it.each<[CommentStatus, boolean]>([
    ["open", true],
    ["needs_reverify", true],
    ["orphaned", true],
    ["resolved", false],
  ])("a %s comment blocks: %s", (status, blocks) => {
    const verdict = decideGate([at(status)]);
    expect(verdict.conclusion).toBe(blocks ? "blocked" : "clear");
    expect(verdict.open).toBe(blocks ? 1 : 0);
  });

  it("names every blocking status in the exported default", () => {
    expect([...BLOCKING_STATUSES].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "needs_reverify",
      "open",
      "orphaned",
    ]);
  });

  it("takes a narrower policy when one is given", () => {
    const verdict = decideGate([at("orphaned")], { blockOn: ["open"] });
    expect(verdict.conclusion).toBe("clear");
  });
});

describe("the four ways of having nothing to say", () => {
  it.each<[string, GateReason, ReturnType<typeof decideGate>]>([
    ["comments that could not be read", "unreadable", decideGate(undefined)],
    [
      "a store that cannot record status",
      "status-untracked",
      decideGate([], { statusTracked: false }),
    ],
    [
      "a pull request Maple never reviewed",
      "no-review",
      decideGate(undefined, { hasReview: false }),
    ],
  ])("%s is neutral, not clear", (_, reason, verdict) => {
    expect(verdict.conclusion).toBe("neutral");
    expect(verdict.reason).toBe(reason);
    expect(verdict.open).toBe(0);
  });

  it("does not block on an untracked store even with open comments", () => {
    expect(decideGate([at("open")], { statusTracked: false }).conclusion).toBe("neutral");
  });

  it("keeps a pull request out of scope apart from one Maple could not read", () => {
    expect(decideGate(undefined, { hasReview: false }).summary).not.toContain("could not read");
    expect(decideGate(undefined).summary).toContain("could not read");
  });

  it("says nothing was reviewed even when comments were handed to it", () => {
    expect(decideGate([at("open")], { hasReview: false }).conclusion).toBe("neutral");
  });
});

describe("the two ways of being clear", () => {
  it("separates a pull request nobody commented on from one fully resolved", () => {
    expect(decideGate([]).reason).toBe("no-comments");
    expect(decideGate([at("resolved")]).reason).toBe("all-resolved");
  });
});

describe("what a person reads", () => {
  it("numbers an open comment as the export table numbers it", () => {
    const verdict = decideGate([at("resolved", "done"), at("open", "still wrong")]);
    expect(verdict.summary).toContain("2. `DashboardHeader` — still wrong");
    expect(verdict.summary).not.toContain("1. ");
  });

  it("counts against the total, not against the blocking ones", () => {
    const verdict = decideGate([at("open"), at("resolved"), at("orphaned")]);
    expect(verdict.title).toBe("2 of 3 comments still open");
    expect(verdict).toMatchObject({ open: 2, total: 3 });
  });

  it("says a single comment in the singular", () => {
    expect(decideGate([at("open")]).title).toBe("1 of 1 comment still open");
  });

  it("marks why a comment that nobody reopened is still blocking", () => {
    expect(decideGate([at("needs_reverify")]).summary).toContain("needs re-checking");
    expect(decideGate([at("orphaned")]).summary).toContain("(unpinned)");
  });

  it("flattens a body, because a list item ends at a newline", () => {
    const verdict = decideGate([storedComment({ status: "open", body: "one\n\ntwo" })]);
    expect(verdict.summary).toContain("one two");
  });

  it("stops naming comments after ten and says how many it did not name", () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      storedComment({ id: `c_${String(index)}`, status: "open" }),
    );
    const verdict = decideGate(many);
    expect(verdict.summary).toContain("…and 3 more.");
    expect(verdict.open).toBe(13);
  });
});

const COMMIT = "9f2c1ab";

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "app_1",
    branch: "feat/x",
    commit: COMMIT,
    author: { id: "u1", name: "Dana", provenance: "server" },
    at: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("a gate that wants somebody to have looked", () => {
  it("clears a quiet pull request when no approval is asked for", () => {
    expect(decideGate([]).conclusion).toBe("clear");
  });

  it("blocks a quiet pull request nobody approved", () => {
    const verdict = decideGate([], { requireApproval: true, approvals: [], commit: COMMIT });
    expect(verdict).toMatchObject({ conclusion: "blocked", reason: "awaiting-approval" });
  });

  it("blocks a fully resolved pull request nobody approved", () => {
    const verdict = decideGate([at("resolved")], {
      requireApproval: true,
      approvals: [],
      commit: COMMIT,
    });
    expect(verdict.reason).toBe("awaiting-approval");
    expect(verdict.summary).toContain("nobody has approved");
  });

  it("clears once somebody approved this commit", () => {
    const verdict = decideGate([], {
      requireApproval: true,
      approvals: [approval()],
      commit: COMMIT,
    });
    expect(verdict).toMatchObject({ conclusion: "clear", reason: "no-comments" });
    expect(verdict.title).toBe("Approved by Dana");
  });

  it("does not let an approval of another commit clear this one", () => {
    const verdict = decideGate([], {
      requireApproval: true,
      approvals: [approval({ commit: "deadbee" })],
      commit: COMMIT,
    });
    expect(verdict.reason).toBe("awaiting-approval");
  });

  it("carries the note a reviewer left with the approval", () => {
    const verdict = decideGate([], {
      requireApproval: true,
      approvals: [approval({ note: "Checked at 375px\ntoo" })],
      commit: COMMIT,
    });
    expect(verdict.summary).toContain("> Checked at 375px too");
  });

  it("says who approved it even when comments were resolved first", () => {
    const verdict = decideGate([at("resolved")], {
      requireApproval: true,
      approvals: [approval()],
      commit: COMMIT,
    });
    expect(verdict).toMatchObject({ conclusion: "clear", reason: "all-resolved" });
    expect(verdict.summary).toContain("Dana approved this preview.");
  });

  it("reports an open comment rather than the missing approval", () => {
    const verdict = decideGate([at("open")], {
      requireApproval: true,
      approvals: [],
      commit: COMMIT,
    });
    expect(verdict.reason).toBe("comments-open");
  });

  it("stays quiet about approval on a pull request Maple never reviewed", () => {
    const verdict = decideGate(undefined, { requireApproval: true, hasReview: false });
    expect(verdict.reason).toBe("no-review");
  });
});

describe("an approval that could not be looked for", () => {
  it("is neutral when the store keeps no approvals", () => {
    const verdict = decideGate([], { requireApproval: true, commit: COMMIT });
    expect(verdict).toMatchObject({ conclusion: "neutral", reason: "approval-untracked" });
    expect(verdict.summary).toContain("cannot record");
  });

  it("is neutral when nothing names the commit under judgement", () => {
    const verdict = decideGate([], { requireApproval: true, approvals: [approval()] });
    expect(verdict).toMatchObject({ conclusion: "neutral", reason: "approval-untracked" });
    expect(verdict.summary).toContain("names the commit");
  });

  it("still blocks on an open comment rather than going neutral", () => {
    const verdict = decideGate([at("open")], { requireApproval: true });
    expect(verdict).toMatchObject({ conclusion: "blocked", reason: "comments-open" });
  });
});

describe("a comment resolved against a commit that has moved on", () => {
  function resolvedAt(sha: string) {
    return storedComment({
      id: "c_done",
      status: "resolved",
      body: "Fix the spacing",
      resolution: { sha, at: "2026-09-22T09:00:00.000Z" },
    });
  }

  it("stays resolved unless the caller asked for re-verifying", () => {
    const verdict = decideGate([resolvedAt("older11")], { commit: COMMIT });
    expect(verdict).toMatchObject({ conclusion: "clear", reason: "all-resolved" });
  });

  it("needs re-verifying once it is asked for", () => {
    const verdict = decideGate([resolvedAt("older11")], {
      commit: COMMIT,
      reverifyResolved: true,
    });
    expect(verdict).toMatchObject({ conclusion: "blocked", reason: "comments-open" });
    expect(verdict.summary).toContain("needs re-checking");
  });

  it("leaves one resolved against this very commit alone", () => {
    const verdict = decideGate([resolvedAt(COMMIT)], { commit: COMMIT, reverifyResolved: true });
    expect(verdict.conclusion).toBe("clear");
  });

  it("leaves one nothing claimed to resolve alone, having no commit to compare", () => {
    const bare = storedComment({ id: "c_bare", status: "resolved" });
    expect(decideGate([bare], { commit: COMMIT, reverifyResolved: true }).conclusion).toBe("clear");
  });

  it("does nothing at all when nothing names the commit under judgement", () => {
    const verdict = decideGate([resolvedAt("older11")], { reverifyResolved: true });
    expect(verdict.conclusion).toBe("clear");
  });
});

describe("advisory authors", () => {
  const lint = (status: CommentStatus) =>
    storedComment({
      id: `lint_${status}`,
      status,
      author: { id: "maple-lint", name: "Maple lint", provenance: "server" },
    });

  interface Case {
    name: string;
    comments: Comment[];
    advisoryAuthors?: readonly string[];
    expected: [conclusion: string, open: number, total: number];
  }

  it.each<Case>([
    { name: "an open lint pin, by default", comments: [lint("open")], expected: ["clear", 0, 0] },
    {
      name: "an open lint pin, with none advisory",
      comments: [lint("open")],
      advisoryAuthors: [],
      expected: ["blocked", 1, 1],
    },
    {
      name: "a lint pin beside an open human comment",
      comments: [lint("open"), at("open")],
      expected: ["blocked", 1, 1],
    },
    {
      name: "a lint pin beside a resolved human comment",
      comments: [lint("open"), at("resolved")],
      expected: ["clear", 0, 1],
    },
    {
      name: "orphaned and stale lint pins",
      comments: [lint("orphaned"), lint("needs_reverify")],
      expected: ["clear", 0, 0],
    },
    {
      name: "a custom advisory author",
      comments: [at("open")],
      advisoryAuthors: ["u_1"],
      expected: ["clear", 0, 0],
    },
    {
      name: "a lint pin when only another author is advisory",
      comments: [lint("open")],
      advisoryAuthors: ["u_1"],
      expected: ["blocked", 1, 1],
    },
    {
      name: "a guest and a client who chose the id maple-lint",
      comments: (["guest", "client"] as const).map((provenance) =>
        storedComment({
          id: `spoof_${provenance}`,
          author: { id: "maple-lint", name: "Reviewer", provenance },
        }),
      ),
      expected: ["blocked", 2, 2],
    },
  ])("$name", ({ comments, advisoryAuthors, expected }) => {
    const verdict = decideGate(comments, advisoryAuthors === undefined ? {} : { advisoryAuthors });
    expect([verdict.conclusion, verdict.open, verdict.total]).toEqual(expected);
  });

  it("makes the lint author advisory by default", () => {
    expect(ADVISORY_AUTHORS).toEqual(["maple-lint"]);
  });

  it("leaves a lint-only surface awaiting approval, not approved by it", () => {
    const verdict = decideGate([lint("resolved")], {
      requireApproval: true,
      approvals: [],
      commit: COMMIT,
    });
    expect(verdict.reason).toBe("awaiting-approval");
  });

  it("numbers a blocking comment as the table does, lint pins included", () => {
    const verdict = decideGate([lint("open"), at("open", "Wrong colour")]);
    expect(verdict.summary).toContain("2. ");
    expect(verdict.summary).not.toContain("1. ");
  });
});
