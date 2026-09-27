---
"@maple-kit/core": minor
"@maple-kit/mcp": patch
---

`maple-mcp` now reports a failed gate publish on resolve. It had no logger, so
an expired `MAPLE_GATE_TOKEN` or a missing `checks: write` left the check on its
old verdict with nothing said. It logs to stderr, since stdout is the MCP
transport.

Core adds `streamSink(stream)` to `@maple-kit/core/logger`: one text line per
record to any `{ write(text) }`, such as `process.stderr`. `consoleSink` could
not serve here because `console.info` writes to stdout.
