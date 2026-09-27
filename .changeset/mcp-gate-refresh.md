---
"@maple-kit/mcp": minor
---

`maple-mcp` reads `MAPLE_URL`, the deployed route's mount URL. With it set, `resolve_comment` asks the route's `POST /gate/refresh` to republish `maple/visual-review`, sending the branch and `GITHUB_TOKEN`, and holds no gate credential at all. This replaces `MAPLE_GATE_TOKEN` on a developer machine, where the static installation token stopped working an hour into a session. `MAPLE_GATE_TOKEN` stays for CI, and setting both now fails at startup. A failed refresh is logged to stderr and the resolve is still recorded.
