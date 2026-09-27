/**
 * Each tool's arguments.
 *
 * The descriptions are read by agents, where the wording does as much work as
 * the type, so they are written rather than generated. zod is the MCP SDK's
 * own schema language and is already in its dependency tree; this package
 * takes it directly rather than reaching through the SDK for it.
 */

import { z } from "zod";

const branch = z
  .string()
  .describe(
    "Head branch of the pull request the comments are on, such as `feat/login`. Not a pull request number.",
  );
const id = z.string().describe("The comment's id.");

/** Argument shapes, by tool name. */
export const SHAPES = {
  list_comments: {
    branch,
    statuses: z
      .array(z.enum(["open", "resolved", "needs_reverify", "orphaned"]))
      .optional()
      .describe("Only these states. Omit for all of them."),
  },

  wait_for_comments: {
    branch,
    cursor: z
      .string()
      .optional()
      .describe(
        "Timestamp from a previous call. Only comments newer than this are returned; " +
          "omit it to drain everything already there.",
      ),
    timeoutMs: z
      .number()
      .optional()
      .describe("How long to wait. Clamped to 55 seconds, under every client's ceiling."),
  },

  resolve_comment: {
    id,
    sha: z.string().describe("Commit you believe addresses it."),
    note: z.string().optional().describe("What you changed, for the reviewer."),
  },

  get_comment_context: { id, branch },
} as const;
