---
"@maple-kit/core": minor
"@maple-kit/mcp": minor
"@maple-kit/lint": minor
---

Comments by an advisory author no longer hold the merge gate or an agent. `decideGate` takes `GateOptions.advisoryAuthors` (author ids), defaulting to the new `ADVISORY_AUTHORS` (`["maple-lint"]`); such comments count toward neither `open` nor `total`, so a lint-only surface neither blocks nor counts as reviewed. Pass `[]` to restore the old behaviour. `isAdvisory` is exported from `@maple-kit/core` and `@maple-kit/core/gate`, and the MCP Stop hook uses it, so a lint pin never keeps an agent from stopping. `LINT_AUTHOR.id` now comes from `ADVISORY_AUTHORS`, so the two cannot drift.

Behaviour change: a comment by author id `maple-lint` that used to block now does not.

`RouteOptions.advisoryAuthors`, `GateContext.advisoryAuthors` and the MCP handlers option carry a custom list to every `decideGate` caller. The route answers 403 to a comment posted by an identity whose id is in that list (the default when unset), so a reviewer cannot take the exemption by choosing that id; `isAdvisory` also requires `provenance: "server"`.
