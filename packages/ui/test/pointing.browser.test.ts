import { draftIdFor } from "@maple-kit/core/client";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { Maple } from "../src/maple.js";
import { fixtureFetch } from "./fixtures.js";

import type { Comment } from "@maple-kit/core";
import type { ReactElement } from "react";
import type { Root } from "react-dom/client";

const BRANCH = "feat/ui-pointing";

const CONTEXT = {
  url: "https://preview.example/dashboard",
  viewportWidth: 1180,
  viewportHeight: 900,
  contentWidth: 1180,
  devicePixelRatio: 2,
  colorScheme: "light",
  breakpoint: "lg",
} as const;

/** One card and one paragraph, both tagged the way a build's tagger tags them. */
const PAGE = `
<div data-maple-name="YieldCard" data-maple-src="app/dashboard/page.tsx:42:7"
     data-maple-label="the Yield card" style="height: 70px">Yield</div>
<p data-maple-name="GateNotice" data-maple-label="the gate notice" style="width: 260px">
  A pull request with an open comment is held until an agent resolves it or a reviewer
  closes it, which is long enough to select part of.
</p>
`;

/** An element pick on the card, and a text pick inside the paragraph. */
const COMMENTS: readonly Comment[] = [
  {
    id: "on-card",
    branch: BRANCH,
    body: "This delta is red for a drop, which is the good direction.",
    status: "open",
    createdAt: "2026-09-18T09:00:00.000Z",
    author: { id: "ada", name: "Ada", provenance: "server", colorSlot: 6 },
    anchor: { source: "app/dashboard/page.tsx:42:7", component: "YieldCard" },
    context: CONTEXT,
  },
  {
    id: "on-passage",
    branch: BRANCH,
    body: "Can this read “held” rather than naming the internal state?",
    status: "open",
    createdAt: "2026-09-19T09:00:00.000Z",
    author: { id: "grace", name: "Grace", provenance: "server", colorSlot: 0 },
    anchor: { component: "GateNotice", quote: { exact: "until an agent resolves it" } },
    context: CONTEXT,
  },
];

function root(): ShadowRoot {
  const host = document.querySelector<HTMLElement>("[data-maple-overlay]");
  if (!host?.shadowRoot) throw new Error("no overlay is mounted");
  return host.shadowRoot;
}

function find<T extends Element>(selector: string): T {
  const found = root().querySelector<T>(selector);
  if (!found) throw new Error(`nothing matched ${selector}`);
  return found;
}

function tree(): ReactElement {
  return createElement(Maple, {
    branch: BRANCH,
    theme: "light",
    options: { fetch: fixtureFetch(COMMENTS) },
  });
}

/** The mark standing for one comment, once the layer has drawn it. */
async function mark(address: number): Promise<HTMLElement> {
  await vi.waitFor(() => expect(root().querySelectorAll(".mk-mark")).toHaveLength(2));
  return find<HTMLElement>(`.mk-mark[aria-label^="Comment ${String(address)}"]`);
}

function point(node: HTMLElement, over: boolean): void {
  const type = over ? "pointerover" : "pointerout";
  node.dispatchEvent(
    new PointerEvent(type, { bubbles: true, ...(over ? {} : { relatedTarget: document.body }) }),
  );
}

/** The mark the overlay currently holds a peek on, for a failure to name. */
function peeked(): string {
  const node = root().querySelector<HTMLElement>(".mk-mark[data-mk-peeked='true']");
  return node?.getAttribute("aria-label") ?? "nothing";
}

async function ring(): Promise<HTMLElement> {
  await vi.waitFor(() => expect(root().querySelector(".mk-ring")).not.toBeNull());
  return find<HTMLElement>(".mk-ring");
}

/**
 * The real pointer stays where the last test, or the last file on this page, left
 * it, and a row opening under it is pointed at for real. Nothing opens mid-card.
 */
async function park(): Promise<void> {
  const card = document.querySelector<HTMLElement>('[data-maple-name="YieldCard"]');
  if (!card) throw new Error("no card on the page");
  await userEvent.hover(card);
}

let search = "";
let host: Root | undefined;

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.setAttribute("data-theme", "light");
  await page.viewport(1180, 860);
  const fixture = document.createElement("div");
  fixture.setAttribute("data-fixture-page", "");
  document.body.append(fixture);
  // The page is an application's own React tree, as it is in every example:
  // React treats a pointer arriving from a node it manages differently.
  host = createRoot(fixture);
  flushSync(() =>
    host?.render(createElement("div", { dangerouslySetInnerHTML: { __html: PAGE } })),
  );
  await park();
  history.replaceState({}, "", search === "" ? location.pathname : `?${search}`);
  await render(tree());
});

afterEach(() => {
  host?.unmount();
  host = undefined;
  search = "";
  history.replaceState({}, "", location.pathname);
  document.documentElement.removeAttribute("data-theme");
  for (const node of document.querySelectorAll("[data-maple-overlay], [data-fixture-page]")) {
    node.remove();
  }
});

/**
 * A mark is the one thing on the page that says a comment is here, so pointing
 * at it has to answer "which one" without asking for a click first.
 */
describe("pointing at a mark", () => {
  it("rings what it is on and names it, before anything is clicked", async () => {
    point(await mark(1), true);
    const node = await ring();

    expect(node.getAttribute("data-mk-state")).toBe("hovered");
    expect(find(".mk-ring-name").textContent).toBe("the Yield card");
  });

  it("draws the same ring a click does under a real pointer, not a fainter one", async () => {
    const node = await mark(1);
    await userEvent.hover(node);
    const hovered = getComputedStyle(await ring()).boxShadow;
    await userEvent.unhover(node);
    await vi.waitFor(() => expect(root().querySelector(".mk-ring")).toBeNull());

    node.click();
    await vi.waitFor(() => expect(find(".mk-ring").getAttribute("data-mk-state")).toBe("selected"));
    expect(hovered).toBe(getComputedStyle(find(".mk-ring")).boxShadow);
  });

  it("rings what it is on when the pointer arrives from the application's own React tree", async () => {
    const node = await mark(1);
    const card = document.querySelector<HTMLElement>('[data-maple-name="YieldCard"]');
    if (!card) throw new Error("no card on the page");

    await userEvent.hover(card);
    await userEvent.hover(node);

    await vi.waitFor(() => expect(peeked()).toMatch(/^Comment 1/));
    expect((await ring()).getAttribute("data-mk-state")).toBe("hovered");

    await userEvent.hover(card);
    await vi.waitFor(() => expect(root().querySelector(".mk-ring")).toBeNull());
  });

  it("rings what it is on when the keyboard lands on it, and lets go on the way off", async () => {
    const node = await mark(1);
    node.focus();
    const held = await ring();
    expect(held.getAttribute("data-mk-state")).toBe("hovered");
    expect(find(".mk-ring-name").textContent).toBe("the Yield card");

    node.blur();
    await vi.waitFor(() => expect(root().querySelector(".mk-ring")).toBeNull());
  });

  it("highlights the passage a text comment is on under a real pointer", async () => {
    await userEvent.hover(await mark(2));
    const node = await ring();

    expect(node.getAttribute("data-mk-passage")).toBe("true");
    await vi.waitFor(() => expect(node.querySelectorAll(".mk-ring-run").length).toBeGreaterThan(0));
  });

  it("lets the ring go again the moment the pointer leaves", async () => {
    const node = await mark(1);
    point(node, true);
    await ring();

    point(node, false);
    await vi.waitFor(() => expect(root().querySelector(".mk-ring")).toBeNull());
  });

  it("highlights the passage a text comment is on, not the paragraph round it", async () => {
    point(await mark(2), true);
    await ring();

    await vi.waitFor(() =>
      expect(root().querySelectorAll(".mk-ring-run").length).toBeGreaterThan(0),
    );
    expect(find(".mk-ring").getAttribute("data-mk-passage")).toBe("true");
  });
});

/** A click is the gesture that outlives the hand: it holds what hover shows. */
describe("clicking a mark", () => {
  async function click(address: number): Promise<HTMLElement> {
    const node = await mark(address);
    node.click();
    point(node, false);
    return node;
  }

  it("keeps the ring on the page after the pointer has moved away", async () => {
    await click(1);

    await vi.waitFor(() => expect(find(".mk-ring").getAttribute("data-mk-state")).toBe("selected"));
    expect(find(".mk-ring-name").textContent).toBe("the Yield card");
  });

  it("opens the comment it stands for, which is what a mark is for", async () => {
    await click(1);

    await vi.waitFor(() => expect(root().querySelector(".mk-read")).not.toBeNull());
    expect(find(".mk-read").textContent).toBe(COMMENTS[0]?.body);
    expect(find(".mk-composer").getAttribute("data-mk-open")).toBe("true");
  });

  it("opens the inventory with it, so the comment sits among the others", async () => {
    await click(1);

    await vi.waitFor(() => expect(root().querySelector(".mk-card")).not.toBeNull());
    expect(find(".mk-row[data-mk-selected='true']")).toBeInstanceOf(HTMLElement);
  });

  /**
   * Otherwise the inventory opens and nothing says which row it opened on. The
   * rail's two pixels are held in nothing, so only their colour changes.
   */
  it("paints the rail on the row it landed on, and on no other", async () => {
    await click(1);
    await vi.waitFor(() => expect(root().querySelector(".mk-card")).not.toBeNull());

    const rows = [...root().querySelectorAll<HTMLElement>(".mk-row")];
    const landed = find<HTMLElement>(".mk-row[data-mk-selected='true']");
    const rest = rows.filter((row) => row !== landed);
    const rail = (row: HTMLElement) => getComputedStyle(row).boxShadow;

    expect(rail(landed)).toContain("inset");
    expect(rail(landed)).not.toContain("rgba(0, 0, 0, 0)");
    expect(rest.every((row) => rail(row).includes("rgba(0, 0, 0, 0)"))).toBe(true);
    expect(new Set(rows.map((row) => row.getBoundingClientRect().left)).size).toBe(1);
  });

  it("glows in the leaf's own shape rather than behind its box", async () => {
    const node = await click(1);

    await vi.waitFor(() => expect(node.getAttribute("aria-pressed")).toBe("true"));
    expect(getComputedStyle(node).boxShadow).toBe("none");
    expect(getComputedStyle(node).filter).toContain("drop-shadow");
  });

  /**
   * A mark clicked on the page and a row in the list are the same comment, and
   * a row nobody can see has not been pointed at.
   */
  it("brings the row it stands for into view inside the list", async () => {
    (await mark(2)).click();
    await vi.waitFor(() => expect(root().querySelector(".mk-card")).not.toBeNull());

    const row = find<HTMLElement>(".mk-row[data-mk-selected='true']");
    const list = find<HTMLElement>(".mk-list");

    // Measured inside the retry: the scroll is smooth, so the first frame after
    // the click still has the row where it was.
    await vi.waitFor(() => {
      const inside = row.getBoundingClientRect();
      const around = list.getBoundingClientRect();
      expect(inside.top).toBeGreaterThanOrEqual(around.top - 1);
      expect(inside.bottom).toBeLessThanOrEqual(around.bottom + 1);
    });
  });

  /** Otherwise a reader with the panel up cannot point at anything else. */
  it("gives the ring back to a pointer on another mark", async () => {
    await click(1);
    await vi.waitFor(() => expect(root().querySelector(".mk-read")).not.toBeNull());

    const other = await mark(2);
    // The rest of this test is a lie if the addresses ever came out the other
    // way round, and an author is the cheapest way to say which mark this is.
    expect(other.getAttribute("aria-label")).toContain("by Grace");
    point(other, true);

    // Both inside the retry: the ring reaches `hovered` a frame before its
    // label catches up, so reading the name after the wait reads the old one.
    // The peeked mark rides along in the value so a failure names its cause.
    await vi.waitFor(() => {
      expect(find(".mk-ring").getAttribute("data-mk-state")).toBe("hovered");
      expect(`${String(find(".mk-ring-name").textContent)} · peeked ${peeked()}`).toBe(
        "a passage in the gate notice · peeked Comment 2 by Grace, Open",
      );
    });
  });
});

/**
 * A row pointed at is the same gesture as a mark pointed at, so the mark grows
 * and comes forward. The glow is the click's: that one outlives the hand.
 */
describe("pointing at a row", () => {
  async function row(): Promise<HTMLElement> {
    await vi.waitFor(() => expect(find(".mk-pill").textContent).toContain("open"));
    find<HTMLButtonElement>(".mk-pill").click();
    await vi.waitFor(() => expect(root().querySelectorAll(".mk-row").length).toBeGreaterThan(0));
    return find<HTMLElement>(".mk-row");
  }

  it("grows the mark it stands for, in the shape a click gives without the glow", async () => {
    const node = await mark(1);
    const rested = getComputedStyle(node).transform;

    point(await row(), true);

    await vi.waitFor(() => expect(node.getAttribute("data-mk-peeked")).toBe("true"));
    // The entrance animation still owns opacity for its first half-second.
    await vi.waitFor(() => expect(getComputedStyle(node).opacity).toBe("1"));
    expect(getComputedStyle(node).transform).not.toBe(rested);
    expect(getComputedStyle(node).filter.match(/drop-shadow/g)).toHaveLength(1);
  });

  it("gives it straight back when the pointer leaves, because a peek sticks to nothing", async () => {
    const node = await mark(1);
    const one = await row();
    point(one, true);
    await vi.waitFor(() => expect(node.getAttribute("data-mk-peeked")).toBe("true"));

    point(one, false);
    await vi.waitFor(() => expect(node.getAttribute("data-mk-peeked")).toBe("false"));
  });
});

/**
 * A mark stands outside its anchor's corner, and sometimes that corner is the
 * one thing worth reading. The offset is held for the session and never sent.
 */
describe("moving a mark off what it covers", () => {
  function at(node: HTMLElement, type: string, x: number, y: number): void {
    node.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
    );
  }

  /** The drag's own coordinates, from wherever the layer put the mark. */
  function drag(node: HTMLElement, by: { dx: number; dy: number }): void {
    const from = node.getBoundingClientRect();
    at(node, "pointerdown", from.x, from.y);
    at(node, "pointermove", from.x + by.dx, from.y + by.dy);
    at(node, "pointerup", from.x + by.dx, from.y + by.dy);
  }

  it("holds a mark where it was dragged to, and says so on the mark", async () => {
    const node = await mark(1);
    const before = node.getBoundingClientRect().x;

    drag(node, { dx: 60, dy: 24 });

    await vi.waitFor(() => expect(node.getAttribute("data-mk-nudged")).toBe("true"));
    await vi.waitFor(() => expect(node.getBoundingClientRect().x).toBeCloseTo(before + 60, 0));
  });

  /** A mark that opened the panel every time it was moved would be unusable. */
  it("does not open the comment on the click that ends a drag", async () => {
    const node = await mark(1);
    drag(node, { dx: 60, dy: 24 });
    node.click();

    await vi.waitFor(() => expect(node.getAttribute("data-mk-nudged")).toBe("true"));
    expect(root().querySelector(".mk-read")).toBeNull();
  });

  it("leaves a click a click when the pointer barely moved", async () => {
    const node = await mark(1);
    drag(node, { dx: 1, dy: 1 });
    node.click();

    await vi.waitFor(() => expect(root().querySelector(".mk-read")).not.toBeNull());
    expect(node.getAttribute("data-mk-nudged")).toBe("false");
  });
});

/** The panel is a surface beside the inventory, never a layer over it. */
describe("the inventory while a panel is open", () => {
  it("steps aside by the panel's own width instead of sitting under it", async () => {
    (await mark(1)).click();
    await vi.waitFor(() => expect(root().querySelector(".mk-read")).not.toBeNull());

    const island = find<HTMLElement>(".mk-island");
    await vi.waitFor(() => expect(island.getAttribute("data-mk-inset")).toBe("true"));

    const width = getComputedStyle(island).getPropertyValue("--mk-composer-w").trim();
    await vi.waitFor(() => expect(getComputedStyle(island).translate).toBe(`-${width}`));
  });

  it("comes back to its corner when the panel shuts", async () => {
    (await mark(1)).click();
    const island = find<HTMLElement>(".mk-island");
    await vi.waitFor(() => expect(island.getAttribute("data-mk-inset")).toBe("true"));

    find<HTMLButtonElement>(".mk-shut").click();

    await vi.waitFor(() => expect(island.getAttribute("data-mk-inset")).toBe("false"));
    await vi.waitFor(() => expect(getComputedStyle(island).translate).toBe("none"));
  });
});

/** Developer detail is mostly there to answer "where is this written?". */
describe("the ring in developer detail", () => {
  it("puts the source line under the name, and nothing under it otherwise", async () => {
    point(await mark(1), true);
    await ring();
    expect(root().querySelector(".mk-ring-note")).toBeNull();

    for (const node of document.querySelectorAll("[data-maple-overlay]")) node.remove();
    history.replaceState({}, "", "?maple-detail=developer");
    await render(tree());

    point(await mark(1), true);
    await ring();
    await vi.waitFor(() =>
      expect(find(".mk-ring-note").textContent).toBe("app/dashboard/page.tsx:42:7"),
    );
  });
});

/** A draft is a comment that has not left, and it still stands where it is about. */
describe("a draft on the page", () => {
  const DRAFTS = `maple:drafts:${BRANCH}`;

  /** Writes a draft the way another tab would, and waits for its leaf. */
  async function drafted(): Promise<HTMLElement> {
    const anchor = { source: "app/dashboard/page.tsx:42:7", component: "YieldCard" };
    const draft = {
      id: draftIdFor(anchor, Date.now()),
      body: "Not sure about this yet.",
      anchor,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(DRAFTS, JSON.stringify([draft]));
    window.dispatchEvent(new StorageEvent("storage", { key: DRAFTS }));
    await vi.waitFor(() => expect(root().querySelectorAll(".mk-mark")).toHaveLength(3));
    return find<HTMLElement>('.mk-mark[data-sent="false"]');
  }

  it("stands on the page as a muted leaf with no number", async () => {
    const node = await drafted();
    const sent = find<HTMLElement>('.mk-mark[aria-label^="Comment 1"]');
    const paint = (one: HTMLElement) => getComputedStyle(one).getPropertyValue("--mk-paint");

    expect(node.getAttribute("aria-label")).toBe("Draft comment");
    expect(node.querySelector(".mk-mark-n")).toBeNull();
    expect(paint(node)).not.toBe(paint(sent));
  });

  it("rings what it is on under the pointer, as a sent one does", async () => {
    const node = await drafted();
    await userEvent.hover(node);

    expect((await ring()).getAttribute("data-mk-state")).toBe("hovered");
    expect(find(".mk-ring-name").textContent).toBe("the Yield card");
  });

  it("opens the composer on what was written when clicked", async () => {
    (await drafted()).click();

    await vi.waitFor(() => expect(find(".mk-composer").getAttribute("data-mk-open")).toBe("true"));
    expect(find<HTMLTextAreaElement>("textarea").value).toBe("Not sure about this yet.");
    await vi.waitFor(() => expect(root().querySelectorAll(".mk-mark")).toHaveLength(2));
  });
});
