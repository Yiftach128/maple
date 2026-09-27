import type { LogRecord, LogSink } from "../types.js";

/** Anything with a `write(text)`, such as `process.stderr`. */
export interface TextStream {
  write(text: string): unknown;
}

/** Fields as JSON, or a placeholder when they cannot be serialised. */
function serialise(fields: LogRecord["fields"]): string {
  try {
    return JSON.stringify(fields);
  } catch {
    return "[unserialisable fields]";
  }
}

/** Formats a record as one `ISO level message {fields}` line, stack after. */
function format(record: LogRecord): string {
  const head = `${record.at} ${record.level.padEnd(5)} ${record.message}`;
  const fields = Object.keys(record.fields).length > 0 ? ` ${serialise(record.fields)}` : "";
  const error = record.error ? `\n${record.error.stack ?? String(record.error)}` : "";
  return `${head}${fields}${error}\n`;
}

/**
 * Writes records as text lines to a stream you choose.
 *
 * Use it where the console is the wrong place: under a stdio transport, where
 * `console.info` would land in the protocol on stdout, pass `process.stderr`.
 */
export function streamSink(stream: TextStream): LogSink {
  return {
    name: "stream",
    write(record) {
      stream.write(format(record));
    },
  };
}
