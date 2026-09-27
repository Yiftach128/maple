# @maple-kit/mcp

The Model Context Protocol server that hands a coding agent the review comments
[Maple](https://github.com/maple-kit/maple) collected on a preview deployment.

**Pre-release.** Every package here is 0.x and makes no compatibility promise.

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/agentic-tooling.gif" alt="A terminal: the agent waits for comments, receives one naming a file and line, edits one line, and resolves the comment in a commit." width="480">
</p>

The agent waits for a comment, reads it with its context — `file:line` from
the tagger, the viewport, the screenshot, the mock it was written under — makes
the change, and resolves it against the commit that fixed it. The reviewer's
half is the overlay; the two meet in the store.

## Install

```sh
npm install @maple-kit/mcp
```

Two binaries ship: `maple-mcp`, the server, and `maple-stop-hook`, which stops
an agent from calling itself finished while comments are still open.

## Connect an agent

A client starts the server with no arguments, so it is configured through the
environment. In Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "maple": {
      "command": "npx",
      "args": ["-y", "-p", "@maple-kit/mcp", "maple-mcp"],
      "env": { "MAPLE_GITHUB_OWNER": "acme", "MAPLE_GITHUB_REPO": "web" }
    }
  }
}
```

and run the client under `op run --env-file` so `GITHUB_TOKEN` never lands in a
file. A missing value fails at startup rather than on the first tool call.

| Variable                                  | What it is                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `MAPLE_GITHUB_OWNER`, `MAPLE_GITHUB_REPO` | The repository.                                                          |
| `GITHUB_TOKEN`                            | Server-side only. Never in a file.                                       |
| `MAPLE_STORE`                             | `github`, the default and so far the only one.                           |
| `MAPLE_GITHUB_API`                        | For GitHub Enterprise Server.                                            |
| `MAPLE_BRANCH`                            | The branch under review. Read by the Stop hook, not the server.          |
| `MAPLE_GATE_TOKEN`, `MAPLE_GATE_APP_ID`   | The gate App's installation token and id, so a resolve updates the gate. |
| `MAPLE_REQUIRE_APPROVAL`                  | `true` where the gate is held until somebody approves the preview.       |

## Tools

| Tool                                             | What it does                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `list_comments(branch, statuses?)`               | Every comment on the branch in every status, newest first, unless `statuses` narrows it — pass `["open"]` for the open ones. |
| `wait_for_comments(branch, cursor?, timeoutMs?)` | Blocks for up to 55s, then returns `timeout` rather than an error.                                                           |
| `get_comment_context(id, branch)`                | The anchor, the viewport and what the reviewer was looking at, and the mock they wrote it under with a link that replays it. |
| `resolve_comment(id, sha, note?)`                | Closes a thread against the commit that closed it, and publishes the gate's verdict.                                         |

`wait_for_comments` is clamped to 55 seconds because every coding client cuts a
tool call off at 60, and it emits `notifications/progress` every 15 seconds. A
timeout is a result: an agent that treats one as an error stops looping the
first time nobody is looking. Its cursor is a timestamp; omit it on the first
call to drain whatever is already waiting.

## The Stop hook

MCP gives a server no way to interrupt a client, so the loop is closed from the
other end. Claude Code's `Stop` hook runs when the agent believes it is
finished, and Maple's answers with the comments still open:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx -y -p @maple-kit/mcp maple-stop-hook" }] }
    ]
  }
}
```

It blocks at most eight times. On the ninth it lets the session end and says
what is still open, which beats an agent resolving comments to escape.

**The hook does not see `.mcp.json`'s `env`.** That block is handed to the MCP
server alone; a hook runs in the client's own environment. So
`MAPLE_GITHUB_OWNER`, `MAPLE_GITHUB_REPO`, `GITHUB_TOKEN` and `MAPLE_BRANCH`
have to be set where the client itself starts — under the same
`op run --env-file` — or the hook fails at startup naming the one missing.

## Resolving clears the gate

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/merge-gate.gif" alt="A pull request's checks: maple/visual-review fails with two comments open, they resolve, the check passes and the merge button wakes up." width="480">
</p>

With `MAPLE_GATE_TOKEN` set, `resolve_comment` publishes `maple/visual-review`
the way the overlay does, so an agent that resolves the last comment with
nothing left to push does not leave the check holding on finished work.

The server reads that token once, as a string, and a GitHub App installation
token expires an hour after it is minted. Past that, a resolve is still
recorded but the gate update fails, and nothing logs it. Mint a fresh token
for each session; the server does not mint its own yet.

## Documentation

- [The agent loop](https://github.com/maple-kit/maple/blob/main/docs/agent-loop.md)
- [The merge gate](https://github.com/maple-kit/maple/blob/main/docs/gate.md)
- The `maple-review` skill turns a pull request's ` ```maple ` comments into a worklist without the server.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
