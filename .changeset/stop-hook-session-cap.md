---
"@maple-kit/mcp": minor
---

`maple-stop-hook` now gives up after eight blocked stops in a row under Claude Code. It used to count a `blocks` field Claude Code never sends, so it blocked for as long as a comment stayed open. The count is now kept per `session_id` in the system temp directory and starts again on any stop that `stop_hook_active` says no block caused.

The hook also defaults `MAPLE_BRANCH` to the branch checked out in the session's working directory, and lets every stop through when neither `MAPLE_GITHUB_OWNER` nor `MAPLE_GITHUB_REPO` is set, so it can ship in the Claude Code plugin without failing in projects Maple does not review.

Breaking: `decideStop(open, blocks)` takes the number of blocks so far instead of a `StopHookInput`, and `StopHookInput` now describes Claude Code's real Stop payload (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `stop_hook_active`, …) without `blocks`. `decideSessionStop`, `fileBlockCounter`, `parseStopHookPayload` and `currentBranch` are new exports.
