/**
 * Where the server's own diagnostics go.
 *
 * stdout carries the MCP protocol, so a stray line there corrupts the session.
 * stderr is what every client captures into its server log.
 */

import { createLogger, streamSink } from "@maple-kit/core/logger";

import type { Logger, TextStream } from "@maple-kit/core/logger";

/** A logger that writes `info` and above to stderr, or to `stream` in tests. */
export function serverLogger(stream: TextStream = process.stderr): Logger {
  return createLogger({ sinks: [streamSink(stream)], fields: { service: "maple-mcp" } });
}
