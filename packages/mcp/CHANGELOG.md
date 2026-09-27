# @maple-kit/mcp

## 0.12.0

### Patch Changes

- @maple-kit/core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b7a0f25]
- Updated dependencies [2bf7ed3]
- Updated dependencies [b7a0f25]
- Updated dependencies [6ac8d9b]
- Updated dependencies [b7a0f25]
  - @maple-kit/core@0.11.0

## 0.10.0

### Minor Changes

- 1cb2f6f: `get_comment_context` returns `mock: { recipe, replay }` for a comment written
  under a Maple Mock, where `replay` opens the comment's page with the recipe on,
  and adds a `mocked: …` line to `conditions`.
- 264e019: A recipe gains two layers beside `calls`: `flags`, flag keys answered with any
  JSON value, and `as`, who the page is told the reviewer is (a `role`, and
  `permissions` granted or taken away, both in the host's own words).
  `describeIdentity` says an identity in words. The ledger row reads
  `mocked as <identity>`, and `get_comment_context` names the flags and the
  identity and says the server acted as the reviewer.

  **Breaking:** `RECIPE_VERSION` is 2 and every recipe is written as version 2,
  so a build released before it refuses a new link or fence recipe rather than
  applying half of it. Version 1 is still read, and comes back as version 2.

### Patch Changes

- Updated dependencies [0606059]
- Updated dependencies [4493ac7]
- Updated dependencies [2271457]
- Updated dependencies [5d832df]
- Updated dependencies [4b8e7c9]
- Updated dependencies [1cb2f6f]
- Updated dependencies [a02a975]
- Updated dependencies [b66c3c0]
- Updated dependencies [eccf75c]
- Updated dependencies [decec98]
- Updated dependencies [c597ef7]
- Updated dependencies [2abe3f0]
- Updated dependencies [78f0692]
- Updated dependencies [264e019]
- Updated dependencies [9591b2d]
- Updated dependencies [4acc6db]
- Updated dependencies [2abe3f0]
- Updated dependencies [4ae5179]
  - @maple-kit/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [9371621]
- Updated dependencies [8cfc7b5]
  - @maple-kit/core@0.9.0

## 0.8.0

### Minor Changes

- 999dfb6: **Breaking:** `CommentStore` covers all nine `StoreConnector` methods, and the
  route and the MCP server now take one instead of a raw connector.

  `createCommentStore` wrapped three of nine methods and nothing inside Maple
  called it: the SDK route held a raw `StoreConnector` and so did the MCP server,
  so the retry, timeout and `MapleStoreError` layer reached one external caller
  and nothing a reviewer touched. The preview route now has retries.

  What changed for a host:

  - **`RouteOptions.store` takes a `CommentStore`**, as does a `StoreResolver`'s
    return. Wrap the connector: `store: createCommentStore(githubStore({ … }))`,
    or inside the resolver where the store is built per reviewer. A connector
    missing `list` or `append` now fails at construction rather than on the first
    request.
  - **`GateContext.store`** — what `publishGate` takes — and the MCP server's
    `HandlerOptions.store` take a `CommentStore` for the same reason.
  - **`CommentStore` gained `appendMany`, `head`, `watch`, `approvals`,
    `approve` and `unapprove`**, and `setStatus` gained the `resolution`
    argument the connector has taken since 0.5. A capability the connector lacks
    resolves to an absent value — `undefined` for the three reads, `null` for
    `approve`, `false` for `unapprove` — never to an empty one, because
    `decideGate` reads an empty approvals list as "nobody approved" and would
    block for ever on a store that keeps none. `capabilities` reports what the
    connector can do; the return value reports what happened.
  - **A store failure is no longer always a 400.** The route answers `503` when
    the store could not be reached and keeps `400` for a store that refused.
  - **A `RangeError` from a connector is no longer retried**, so a bad cursor or
    a negative limit is refused once rather than three times.

  Nothing changed about what a store connector writes or reads, so a published
  ledger stays readable by every version that could read it before.

  `docs/connectors.md` has the table the wrapper is kept complete against.

### Patch Changes

- Updated dependencies [999dfb6]
  - @maple-kit/core@0.8.0

## 0.7.0

### Minor Changes

- 24adb84: The gate hears about a resolve whoever did it, and `needs_reverify` is reachable.

  `resolve_comment` wrote the status and stopped. The route has published a
  verdict after a resolve since 0.6.0 — a reviewer who clears the last comment
  should not wait for a commit nobody needs to make — and the agent, doing the
  same thing through a different door, did not. An agent that resolved the last
  comment and had nothing left to push left `maple/visual-review` holding on work
  that was done.

  `publishGate` therefore moves from `src/route/gate.ts` to `@maple-kit/core/gate`
  beside the decision, and the MCP server takes an optional `gate` built from
  `MAPLE_GATE_TOKEN`. Without it nothing publishes and the behaviour is what it
  was.

  `decideGate` also gains `reverifyResolved`, which is what makes `needs_reverify`
  reachable at all: nothing in the repository ever wrote that status, so a gate
  that listed it among `BLOCKING_STATUSES` was blocking on a state that could not
  occur. On, a comment resolved against a commit that is no longer the head needs
  another look. Off by default.

  `docs/gate.md` now also states plainly that **nothing writes `orphaned` either**,
  and why the page cannot simply report it.

### Patch Changes

- Updated dependencies [42f6077]
- Updated dependencies [24adb84]
- Updated dependencies [9d3df1b]
- Updated dependencies [f2132fc]
- Updated dependencies [101dd3b]
  - @maple-kit/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [18643c0]
  - @maple-kit/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [f86a5c9]
- Updated dependencies [45a07cc]
- Updated dependencies [f86a5c9]
- Updated dependencies [4b922ba]
- Updated dependencies [bdffcc5]
- Updated dependencies [6e694c2]
  - @maple-kit/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [8cdf898]
- Updated dependencies [64eabf6]
  - @maple-kit/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [f46ab2c]
  - @maple-kit/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [0b484de]
  - @maple-kit/core@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [69fb978]
  - @maple-kit/core@0.1.1

## 0.1.0

### Minor Changes

- 09cbbbd: Implement the MCP server behind the tool contract, and add the Stop hook.

  `maple-mcp` serves `list_comments`, `wait_for_comments`, `resolve_comment` and
  `get_comment_context` over stdio. The wait is clamped to 55 seconds, under
  every client's ceiling, and a timeout comes back as a result rather than an
  error.

  `maple-stop-hook` keeps an agent from finishing while comments are open, and
  gives up after eight attempts rather than hanging the session.

- 3b2edc2: Keep the commit that resolved a comment, instead of returning it and losing it.

  `Comment.resolution` is a `CommentResolution` — the `sha` an agent says
  addressed the comment, an optional `note`, and the `at` it was written. It rides
  through the export fence like every other field, so the default GitHub store
  persists it without a line of storage code.

  `setStatus` takes it as an optional third argument and stays capability-by-
  presence: a store that cannot keep a resolution still records the status.
  `resolve_comment` now passes the `sha` and `note` it has always accepted, and
  the route reads a resolution off the `PATCH` body but stamps `at` itself — a
  client that can date its own resolution can backdate one.

  A comment cannot arrive already resolved, so the route drops a `resolution`
  posted with a new comment, and the shared store contract asserts a resolution
  survives a re-read.

### Patch Changes

- 417376e: Every package publishes its licence, its notice and a readme. `files` was
  `["dist"]` and the three texts lived only at the repository root, so the
  artifact met none of Apache-2.0's redistribution terms and every npm page would
  have been blank.

  `@maple-kit/core` no longer carries a private copy of vitest. `/testing` imports
  `describe`, `it` and `expect` for the shared connector contract suite, and with
  vitest undeclared the build wrote it — and chai, expect-type, magic-string and
  tinybench — into `dist/node_modules/`, about half the tarball. Worse than the
  size: the suite registered its tests against that copy rather than the runner
  the consumer invoked, so it collected nothing. vitest is an optional peer
  dependency now, and running the contract suite means running it in your vitest.

- 567b444: Ship the docs in the type declarations and not in the JavaScript.

  Prose was about 46% of `@maple-kit/ui`'s gzipped weight, which is weight every
  application downloads to read something no runtime looks at. Every package's
  build now drops JSDoc from the emitted JavaScript and keeps it in the `.d.ts`,
  which is what an editor reads anyway.

  Two kinds of comment are kept deliberately. `@__PURE__` and
  `@__NO_SIDE_EFFECTS__` stay, because dropping them would silently cost
  tree-shaking. Legal notices stay, and the two ported files in
  `packages/core/src/lib/` are now marked `@preserve` so their BSD-2-Clause and
  MIT attributions reach the published build, which those licences require.

- Updated dependencies [bbb7433]
- Updated dependencies [8038da7]
- Updated dependencies [061766e]
- Updated dependencies [1cb6bcc]
- Updated dependencies [f99659d]
- Updated dependencies [8dd0e2e]
- Updated dependencies [038f2c7]
- Updated dependencies [cf9bd03]
- Updated dependencies [991363a]
- Updated dependencies [417376e]
- Updated dependencies [74adfe4]
- Updated dependencies [8c26051]
- Updated dependencies [473898c]
- Updated dependencies [3b2edc2]
- Updated dependencies [40f2ee4]
- Updated dependencies [22f0fc5]
- Updated dependencies [7181bfd]
- Updated dependencies [7212b52]
- Updated dependencies [02dadef]
- Updated dependencies [657204d]
- Updated dependencies [aed6bc7]
- Updated dependencies [16957ec]
- Updated dependencies [74adfe4]
- Updated dependencies [2d5eb8d]
- Updated dependencies [fbe201b]
- Updated dependencies [f09d860]
- Updated dependencies [25c47f5]
- Updated dependencies [d2f84b7]
- Updated dependencies [5eec274]
- Updated dependencies [a96ffa4]
- Updated dependencies [69ba1e5]
- Updated dependencies [567b444]
- Updated dependencies [16f5582]
- Updated dependencies [9fcecc0]
- Updated dependencies [33c1689]
- Updated dependencies [55dddc9]
- Updated dependencies [bf6e1ea]
  - @maple-kit/core@0.1.0
