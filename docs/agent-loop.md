# The agent loop

Maple's half of the loop is four MCP tools and one hook. The reviewer's half is
the overlay. Neither knows about the other; they meet in the store.

## The four tools

<!-- generated:mcp-tools -->

| Tool                                             | Reads | What it does                                                                                                                                                                                                              |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_comments(branch, statuses?)`               | ✓     | Return the review comments on a branch, newest first.                                                                                                                                                                     |
| `wait_for_comments(branch, cursor?, timeoutMs?)` | ✓     | Block until a new comment arrives or the wait elapses. Returns status "timeout" rather than failing when nothing arrives.                                                                                                 |
| `resolve_comment(id, sha, note?)`                |       | Mark a comment resolved, recording the commit that addressed it.                                                                                                                                                          |
| `get_comment_context(id, branch)`                | ✓     | Return everything needed to act on one comment: anchor, viewport, surrounding markup and any replay link. A comment written under a Maple Mock carries `mock.recipe` and `mock.replay`, a link to the page in that state. |

<!-- /generated:mcp-tools -->

### A timeout is a result

`wait_for_comments` is a long poll, and every coding client kills a tool call
that outlives its own ceiling — Cursor's ACP path hardcodes 60 seconds and Codex
defaults to the same. So the wait is clamped to 55 seconds and a timeout comes
back as `{ status: "timeout" }` rather than as a failure. An agent that treats
a timeout as an error will stop looping the first time nobody is looking.

### The cursor is a timestamp

Not a page. `wait_for_comments` returns the newest `createdAt` it saw; pass it
back to get only what is newer. Omit it on the first call and the tool drains
whatever is already waiting, so an agent that starts after the reviewer does not
sit waiting for a second comment to notice the first.

## The Stop hook

MCP gives a server no way to interrupt a client, so the loop is closed from the
other end. Claude Code's `Stop` hook runs when the agent believes it is
finished; Maple's answers with the open comments.

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx -y -p @maple-kit/mcp maple-stop-hook" }] }
    ]
  }
}
```

The Maple Claude Code plugin registers this hook itself. It blocks while any
comment is `open` or `needs_reverify`; `resolved` and `orphaned` comments let
the agent stop.

It blocks at most **eight stops in a row**. A hook that can block forever is a
hung session, and the person watching an agent loop has no way out of one. On
the ninth it lets the session end and says what is still open, which is a
better outcome than an agent resolving comments to escape.

Claude Code starts the hook afresh for every stop and says only whether the
last one was blocked (`stop_hook_active`), so the count is kept in a file per
`session_id` under the system temp directory. A stop no block caused starts
it again, and a payload with no session id is blocked once, since a hook that
cannot count cannot promise to give up.

The hook reads its own environment, not the MCP server's: an `env` block in
`.mcp.json` reaches the server and nothing else. `MAPLE_GITHUB_OWNER`,
`MAPLE_GITHUB_REPO` and `GITHUB_TOKEN` have to be set where the client starts,
or the hook fails naming the one that is missing. With neither of the first two
set it lets every stop through: installed with the plugin, it runs in every
project, and most are not reviewed. `MAPLE_BRANCH` defaults to the branch
checked out in the session's working directory.

## Configuration

The client starts an MCP server with no arguments, so the environment is the
only channel there is. A missing value fails at startup rather than on the first
tool call, where a client would show it as a tool error and bury it.

| Variable                                  |                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `MAPLE_STORE`                             | `github`, the default and so far the only one.                     |
| `MAPLE_GITHUB_OWNER`, `MAPLE_GITHUB_REPO` | The repository.                                                    |
| `GITHUB_TOKEN`                            | Server-side only. Never in a file; use `op run --env-file`.        |
| `MAPLE_GITHUB_API`                        | For Enterprise Server.                                             |
| `MAPLE_BRANCH`                            | The branch under review. Read by the Stop hook.                    |
| `MAPLE_URL`                               | The deployed route's mount URL. A resolve asks it to publish.      |
| `MAPLE_GATE_TOKEN`                        | CI only: the gate App's installation token. Not with `MAPLE_URL`.  |
| `MAPLE_GATE_APP_ID`                       | Which App the runs belong to. `docs/gate.md` has the 403 it saves. |
| `MAPLE_REQUIRE_APPROVAL`                  | `true` where the gate is held until somebody approves the preview. |

## Resolving tells the gate

`resolve_comment` used to write the status and stop. The route already
published a verdict after a resolve for the reason `docs/gate.md` gives — a
reviewer who clears the last comment should not wait for a commit nobody needs
to make — and the agent, doing the same thing through a different door, did
not. An agent that resolved the last comment and then had nothing left to push
left `maple/visual-review` holding on work that was done.

It publishes now, through the same `publishGate`, and never throws: the status
is already recorded by the time it runs, and a gate that fails a resolve is
worse than a stale one.

With `MAPLE_URL` set, the server does not publish at all: it asks the route's
`POST /gate/refresh` to, sending the branch and its own `GITHUB_TOKEN`. The
route checks that token can push, decides the verdict from the store and
publishes with the gate App's installation auth, which it re-mints as each
token expires. No gate credential ever reaches the agent's machine;
`docs/github-auth.md` says why that is the line.

`MAPLE_GATE_TOKEN` is the direct way, kept for CI: the gate App's own
installation token, never the store's. It is read once, and an installation
token expires an hour after it is minted, which a job outlives rarely and a
session often. Setting both fails at startup. With neither, nothing is
published and the check moves on the next push. Failures go to stderr.

## What is not here yet

- **Claude Code Channels**, which would let the server wake an idle session
  instead of the agent polling. It is a research preview; the Stop hook and
  `wait_for_comments` work everywhere today.
