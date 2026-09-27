#!/usr/bin/env node
import { branchFromEnvironment, storeFromEnvironment } from "./config.js";
import { createToolHandlers } from "./handlers.js";
import {
  currentBranch,
  decideSessionStop,
  fileBlockCounter,
  parseStopHookPayload,
} from "./stop-hook-session.js";

/** Claude Code writes the hook's payload to stdin and reads the decision from stdout. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const payload = parseStopHookPayload(await readStdin());
const env = process.env;

// Installed with the plugin, the hook runs in every project; one naming no
// Maple repository is not reviewed, and gets no error on every stop.
if (!env["MAPLE_GITHUB_OWNER"] && !env["MAPLE_GITHUB_REPO"]) {
  process.stdout.write("{}");
} else {
  const branch = branchFromEnvironment({
    ...env,
    MAPLE_BRANCH: env["MAPLE_BRANCH"] || currentBranch(payload.cwd ?? process.cwd()),
  });
  const handlers = createToolHandlers({ store: storeFromEnvironment(env) });
  const open = await handlers.listComments({ branch, statuses: ["open", "needs_reverify"] });
  process.stdout.write(JSON.stringify(decideSessionStop(open, payload, fileBlockCounter())));
}
