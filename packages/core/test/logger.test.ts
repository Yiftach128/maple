import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger/logger.js";
import { memorySink } from "../src/logger/sinks/memory.js";
import { streamSink } from "../src/logger/sinks/stream.js";

import type { LogSink } from "../src/logger/types.js";

describe("createLogger", () => {
  it("writes info and above by default", () => {
    const sink = memorySink();
    const log = createLogger({ sinks: [sink] });

    log.debug("dropped");
    log.info("kept");
    log.warn("kept");
    log.error("kept");

    expect(sink.records.map((record) => record.level)).toEqual(["info", "warn", "error"]);
  });

  it("honours a lower threshold", () => {
    const sink = memorySink();
    createLogger({ sinks: [sink], level: "debug" }).debug("kept");

    expect(sink.records).toHaveLength(1);
  });

  it("writes nothing when given no sinks", () => {
    expect(() => createLogger({ sinks: [] }).error("nowhere to go")).not.toThrow();
  });

  it("merges bound fields under per-call fields", () => {
    const sink = memorySink();
    const log = createLogger({ sinks: [sink], fields: { service: "core", run: 1 } });

    log.info("hello", { run: 2 });

    expect(sink.records[0]?.fields).toEqual({ service: "core", run: 2 });
  });

  it("accumulates fields through child loggers", () => {
    const sink = memorySink();
    const log = createLogger({ sinks: [sink], fields: { service: "core" } });

    log.child({ branch: "main" }).child({ commentId: "c_1" }).info("nested");

    expect(sink.records[0]?.fields).toEqual({
      service: "core",
      branch: "main",
      commentId: "c_1",
    });
  });

  it("takes an Error as the second argument to error()", () => {
    const sink = memorySink();
    const boom = new Error("boom");

    createLogger({ sinks: [sink] }).error("failed", boom);

    expect(sink.records[0]?.error).toBe(boom);
    expect(sink.records[0]?.fields).toEqual({});
  });

  it("keeps going when a sink throws", () => {
    const broken: LogSink = {
      name: "broken",
      write: vi.fn(() => {
        throw new Error("sink is down");
      }),
    };
    const working = memorySink();

    expect(() => createLogger({ sinks: [broken, working] }).info("still logged")).not.toThrow();
    expect(working.records).toHaveLength(1);
  });

  it("stamps an ISO 8601 UTC timestamp", () => {
    const sink = memorySink();
    createLogger({ sinks: [sink] }).info("when");

    expect(sink.records[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("streamSink", () => {
  function captured(): { write(text: string): void; lines: string[] } {
    const lines: string[] = [];
    return { lines, write: (text) => lines.push(text) };
  }

  it.each([
    ["a bare message", undefined, /^\S+Z info {2}hello\n$/],
    ["fields as JSON", { branch: "main" }, /^\S+Z info {2}hello {"branch":"main"}\n$/],
  ])("writes one line with %s", (_, fields, expected) => {
    const stream = captured();
    createLogger({ sinks: [streamSink(stream)] }).info("hello", fields);

    expect(stream.lines).toHaveLength(1);
    expect(stream.lines[0]).toMatch(expected);
  });

  it("puts an error's stack after the line", () => {
    const stream = captured();
    createLogger({ sinks: [streamSink(stream)] }).error("failed", new Error("boom"));

    expect(stream.lines[0]).toMatch(/^\S+Z error failed\nError: boom\n/);
  });

  it("still writes the line when the fields cannot be serialised", () => {
    const stream = captured();
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;

    createLogger({ sinks: [streamSink(stream)] }).warn("odd", loop);

    expect(stream.lines[0]).toMatch(/warn {2}odd \[unserialisable fields\]\n$/);
  });
});
