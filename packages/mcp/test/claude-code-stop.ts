/**
 * Stop hook input for tests, built from a payload Claude Code actually sent
 * (`fixtures/claude-code-stop.json`, with ids and paths replaced). A case
 * overrides only the fields it varies, so no test can invent a field the
 * client never sends: that is how the eight-block cap once read a field that
 * did not exist.
 */

import { readFileSync } from "node:fs";

import type { StopHookInput } from "../src/stop-hook.js";

const RECORDED = JSON.parse(
  readFileSync(new URL("fixtures/claude-code-stop.json", import.meta.url), "utf8"),
) as StopHookInput;

/** The recorded payload, as an object, with `overrides` applied. */
export function stopInput(overrides: Partial<StopHookInput> = {}): StopHookInput {
  return { ...RECORDED, ...overrides };
}

/** The recorded payload, as the text Claude Code writes to stdin. */
export function stopStdin(overrides: Partial<StopHookInput> = {}): string {
  return JSON.stringify(stopInput(overrides));
}
