# @maple-kit/classifier

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

- 2271457: `jevClassifier().plan(request)` reads a mock request in one System One call: a
  `choice` over the plan states and one `noul` question per call, with jev's own
  probabilities kept as the distribution and each call's `p`. `timeoutMs`
  (default 8000) sets how long any judgement may take.
- decec98: A mock plan sets flags and who the page is shown as. `MockPlanRequest` takes
  the page's `flags` (`{ key, type, variants? }`) and the host's `roles`, and
  `MockPlan` answers one `PlannedFlag` per flag and a `PlannedRole`. The route
  adds the roles from its own identity rules, drops a flag with no values, and
  keeps an answer to what was listed. `readPlan` carries named flags and a role
  on each suggestion, or as a suggestion of their own. The keyword planner reads
  them without ever taking a key from the sentence, `jevClassifier` asks for them
  in a second request so the state and calls are judged as before, the box sends
  the flags it saw and applies a layered chip, and `maple mock plan` prints them.
  `plannedFlag` and `flagValues` are exported from `@maple-kit/core/connectors`,
  and `memoryClassifier` takes `planFlags` and `planRole`.

  **Breaking:** `MockSuggestion.state` is optional, since a chip may name only a
  flag or a role, and `createMockPlanner` takes the route's mock schemas rather
  than a shapes lookup.

### Patch Changes

- eccf75c: The plan picks `long`, `sparse` and `mixed`. `MOCK_PLAN_STATES` is
  `MOCK_STATES` plus `none` again, and `MOCK_PLAN_STATE_DESCRIPTIONS` describes
  the three, which is what jev judges against. `keywordClassifier()` reads
  "truncated", "no avatar" and "every status", among others. "long" and
  "overflow" now read as `long`; `many` keeps "a long list" and "overflows
  with".

  `stateFromWeights` spreads a fixed prior of 1.4 across the states rather than
  0.2 each, so a single matched word stays above `PLAN_FLOOR` with nine states.

  **Breaking:** `MockPlanState` gains the three states, so a
  `Record<MockPlanState, …>` needs them.

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

### Minor Changes

- bdffcc5: Score a comment with a model: `@maple-kit/classifier` and its jev provider

  A new package, `@maple-kit/classifier`, exports `jevClassifier()` — a
  `ClassifierConnector` backed by a System One decision model. Every pillar's
  question and the kind's travel in one request, because that is what makes
  scoring a comment as it is typed affordable. It returns the provider's own
  probabilities and confidence rather than a spread re-derived from a position.

  It peers on the Effect v4 release candidate, which is the line carrying the
  TypeSafe provider. `@maple-kit/core` stays on Effect v3 and nothing published
  there changes shape. Effect appears nowhere on the new package's boundary; a
  lint rule keeps it under `src/internal/`.

  **Breaking, in core:** `ClassifierRequest` gains an optional `signal`, so a
  judgement can be abandoned when the next keystroke makes it stale. Abort
  belongs with the fetch that needs it, which is the provider's. Nothing that
  implements the interface has to change; a connector reaching a network should
  honour it.

  Core also gains `COMMENT_KIND_DESCRIPTIONS`, the vocabulary's own definition of
  each kind, so two providers cannot quietly recognise two different sets of
  `bug`.

  `@maple-kit/classifier` joins the fixed version group with the other five
  packages, so it versions with them.

### Patch Changes

- Updated dependencies [f86a5c9]
- Updated dependencies [45a07cc]
- Updated dependencies [f86a5c9]
- Updated dependencies [4b922ba]
- Updated dependencies [bdffcc5]
- Updated dependencies [6e694c2]
  - @maple-kit/core@0.5.0
