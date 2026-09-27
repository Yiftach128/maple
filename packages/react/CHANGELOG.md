# @maple-kit/react

## 0.12.0

### Patch Changes

- @maple-kit/core@0.12.0
  - @maple-kit/mock@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b7a0f25]
- Updated dependencies [2bf7ed3]
- Updated dependencies [b7a0f25]
- Updated dependencies [6ac8d9b]
- Updated dependencies [b7a0f25]
  - @maple-kit/core@0.11.0
  - @maple-kit/mock@0.11.0

## 0.10.0

### Minor Changes

- 5fc5eb1: `useMock()` at the new `@maple-kit/react/mock` entry: one subscription over
  Maple Mock's box controller, which it builds and starts for the component's
  lifetime or reads from a `client` the caller owns.

### Patch Changes

- Updated dependencies [0606059]
- Updated dependencies [4493ac7]
- Updated dependencies [2271457]
- Updated dependencies [5d832df]
- Updated dependencies [4b8e7c9]
- Updated dependencies [1cb2f6f]
- Updated dependencies [d9ff194]
- Updated dependencies [a02a975]
- Updated dependencies [50f80c9]
- Updated dependencies [7ace7e4]
- Updated dependencies [5fc5eb1]
- Updated dependencies [4493ac7]
- Updated dependencies [7ff6fd9]
- Updated dependencies [b66c3c0]
- Updated dependencies [13fe029]
- Updated dependencies [59e5de3]
- Updated dependencies [111360f]
- Updated dependencies [a939399]
- Updated dependencies [a93dc26]
- Updated dependencies [8707fda]
- Updated dependencies [eccf75c]
- Updated dependencies [decec98]
- Updated dependencies [1b2b4ae]
- Updated dependencies [d57cb19]
- Updated dependencies [c597ef7]
- Updated dependencies [2d13012]
- Updated dependencies [4acc6db]
- Updated dependencies [c62cad0]
- Updated dependencies [2abe3f0]
- Updated dependencies [78f0692]
- Updated dependencies [264e019]
- Updated dependencies [9591b2d]
- Updated dependencies [4acc6db]
- Updated dependencies [2abe3f0]
- Updated dependencies [4ae5179]
  - @maple-kit/core@0.10.0
  - @maple-kit/mock@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [9371621]
- Updated dependencies [8cfc7b5]
  - @maple-kit/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [999dfb6]
  - @maple-kit/core@0.8.0

## 0.7.0

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

- 69ba1e5: Let a reviewer link their GitHub account from the overlay.

  `ClientState.github` carries the link, and it has four states rather than a
  boolean. `unsupported` is a route that serves no sign-in at all, which is a
  deployment storing comments some other way — not a reviewer who has not linked.
  A surface draws nothing for the first and an offer for the second, so the two
  must not collapse.

  `MapleClient` gains `linkGitHub()` and `unlinkGitHub()`. The first resolves as
  soon as there is a code to show and keeps polling after it; watch `github` for
  the rest. The wait is here rather than in a held-open request, because a person
  takes minutes to read a code, reach github.com and type it.

  `@maple-kit/react` gains `useGitHubLink()`. `@maple-kit/ui` gains
  `Maple.Account`, the row the settings panel now opens with: the offer, the code
  and where to type it, or the account and a way to forget it here. It says
  plainly that forgetting the token is not revoking the authorisation, because a
  reviewer who thinks it is will not revoke.

  **Breaking:** `Transport.me()` returns `{ user, github? }` rather than the user
  alone, so the link state travels with the identity it belongs to.

  The island's bundle budget goes from 21 KB to 22 KB gzipped. It was at 21.0 with
  this row in it, which is not a number to leave a build standing on.

- caec174: Add `@maple-kit/react`, the React binding over the reviewer controller.

  `MapleProvider` puts one `@maple-kit/core/client` controller in scope and starts
  it in an effect, so nothing reaches `document`, `localStorage` or the route
  while React renders. `useMaple`, `useComments`, `useComposer`, `usePicker`,
  `useAnchor`, `useDraft` and `useMapleClient` are each one `useSyncExternalStore`
  over it and nothing more — the state machine stays in core, where a Svelte or
  Astro binding can reach it without a rewrite.

  Every derived read is cached against the state it came from, so a keystroke in
  the composer does not re-render every mark on the page. `getServerSnapshot` is
  that same read: an application that renders on the server gets the idle state
  rather than a crash.

  React is a peer dependency, 18 or 19. This package never depends on
  `@maple-kit/ui`, so an application rendering comments in its own design system
  pulls in none of the composed parts.

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
