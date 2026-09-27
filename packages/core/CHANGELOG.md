# @maple-kit/core

## 0.12.0

No changes in this release.

## 0.11.0

### Minor Changes

- b7a0f25: Pressing `c` while a pick is armed moves to the next kind (element, text,
  region), so the key that starts a comment also changes its kind. `c` from
  nothing arms the kind armed last, which is remembered per origin as
  `StoredPreferences.lastPick`.

  Breaking: `t` no longer cycles. `watchPickKeys` in `@maple-kit/core/overlay`
  takes only `onCancel`, since `onCycle` is gone and the controller owns the key.
  `PICK_ORDER` moved from `@maple-kit/ui`'s island language to
  `@maple-kit/core/client`. `writePreferences` now merges into what was stored
  instead of replacing it, so changing the theme no longer drops the stored
  assist choice.

- 2bf7ed3: Pressing `c` with text already selected on the page opens the composer on that
  passage, as if it had been selected through Maple's text pick. A text pick
  armed over an existing selection commits that selection straight away, which
  also covers arming Text from the island. A text pick taken from a selection is
  not remembered as the viewer's chosen kind, so the next `c` with nothing
  selected still arms the kind they picked last. `selectedText()` in
  `@maple-kit/core/overlay` takes an optional document.
- b7a0f25: A started client reads the branch's comments again every 15 seconds, so a
  comment an agent resolved shows as resolved without a reload. A hidden tab
  makes no requests and asks again as soon as it is shown. A failed read keeps
  the last list and only logs a warning, and a list changed locally while the
  read was in flight is kept. `MapleClientOptions.pollMs` sets the interval
  (`0` turns it off), and `MapleClient.refresh()` runs one quiet read.
- 6ac8d9b: Apply and reload, and Turn off, in the mock box and its banner reload the page
  without the browser's "Leave site?" dialog, even while a comment draft is
  open. The reviewer chose to reload, and the draft is saved first as it always
  was. `navigateOnPurpose(view, url)` joins `@maple-kit/core/client` for any
  surface that navigates on the reviewer's say-so; Discard in the leave prompt
  uses it too.

### Patch Changes

- b7a0f25: A comment on one of two copies of a component (a `planned` badge in each of two
  cards, with the same source line, name and text) now comes back on the copy
  that was picked. Before, the first copy on the page won every time. When
  several elements match the key, source or component rung, each one is now
  scored with the text recorded around it. An exact tie falls to the recorded
  offset, then to the recorded selector.

## 0.10.0

### Minor Changes

- 0606059: `ClassifierConnector.plan?(request)` reads a mock request as a plan: the state
  it names (or `none`), a distribution over the states, a confidence, and one
  verdict per call the route made. `keywordClassifier()` and `memoryClassifier()`
  implement it, `runClassifierContract` checks it, and `MOCK_PLAN_STATES`,
  `stateFromWeights` and `plannedCall` serve a planner with no probabilities of
  its own.

  **Breaking:** `CONNECTOR_METHODS.classifier` lists `plan`, so a
  `CapabilityReport<"classifier">` has a `plan` field, and `memoryClassifier()`
  defines `plan` unless `methods` leaves it out.

- 4493ac7: A comment written while a mock is on records it as `context.mock`: the recipe's
  calls and states, its route and the sentence behind it. `captureContext` reads
  it through `activeRecipe()`, which finds `@maple-kit/mock`'s handle by
  `MOCK_HANDLE_KEY` without importing it. The fence reads the recipe through
  `parseRecipe` and drops one it cannot read, sheds it first when over budget
  (the new `"mock"` reduction), and the ledger row says `mocked`. The fence stays
  version 1.
- 2271457: `MOCK_PLAN_STATE_DESCRIPTIONS` says what each plan state means, in the words a
  model is asked to judge against, so two planners cannot read `empty` two ways.
- 5d832df: `readPlan(plan)`, `PLAN_FLOOR` and `PLAN_TIE` in `@maple-kit/core/mock` are the
  calm-UI gate over a mock plan, shared by the mock box and `maple mock plan`:
  nothing under 0.4 confidence, two suggestions when the runner-up is within
  0.15, `unnamed` for a sentence that names no state.
- 4b8e7c9: `readSchemaDocument(document)` reads the `x-maple-mock` extension that
  `maple mock schema` stamps on a document, so the route takes the file as it is.
- 1cb2f6f: `encodeRecipe`, `decodeRecipe`, `linkRecipe` and `RECIPE_PARAM` move to
  `@maple-kit/core/mock`, beside the recipe whose wire format they are, so a
  server replaying a comment's mock builds the same link the page reads.

  **Breaking:** `@maple-kit/mock` no longer exports them; import them from
  `@maple-kit/core/mock`.

- a02a975: Three body states join `empty`, `one` and `many`: `long` (every text as long
  as the page could receive, from its own characters, and every number at its
  widest), `sparse` (everything that may be missing is missing) and `mixed` (a
  list covering every enum value, both booleans, null and set, absent and
  present, short and long text). `MOCK_STATES` lists them last, the recipe stays
  version 2, and the mock box shows a button for each.

  **Breaking:** a 0.9.0 reader refuses a recipe naming one of them, as it refuses
  any state it does not know. They ship in the same release as the version-2
  recipe, which no released reader has seen either.

  `MOCK_PLAN_STATES` is now its own list rather than `MOCK_STATES` plus `none`,
  and `MockPlanState` is its element type: the plan does not pick the three new
  states until its evals measure them.

- b66c3c0: `RouteOptions.mock.identity` declares who a reviewer is for a recipe's `as`:
  the call that says so, its role and permission fields by dotted path, and what
  each call needs (`requires`). `GET {base}/mock/identity` serves the rules with
  each vocabulary filled in from the call's shape, gated as `/mock/schema` is.
  `identityRules` and `isIdentityRules` are in `@maple-kit/core/mock`.
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

- c597ef7: A server can read the mock recipe. While a recipe has `flags` or `as`, a
  preview's page keeps them in a `maple-mock` cookie (set by the interceptor on
  install and by the box on Apply, cleared on Turn off), and
  `requestRecipe(request)` from the new `@maple-kit/mock/server` subpath reads it,
  or a `?maple-mock=` link in the request's own URL. The cookie never carries
  `calls`, and is not written when it would exceed 4096 bytes; the interceptor
  warns instead.

  Core adds `RECIPE_COOKIE`, `RECIPE_COOKIE_LIMIT`, `recipeCookie` and
  `readRecipeCookie` to `@maple-kit/core/mock`.

  **Breaking:** `MockView.location` must also carry `protocol`, so the cookie is
  `Secure` over HTTPS. `window` already does.

- 2abe3f0: `m` is a second bare-key shortcut, `MOCK_SHORTCUT`, checked by `opensMock`.
  Both shortcuts now read where the key landed from `composedPath()`, so typing
  `c` into a field inside a shadow root no longer starts a pick.
- 264e019: A recipe gains two layers beside `calls`: `flags`, flag keys answered with any
  JSON value, and `as`, who the page is told the reviewer is (a `role`, and
  `permissions` granted or taken away, both in the host's own words).
  `describeIdentity` says an identity in words. The ledger row reads
  `mocked as <identity>`, and `get_comment_context` names the flags and the
  identity and says the server acted as the reviewer.

  **Breaking:** `RECIPE_VERSION` is 2 and every recipe is written as version 2,
  so a build released before it refuses a new link or fence recipe rather than
  applying half of it. Version 1 is still read, and comes back as version 2.

- 9591b2d: `POST {base}/mock/plan` reads a reviewer's sentence as a mock plan, through
  `RouteOptions.mock.plan = { classifier, cacheSize?, rate? }`. It answers 404
  unless `mock.preview` is true and the classifier defines `plan`, 401 to a
  reviewer the identity connector does not resolve, and adds what each call's
  shape says it returns to the summary the classifier reads. It shares
  `/assist`'s cache and per-reviewer limiter code.

  **Breaking:** `AssistRate` is renamed `RateLimit`, since `/mock/plan` takes one
  too.

- 4acc6db: `RouteOptions.mock = { preview, schemas }` serves Maple Mock's shapes at
  `GET {base}/mock/schema?key=…`, per call, only on a preview that switched it
  on and only to a reviewer the identity connector resolves. `@maple-kit/core/mock`
  gains the wire format, `Shape`, `JsonSchema` and `SHAPE_SOURCES`, and
  `createShapeIndex`, which normalises REST and tRPC OpenAPI documents into one
  shape per call key.
- 2abe3f0: **Breaking:** `RouteOptions.store` is optional. Without one, the comment and
  approval endpoints answer 404, the way `/assist` does without a classifier, so
  a host that only mocks can mount the route. Code that reads `options.store`
  off a `RouteOptions` now has to handle `undefined`.

### Patch Changes

- 78f0692: Each call in the mock box has one button naming its state instead of nine
  segmented buttons. It opens a menu of Real, marked with a green dot as what the
  page does on its own, and the nine states; arrow keys move through it, and
  scrolling the box closes it. `watchEscape` from `@maple-kit/core/client` now
  leaves an open `popover="auto"` its own Escape, so Escape inside the menu
  closes the menu and not the box. `ChevronIcon` joins `@maple-kit/ui/icons`.
- 4ae5179: `/mock/plan` describes a call's schema past a local `$ref`, naming the
  component it points at (`User: id, name, since`), and no longer repeats names
  the page already sent.

## 0.9.0

### Minor Changes

- 9371621: A recipe can name the route pattern it applies on: `route: "/projects/:id"`.
  `parseRecipe` accepts it, and a recipe with a route mocks nothing on any other
  route. A recipe without one applies everywhere, as before.
- 8cfc7b5: **New package, `@maple-kit/mock`**, and a new core subpath,
  `@maple-kit/core/mock`: the first piece of Maple Mock (#166).

  `@maple-kit/core/mock` exports the recipe — the record of which calls a mock
  rewrites and into which state — with `parseRecipe`, `InvalidRecipeError`,
  `MOCK_STATES` and `RECIPE_VERSION`.

  `@maple-kit/mock` reads and writes an active recipe: `readRecipe`,
  `saveRecipe`, `forgetRecipe`, `linkRecipe`, `encodeRecipe` and `decodeRecipe`.
  Its `./install`, `./msw` and `./node` entries exist and are empty; the
  interceptor and codecs land next.

  Nothing existing changed.

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

## 0.7.0

### Minor Changes

- 42f6077: A reviewer can approve a preview, and a gate can require one.

  `decideGate([])` clears, which means a pull request nobody opened the preview
  for reads exactly like one a designer looked over and liked. `requireApproval`
  is the opt-in that separates them: on, a surface with nothing open blocks with
  the new `awaiting-approval` reason until somebody presses **Approve** in the
  overlay, and the clear verdict then names who signed off.

  **Breaking:** `StoreConnector` gains three optional methods — `approvals`,
  `approve` and `unapprove` — so `CONNECTOR_METHODS.store` and anything asserting
  on `capabilitiesOf("store", …)` now report them. `GateReason` gains
  `awaiting-approval` and `approval-untracked`, so an exhaustive switch over it
  needs two more arms. `GET /me` answers with an `approval` field.

  An approval is about a commit, never a branch: the route reads the sha from
  `store.head` rather than from the browser, for the reason `docs/gate.md` gives
  about the gate App's `Checks: write`. An approval nobody can be named for is
  refused with a 401, so `requireApproval` needs an identity connector.

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

- 9d3df1b: `githubGate` no longer tries to update a check run another GitHub App created.

  The action publishes at push time as GitHub Actions and the route publishes at
  resolve time as Maple's own App. A check run may only be modified by the App
  that made it, so the second publisher was answered with
  `403 Invalid app_id … check run can only be modified by the GitHub App that
created it` — and because a gate publish must never fail a resolve, that failure
  was caught, logged and invisible. The check simply never moved.

  `GitHubGateOptions.appId` names this App. Given it, the gate considers only its
  own runs and posts a new one to supersede anyone else's, leaving theirs
  untouched. Without it the behaviour is unchanged, which is correct when a single
  publisher owns the check.

  Found by driving the loop by hand against a live repository, not by a test:
  every test until now had exactly one publisher.

- f2132fc: One Maple comment per pull request, reposted rather than edited.

  `githubStore` wrote one issue comment per visual comment. Ten comments were ten
  comments on the pull request, and the review underneath them was unreadable.
  Everything Maple keeps now lives in one ledger comment: a table of every visual
  comment, the sign-offs under it, and one fence holding all of them.

  Collapsing them costs the notification an edit does not send, so a write that
  is news — a new comment, a new approval — posts the rebuilt ledger and deletes
  the old one, landing at the bottom of the thread. A resolve or a withdrawal
  edits in place, because announcing what a reviewer just clicked is noise. The
  new comment is created before the old one is deleted: the other order loses
  every comment if the process dies between the two calls.

  **Breaking:** a comment id is now `gh_<pull>_<n>`, where `n` is a per-pull
  sequence rather than the issue comment's own id — the ledger's id changes on
  every repost, so an id built from it would not survive one. Ids written by an
  earlier version no longer resolve. `ParsedFence` gains `approvals`,
  `ExportOptions` gains `approvals`, and the markdown table gains a `Status`
  column once any comment is not open.

- 101dd3b: A comment is a draft until it is published.

  Maple posted the moment a reviewer pressed the button. A review is a pass over
  a page rather than a single remark, so four findings were four notifications
  and — since the pull-request ledger — four reposts. The composer now offers
  **Keep** and **Publish**, and the island grows an **Unsent** section: what is
  waiting, one control that publishes all of it, and a **Copy** that puts every
  unsent comment on the clipboard as markdown, which is the way out of a
  deployment whose store is down or absent.

  Batching only works if losing a batch is hard, so `beforeunload` is now
  attached whenever anything is unpublished rather than only while the composer
  is dirty, and `confirmOnUnload` defaults to on.

  **Breaking:**

  - `MapleClient.send()` is gone. `publish(ids?)` replaces it and returns every
    comment it stored; `keepDraft()` closes the composer without publishing.
  - `discardDraft` takes an optional id, so a row can drop a draft the composer
    is not on.
  - `ClientState` gains `publishing`; `FailedCall` is unchanged, a failed publish
    still reports `send`.
  - `Maple.Actions` exports `KEEP_LABEL` and `PUBLISH_LABEL` in place of
    `CANCEL_LABEL` and `SEND_LABEL`.
  - `StoreConnector.appendMany` is a new optional method, so
    `capabilitiesOf("store", …)` reports one more key.
  - `POST /comments` accepts an array and answers `{ comments }` for one.

## 0.6.0

### Minor Changes

- 18643c0: `githubGate` no longer tries to update a check run another GitHub App created.

  The action publishes at push time as GitHub Actions and the route publishes at
  resolve time as Maple's own App. A check run may only be modified by the App
  that made it, so the second publisher was answered with
  `403 Invalid app_id … check run can only be modified by the GitHub App that
created it` — and because a gate publish must never fail a resolve, that failure
  was caught, logged and invisible. The check simply never moved.

  `GitHubGateOptions.appId` names this App. Given it, the gate considers only its
  own runs and posts a new one to supersede anyone else's, leaving theirs
  untouched. Without it the behaviour is unchanged, which is correct when a single
  publisher owns the check.

  Found by driving the loop by hand against a live repository, not by a test:
  every test until now had exactly one publisher.

## 0.5.0

### Minor Changes

- f86a5c9: `POST /api/maple/assist`: a comment judged as it is typed

  A new route arm and the client loop over it. The endpoint lives in
  `src/route/assist.ts` rather than in the dispatcher, because it owns state a
  dispatcher has no business holding: a cache, so a pause and a retype cost one
  call, and a per-session limiter, so a stuck client cannot spend a model budget.
  `RouteOptions.assist` switches the whole tier on; without it `/assist` answers
  404 and nothing about the composer changes.

  On the client, `ComposerState.assist` carries the judgement and
  `ClientState.assist` carries what this deployment can judge, read off `/me` so a
  card has its pillars before it has any scores. The loop debounces over the value
  the composer already debounces into drafts, aborts the request in flight on the
  next keystroke, and **swallows a failure**: the field keeps working and the
  score just does not arrive.

  `maple-assist=off` joins the precedence chain the interface already has — query
  string, then the viewer's stored preference, then props, then the default — and
  `MapleClient.setAssist` is the viewer's own switch.

  **Breaking:** `ComposerState` gains a required `assist`, and `MapleConfig` gains
  a required `assist`. Anything constructing either literal has to add the field;
  `ASSIST_IDLE` is exported for the first.

- 45a07cc: The score card, in the context card's slot

  `Maple.Score` draws how the comment being typed reads and what kind it looks
  like, in the slot the context card folds out of. It renders from `ComposerState`
  and holds nothing of its own.

  **A pillar is one slot per rung, filled by the probability that rung took.**
  Equal widths keep _which_ rung it is readable and the fill says how sure it
  was, so three pale slots are visibly a shrug and one solid slot is an answer.
  That is what makes the confidence legible with no key beside it — a low
  confidence drawn as a fact is a lie, and a number beside a bar is a key.

  The rows are laid out before there is anything to put in them, so nothing under
  the card moves as the scores land, and there is no spinner per pillar: five
  things moving beside a field somebody is typing in is worse than five still
  ones.

  **The kind is a control, not a verdict.** A reviewer's own label beats any
  classifier, so the chip starts on the guess and is never stuck on it. An unsure
  guess names both kinds it was torn between — "bug or request" — which says it
  is unsure without a number. The choice lives in `ComposerState` and does not
  yet reach the posted comment; carrying it there changes `Comment` and the
  markdown fence, which is its own decision.

  **`Maple.Context` is now a collapsible**, open on a pick and folded by the first
  keystroke, reopening only when a reviewer asks. Folded it keeps the width,
  which is the one fact anyone reads off it. A stored comment's context does not
  fold: nothing is being typed beside it.

  **Breaking, in `@maple-kit/ui`:** `MapleContextBadge` renders a `<section>`
  wrapping its `<dl>` rather than the `<dl>` itself, so it can carry a
  disclosure. Anything selecting `.mk-ctx` for the outer box wants `.mk-ctx-card`.

  **Breaking, in `@maple-kit/core`:** `ComposerState` gains a required
  `contextOpen`, and `AssistState` an optional `chosenKind`.
  `MapleClient.setContextOpen` and `MapleClient.setKind` are new.

  **Two size budgets are raised**, from 13 KB to 14 KB on the stylesheet and 9 KB
  to 10 KB on the composer. The card, the chip and the disclosure are ~1.7 KB
  gzipped between them, and every byte is inert on a deployment with no
  classifier configured, which is the default. The reasons are in
  `packages/ui/scripts/size.js` beside the numbers.

- 4b922ba: `@maple-kit/core/auth` gains `createInstallationAuth`, which mints and caches an
  installation token for Maple's own GitHub App.

  This is what lets the SDK route publish a check run. Device Flow signs a
  reviewer in and acts as them; a check run can only be written by an App acting
  as itself, which is the second App `docs/github-auth.md` argues for. The token
  is cached for its hour and given up five minutes early, so a resolve never pays
  for a mint and a request that starts valid cannot finish expired.

  Nothing broke: this is new surface.

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

- 6e694c2: The SDK route publishes the merge gate, so resolving the last comment clears
  `maple/visual-review` on the same commit with no new push.

  - **`RouteOptions.gate`** takes a `GateConnector` or a `GateResolver`, chosen
    per request the way `store` and `media` already are. The logic is in
    `src/route/gate.ts`, not in `handler.ts`.
  - **`StoreConnector.head(branch)`** is a new optional method: the commit a
    surface points at now. A gate is about a commit and the route has only a
    branch, and the sha is resolved server-side rather than accepted from the
    browser, because the gate App holds `Checks: write`. `githubStore` implements
    it; `memoryStore` implements it when given `heads`.
  - A gate publish that fails **costs the check update and nothing else**. The
    status change has already happened, the route still answers 200, and the
    failure goes to the logger.

  **What broke:** `capabilitiesOf("store", …)` and `maple connectors --json` now
  report a `head` key. Anything asserting on the exact shape of either needs the
  extra field. No connector has to change: `head` is optional, and a store
  without it publishes no gate rather than failing.

### Patch Changes

- f86a5c9: The eval harness is plain vitest, and `better-sqlite3` is gone with evalite

  evalite ran the first eval set and then aborted the process on exit: its result
  store is `better-sqlite3`, whose statement finaliser calls
  `RemoveEnvironmentCleanupHook` after the environment is gone, which on Node 24
  is a native assertion failure and a non-zero exit. A harness that always exits
  non-zero cannot enforce a threshold, which is what it was there for.

  `evals/README.md` already said to port the scoring harness onto vitest if the
  runner fought the code. Doing it removed the native build at install time —
  `onlyBuiltDependencies` is empty again — and the `@fastify/static` override,
  whose four advisories left with the dependency that carried them.

  No published package changes. This is the repository's own tooling.

## 0.4.0

### Minor Changes

- 8cdf898: The pull-request body a comment lands in is branded: the wordmark inline in the
  line that names who wrote the table, a line saying the fence is the full detail
  to copy into an agent, and a footer stamping the preview and commit beside
  `powered by Maple`.

  The chrome is unconditional and takes no option, including for the summary
  `exportMarkdown(…, { fence: false })` builds. A caller that was matching on the
  exact body — the table as the first line, or the fence last — now needs to
  match on the table or the fence itself; `parseFence` is unchanged and still
  finds it anywhere in the body. The fence's byte budget is untouched: `bytes`
  and `reduced` still describe the fence alone.

- 64eabf6: A sixth connector kind: `ClassifierConnector`, for judging a comment as it is
  written.

  `score` and `classify` are both optional, so a backend that can only do one is
  used for that one, and `pillars` declares what it scores against. A score
  carries its distribution across the pillar's levels and a confidence, not just
  a level — a judgement that landed between two rungs has to be able to say so,
  or a surface renders a guess as a fact.

  `keywordClassifier()` is the zero-configuration tier: no network, no model, no
  options. It is what the feature does with the model tier switched off and the
  floor every eval measures against. `runClassifierContract` and
  `memoryClassifier` ship from `@maple-kit/core/testing`.

  **Breaking:** `ConnectorKind` gains `"classifier"`, so an exhaustive `switch`
  or a `Record<ConnectorKind, …>` over it no longer compiles until the new member
  is handled. `CONNECTOR_METHODS` and `REQUIRED_METHODS` gain a row each;
  `REQUIRED_METHODS.classifier` is empty, because a classifier that implements
  neither method is inert rather than invalid.

  `maple connectors` prints the sixth kind, and a kind that requires nothing now
  prints `required: none` rather than a blank the reader has to interpret.

  `docs/assist.md` is the design record — what a score is, and what it never is.

## 0.3.0

### Minor Changes

- f46ab2c: `exportMarkdown` can write the table without the fence.

  `{ fence: false }` returns the table alone, with `bytes: 0` and nothing shed.

  It exists because a second fence on one pull request is a second comment.
  `githubStore.list` reads every issue comment that carries a fence, so a summary
  repeating them all is read back as one more comment — with an id nothing can
  resolve, because it points at the summary rather than at what a reviewer
  clicked. It would hold the gate for ever, which is precisely the failure the
  gate's contract suite exists to prevent.

  The action's `sync` mode is the first caller: the summary it keeps on the pull
  request is a table, and the fences an agent reads are the ones on the individual
  comments. `docs/connectors.md` records the rule.

## 0.2.0

### Minor Changes

- 0b484de: `decideGate` can say a pull request was never in Maple's scope.

  `GateReason` gains **`no-review`**, reached with `decideGate(comments, {
hasReview: false })` and neutral like the other two. It is the fork, the bot's
  version bump, the branch with no preview deployment: nothing is broken and
  nothing is expected.

  The gate reports on every pull request, so this is the case it reports most
  often, and it had no reason of its own. Folding it into `unreadable` would have
  told a reviewer that Maple failed to read comments on a pull request Maple was
  never installed for; leaving it to each caller would have had every publisher
  invent its own sentence for it. GitLab's external status checks and Bitbucket's
  build statuses meet the identical case.

  **Breaking:** a `switch` over `GateReason` grows an arm. `GateOptions` gains
  `hasReview`, which defaults to true, so a caller that does not know about a
  missing review keeps the behaviour it had.

## 0.1.1

### Patch Changes

- 69fb978: Publish from CI with no npm token at all.

  `release.yml` authenticates to npm by exchanging the job's OIDC token instead of
  carrying a secret. `id-token: write`, the `registry-url` step and
  `NPM_CONFIG_PROVENANCE` all stay — provenance and trusted publishing use the
  same exchange — and `NODE_AUTH_TOKEN` is gone.

  The token this replaces existed for one reason: npm registers a trusted
  publisher only from an _existing_ package's settings page, so the first release
  could not use one. This version is the proof that the second one can.

## 0.1.0

### Minor Changes

- bbb7433: Sign a reviewer in to GitHub from a preview, with no GitHub secret in it.

  Device Flow now runs through the route: `POST /auth/github` starts a link,
  `PATCH /auth/github` makes one exchange attempt, `DELETE /auth/github` forgets
  the token, and `GET /me` reports whether this reviewer has linked and under
  which login. `RouteOptions.githubAuth` turns them on; without it they answer 404.

  The reason this shape and not the redirect flow: **Device Flow's exchange needs
  no client secret.** A preview environment holds the App's public client id and
  nothing else. Each reviewer gets their own user-to-server token, so a
  pull-request comment is authored by them rather than by a shared bot, and one
  person's token is never another's.

  The token and the device code are both credentials, and neither reaches the
  browser. Both travel in `HttpOnly; Secure; SameSite=Lax` cookies scoped to the
  route's own path. `readGitHubSession` from `@maple-kit/core/auth` is what a
  store resolver calls to turn the cookie into a token. An optional `key`
  encrypts the cookie with AES-GCM; `docs/github-auth.md` is honest about how
  narrow that is and why `HttpOnly` is the control that carries the weight.

  `DeviceFlow` gains `exchange(code)` — one attempt, for a caller doing its own
  waiting. `poll` is now written over it. A person takes minutes to type a code,
  and a request held open that long is a request a proxy will close.

- 8038da7: Add the GitHub pull-request store connector, Maple's default store.

  `githubStore({ owner, repo, token })` keeps one issue comment per Maple comment,
  each carrying the human table above its ` ```maple ` fence, so GitHub's own
  threading, notifications and permissions do the work. A comment id encodes the
  pull request, so `setStatus` needs no index and works in a process that never
  listed.

  It passes the shared store contract. Every call it makes has an msw handler,
  including a rate-limit error and a non-JSON gateway error.

- 1cb6bcc: Add the overlay's host and its three ways of picking a target.

  `createOverlayHost()` mounts a shadow root that takes styles only as adopted
  stylesheets and pins itself with `setProperty`, which is what keeps
  `docs/overlay-csp.md`'s claim true. It marks itself `data-maple-overlay`, so
  the anchor cascade and the pickers all look past it.

  `startElementPicking`, `startRegionPicking` and `selectedText` cover the three
  kinds of comment. Each ignores the overlay's own UI, and element picking
  swallows the click so picking cannot submit the page's form.

- f99659d: Add screenshots at `@maple-kit/core/screenshot`.

  `imageFrom` and `imageIn` take an image a reviewer pasted, dropped or chose —
  the first-class path, not a fallback. `previewOf` gives a `blob:` URL for
  showing it before upload, which is the one CSP directive Maple asks for.

  `captureElement` renders an element and two ancestors through snapdom, an
  optional peer imported only when a capture is asked for. It throws
  `CaptureUnavailableError` naming the paste path rather than returning a blank
  image, because a blank screenshot on a comment looks like evidence.

- 8dd0e2e: Add the tagger's two emitters: `@maple-kit/core/vite` and
  `@maple-kit/core/loader`.

  The Vite plugin is one entry in `vite.config.ts`. The loader is how Next reaches
  the same transform, configured as a Turbopack rule. Both run the same Babel
  plugin, so they cannot drift.

  `examples/vite-app` and `examples/next-app` are real applications that assert on
  their own build output, including that `reactRemoveProperties` strips
  `data-maple-` from the Next **server** bundle and not only the client one.

- 038f2c7: `githubStore` finds the pull request, instead of being told the branch.

  The branch name is the easy case and not the common one. A preview hostname has
  to be a DNS label, so what it carries is usually a ticket or a shortened
  branch — and the branch is then the one thing the browser does not know, while
  the build knows its commit for certain. Every integration that hit this wrote
  the same two GitHub calls and the same cache outside Maple, which is the shape
  of a missing option.

  `GitHubStoreOptions.pull` is that option, tried in order:

  1. `pull.commit` — `GET /commits/{sha}/pulls`, which names the pull request
     outright rather than inferring it.
  2. The identifier as the head branch's own name, the plain case.
  3. `pull.matches(head, identifier)` — asked per open pull request, newest
     first, so an application supplies its own rule and not a GitHub client.

  `GitHubStoreOptions.cache` takes a `createPullCache()`. It is a parameter
  rather than a closure because a per-reviewer credential means a store built
  **per request**, so a cache inside one would be thrown away with it — which is
  why `list` and `append` each paid a lookup on every call. Only a hit is kept: a
  branch is pushed, the preview builds, and the pull request is opened after
  that, so a miss has to be re-asked.

- cf9bd03: A merge gate has a shape: `decideGate`, and a fifth connector kind.

  `@maple-kit/core/gate` decides whether a commit is clear to merge from the
  comments alone, and `GateConnector` publishes that decision to a forge. They
  are apart on purpose: `maple/visual-review` is a GitHub check run, GitLab uses
  external status checks and Bitbucket's enforcement is Premium-only, so one
  decision has three publications. The split keeps the check-run API out of core.

  A `GateVerdict` carries a **reason**, not only a conclusion, because the two
  neutrals need different answers from a person: a store that could not be read
  is not a store that cannot record status.

  Everything but `resolved` blocks — including `orphaned`, so that a layout change
  that unpins a comment cannot silently clear the gate. `blockOn` narrows it.

  `runGateContract` and `memoryGate` are in `@maple-kit/core/testing`. The
  contract asserts the property that sank Chromatic: a gate that blocks must be
  able to stop blocking, on the same commit, with no new push.

  `ConnectorKind` gains `"gate"`, so `maple connectors` prints it. `docs/gate.md`
  is the design, including what the GitHub gate will have to do.

- 991363a: Add the overlay's context capture and draft storage.

  `captureContext()` records the shape of the page a comment was written
  against — window and content width, DPR, scheme, the named breakpoint,
  locale, time zone, reduced-motion, and any layout region that was open with
  its width. `formatContext()` turns that into the badge a reviewer reads.

  `createDraftStore({ branch })` keeps unsent comments per branch in
  `localStorage`, and keeps working in memory when a browser refuses site data
  rather than taking the overlay down with it.

- 74adfe4: Add `sourceFor` to `@maple-kit/core/anchor`: where the thing a comment is on is
  written, as `path/to/file.tsx:line:col`.

  It is `labelFor`'s sibling and reads the same way — the page first, from the
  nearest ancestor carrying `data-maple-src`, then what the anchor recorded. The
  page wins because the anchor records where the element was when the comment was
  written, and a redeploy since has moved the line. `LabelSource.anchor` widens
  from `Pick<Anchor, "component">` to include `source`.

- 8c26051: `CommentContext` keeps the content width and the regions that were open, and
  `toCommentContext` converts a captured `PageContext` into one.

  The badge's headline claim — `1440 window · 1020 content · Copilot open` —
  rendered in the composer and was gone the moment the comment was stored,
  because nothing converted between the two shapes. `RegionContext` moves into
  `types.ts` so a server-side consumer can read a stored comment without
  importing from `/overlay`, and `formatContext` now takes either shape so the
  badge renders identically in the composer and in the inventory.

  `contentWidth` is required, and the exporter never sheds it. Regions are the
  new second reduction, after `quote-context`.

- 473898c: Add the markdown exporter at `@maple-kit/core/export`.

  `exportMarkdown` builds the pull-request body: a table a person reads above a
  visible ` ```maple ` JSON fence an agent reads. The fence is never an HTML
  comment, because the action that hands a pull-request body to an agent strips
  `<!-- -->` before the model sees it.

  `parseFence` reads one back, preserving fields it does not know and refusing a
  version it cannot read. Over the 8 KB budget the exporter sheds detail in a
  fixed order and never drops a comment; if even the smallest form is too big it
  reports that rather than truncating.

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

- 40f2ee4: Screenshots have somewhere to go, and every way of not having one says so.

  Maple captured the page at pick time and then dropped it. `MediaConnector` was
  a contract with no route behind it, and `Maple.Attachments` only attached an
  image when the host application passed it an `upload` function — so a default
  installation previewed a thumbnail and lost it on send. The three ways not to
  end up with a screenshot all rendered as the same grey line asking for a paste,
  which reads as a tool that never took one.

  **The route carries media now.** `RouteOptions.media` takes a `MediaConnector`
  or a per-request `MediaResolver`, the same shape `store` has, and serves:

  - `POST {base}/media` — the bytes in, the `MediaRef` back.
  - `GET {base}/media/{key}?type=…` — a redirect to the connector's own URL,
    because a signed URL is the point of `getUrl` and proxying every screenshot
    would put them on the application's budget. A `data:` URL is served instead
    of redirected to, since a browser refuses to follow one.
  - `GET /me` now reports `media`, so the overlay knows before it offers anything.

  **Breaking.** `Maple.Attachments`'s `upload` and `resolve` are overrides rather
  than requirements: without them the strip posts to the route and reads back
  from it. `MapleClient` gains `uploadMedia` and `mediaUrl`, so a Svelte binding
  gets the same default. `ShotStore` holds a `Shot` — an image **or** a reason it
  failed — rather than a `PastedImage`, and `ComposerScopeValue.offer` takes the
  `MediaSource`, so a stored comment can say whether Maple took the picture or
  the author did.

  **A screenshot used to arrive corrupt through the Node adapter.**
  `toNodeMiddleware` read the request body with `setEncoding("utf8")` and wrote
  the response with `response.end(await result.text())`. Both round-trip bytes
  through a UTF-8 string, so an uploaded PNG came back as an image no decoder
  opens — and nothing on either side said so. It carries bytes now.

  New: `memoryMedia()` in `@maple-kit/core/testing`, so the examples and the
  suites exercise capture → upload → reference → image without a bucket. The Vite
  example uses it, and its seeded screenshots go in through the same `putBlob` a
  capture uses rather than through a resolver written for the demo.

  `@zumer/snapdom` stays an optional peer — 550 KB for a transform a server-only
  use of the route never reaches, behind a dynamic import — but skipping it is no
  longer silent. `docs/screenshots.md` is the whole path and that reasoning.

- 22f0fc5: Give a reviewer a stable colour slot.

  `CommentAuthor.colorSlot` is an integer from 0 to 9, into the ten OKLCH hues a
  mark is drawn in. Hue was a per-page assignment, so two reviewers commenting
  from two machines could be drawn as the same person; the route now derives the
  slot from a hash of the author's id instead, and the answer is the same in every
  process.

  It is assigned where the author is — from the identity connector, never from the
  request body. A client that can choose its own slot can choose someone else's. A
  guest still gets whatever the page has free, assigned in the browser.

- 7181bfd: Ask once before a client-side navigation takes an unsent comment away.

  The design document's third layer is "while dirty, prevent the default and ask
  once", and the confirm copy it specifies — "You have an unsent comment on the
  Yield card", Keep writing / Discard — has nowhere else to appear, because no
  current browser lets `beforeunload` carry custom text.

  `createMapleClient({ askToLeave })` supplies the ask. A capture-phase click on a
  same-origin anchor now prevents the default while a draft is dirty, saves, and
  hands the surface a question: the reason, the draft's id, the name `labelFor`
  resolves for what it sits on, and where the click was going. The answer may
  arrive later, so a rendered dialog is as usable as a native one. Discard throws
  the draft away and performs the navigation that was prevented; Keep writing does
  nothing at all, which is what leaves the composer the focus it had.

  Once per draft, literally: a reviewer who kept writing and then deliberately
  clicks another link is not asking to be interrogated again. Without
  `askToLeave` nothing changes — the guard saves and lets the click through — so
  the headless layer stays usable by a caller that has no interface. The other
  three layers are untouched: `beforeunload` still never asks, `pushState` and
  `popstate` still only save.

- 7212b52: Name an element the way a reviewer would, with `data-maple-label`.

  `labelFor` in `@maple-kit/core/anchor` reads the nearest `data-maple-label` at
  or above an element — an application writes it by hand, so one attribute on a
  card names everything inside it — and otherwise unpicks the component's own
  camel case into a noun phrase. `YieldCard` reads as "Yield card" and
  `APIKeyCard` as "API key card"; an acronym is left as it was written.

  It works from an anchor alone, so an unpinned comment still has a name in the
  inventory. When nothing names the element it returns nothing, because the
  surface saying "the Yield card" about the wrong card is worse than saying
  nothing.

  The tagger is unchanged: it never writes a label. Emitting one on every
  intrinsic element would only restate the fallback, and it would end the upward
  walk before a label the application wrote on the card above could be found.

- 02dadef: Carry the configuration in the link, and remember what the viewer chose.

  `@maple-kit/core/client` gains the preference model: `parseMapleQuery()` reads
  `?maple=off|on`, `?maple-pos=`, `?maple-detail=`, `?maple-comment=` and
  `?maple-new=` off a search string, `resolveConfig()` settles the order — query
  string, then the viewer's stored preference, then props, then the defaults —
  and `readPreferences()` / `writePreferences()` keep the two the viewer owns per
  origin, treating a storage that throws on access as no preference at all. An
  application setting `enabled: false` can never be overridden into being on;
  turning Maple off from a link always works.

  The controller now carries `detail`, `position`, `hidden` and `selected`, with
  `setDetail`, `setPosition`, `setHidden` and `select` beside them. Hidden is for
  the session and is not gone: a comment arriving, a pick being armed, a composer
  opening or a link selecting a comment all bring the island back, so no state
  change is discarded out of sight. `detail` is presentation only — the export
  fence carries every field either way.

  `formatContext()` takes that detail as a second argument: default detail reads
  the window's width, the scheme and what was covering the page; developer detail
  adds the layout width, the breakpoint, the device pixel ratio and the locale.
  `opensComposer()` takes the key, so `shortcut` is an application's to choose.

- 657204d: A screenshot on a pull request is a link a person can click.

  `GitHubStoreOptions.media` takes a `MediaConnector`. Given one, `githubStore`
  resolves a comment's first image attachment and passes it to `exportMarkdown`
  as the `screenshots` map, so the table finally gets its **Shot** column. Given
  none, behaviour is exactly what it was: the `MediaRef` sits in the fence and
  nothing human-readable points at it.

  The export already supported this; nothing called it. `exportMarkdown`'s
  `hostedOnly` still drops anything that is not `http(s)`, so a development
  connector serving data URLs produces no column rather than a dead one.

  A media connector that rejects costs the table its link and nothing else. The
  comment posts and the ref is kept: losing a reviewer's comment because a bucket
  was down is the worse failure of the two.

- aed6bc7: Reserve `Comment.parentId` for replies, which Maple does not ship.

  Maple has one body per comment: a comment is a request for a change and it is
  answered by a commit, not by a sentence. Nothing sets `parentId`, nothing reads
  it, and the composer offers no way to make one.

  It is on the wire type anyway so that changing that decision stays additive. The
  flat list is already a one-level grouping by `parentId` where every value is
  `undefined`, so adding replies later is a UI change plus a composer affordance
  rather than a schema migration.

  `docs/replies.md` records the decision and what revisiting it costs in the island
  and in the export. The exporter keeps one row per comment, preserves the caller's
  order and never infers order from `createdAt`, which is what leaves room for an
  indented row later.

- 16957ec: Add the build-time JSX tagger at `@maple-kit/core/tagger`.

  It writes `data-maple-src` (`path:line:column`, repository-relative and
  POSIX-separated) and `data-maple-name` onto intrinsic elements, so a comment
  left on a deployed preview names a file and a line rather than a CSS selector.
  React 19 removed the tree-side equivalent and a preview is a production build,
  so there is nothing to read at runtime.

  The entrypoint also exports the attribute names and the source-location format,
  because the anchor cascade and the overlay have to agree with what was written.

- 74adfe4: A region is the rectangle a reviewer drew, not the element under its middle.

  `CommentAnchor.region` records it as fractions of the smallest element that
  holds the whole of it, so a page that lays out wider moves the rectangle with
  the thing it was over. `containerFor` in `@maple-kit/core/overlay` finds that
  box; `regionOf` and `regionBox` in `@maple-kit/core/anchor` convert both ways.
  A region pick now carries that element on the `Pick`, and `targetFor` no longer
  returns nothing when a rectangle covered no element — `documentElement` is a box
  too, and a rectangle over the page's own background is still a rectangle.

  `kindOf(anchor)` moves to `@maple-kit/core/anchor` and is the one answer to
  which pick made a comment. The controller, the mark layer and the island each
  guessed at it separately, which is two chances to disagree. `PickKind` moves to
  the domain vocabulary with it, because the anchor reads it back off a stored
  comment and the client cannot also own the word.

  `MediaRef.source` says who attached an image: `capture` is Maple's own, taken at
  pick time without being asked, and a reader of a written comment had no other
  way to tell that from one the author chose.

- 2d5eb8d: Give a draft the shape a sent comment has: `Draft.attachments` so a pasted
  screenshot comes back with the draft it belongs to, and `Draft.context` as a
  `CommentContext` instead of a `PageContext`.

  **Breaking:** `Draft.context` changes type. Anything assigning the result of
  `captureContext()` straight onto a draft now converts it first with
  `toCommentContext()`. The payoff is one badge implementation across a draft and
  a stored comment rather than two that drift.

- fbe201b: `githubGate`: the check run that holds a merge open.

  `maple/visual-review`, published from a `GateVerdict`. Blocked is
  `status: in_progress` with no conclusion, never `conclusion: failure` — a
  required check passes only on `success`, `skipped` or `neutral`, so an open run
  blocks exactly as hard as a failure and, unlike a failure, can be exited with
  no new commit.

  A second publish updates the run in flight. Where the existing run is already
  completed, a new one is posted under the same name and SHA instead of the
  completed one being reopened.

  `read` gives back the whole verdict, because the counts ride in `external_id`
  rather than in the markdown summary a person reads. A run some other tool
  created under the same name reads back as `unreadable` with zero counts, which
  is the honest answer.

  `CHECK_NAME` is exported: it is the string a branch-protection ruleset
  requires, and changing it silently orphans the required check.

- f09d860: `withMaple` for Next, and a page that says when the tagger did not run.

  Tagging a Next build takes two settings that have to agree: a Turbopack rule
  that adds `data-maple-src` and `data-maple-name`, and `reactRemoveProperties`,
  which must not take them off again on the same build. Wired by hand they
  disagree **silently** — nothing throws, the page renders, and every comment
  anchors to "this page" with no component name and no file.

  Both ways it goes wrong have now happened in a real integration:

  1. `reactRemoveProperties` left on for the preview build, so the rule tags and
     the pass immediately untags.
  2. `"src/**/*.tsx"` as the rule key. Turbopack matches a key containing a
     separator against the whole path, so it never matches — and a rule that
     matches nothing is not an error.

  `@maple-kit/core/next` exports `withMaple(config, { preview })`: one flag drives
  the rule, the stripping and a webpack hook, so `next dev --webpack` is not a
  quiet downgrade either. It throws when the config already sets
  `compiler.reactRemoveProperties`, because two owners for the field that decides
  whether the tagger's work survives is the bug it exists to prevent; extra
  patterns go through `removeProperties`.

  A build still cannot report this — from the build's side nothing happened — so
  the page is asked instead. `pageIsTagged` in `@maple-kit/core/overlay` looks for
  one `data-maple-src`; the controller asks on start and on every pick and keeps
  the answer as `ClientState.tagged`, logging a warning the first time it turns
  false. The island's settings panel carries a row saying so and naming
  `withMaple`, because that panel is where someone wondering why everything says
  "this page" will already be looking.

- 25c47f5: Add the anchor cascade at `@maple-kit/core/anchor`.

  `describeElement` and `describeRange` record every rung a page can supply —
  `data-maple-key`, `data-maple-src`, `data-maple-name`, a text quote with its
  surrounding context, and a CSS path. `resolveAnchor` tries them most durable
  first and reports which one placed the comment and how far it is trusted.

  When no rung works the answer is an orphan carrying a reason — `empty`,
  `missing`, `ambiguous` or `changed` — never the nearest ancestor. About a
  quarter of anchors orphan over time, so saying so is the feature.

- d2f84b7: Let the route choose a store per request, so a credential can be per reviewer.

  `RouteOptions.store` took one connector, built once, holding one token. That is
  the right shape for a store the deployment owns and the wrong one for a store
  the reviewer owns: with a GitHub token per person, the connector that holds it
  differs per request.

  It now also takes a resolver — `(request: IdentityRequest) => StoreConnector |
null`, sync or async — called on every request that needs a store. Returning
  null means this reviewer has nowhere to write yet, and the route answers 401
  rather than writing the comment as somebody else.

  `/me` never resolves a store, because asking who someone is must work before
  they have linked anything. A wrong method is answered before the resolver is
  asked, since that is not a credential problem.

  **Not breaking:** passing a connector still works and is unchanged.

- 5eec274: **Breaking within 0.x:** `Comment` and `NewComment` now carry `branch`.

  A store filters by branch on `list` but `append` was given no way to know which
  branch a comment belonged to. The reference connector smuggled it through
  `anchor.key`, which no real backend could imitate: a GitHub PR store has to
  resolve a branch to a pull request before it can write anything.

- a96ffa4: Say out loud when a request did not work, instead of drawing nothing.

  Every failure the overlay could hit was silent. A 401 on the list rendered as
  "Nothing here under this filter", which reads as a branch nobody has commented
  on. A 401 on a send rendered as a button that did not move — and a reviewer
  retries a button forever, where they read a sentence once and act on it. On a
  preview whose store is built per reviewer, that is the **first** thing anyone
  sees, and it said nothing at all.

  **Breaking.** `ClientState.error` is a `MapleFailure`, not a string:

  ```ts
  interface MapleFailure {
    kind: "offline" | "store" | "unauthorized" | "unknown";
    message: string; // already addressed to a reviewer
    during: "link" | "load" | "send" | "status";
    status?: number;
  }
  ```

  A string could not be branched on, so no surface could tell "sign in first"
  from "the store is down" from "you are offline" — and those have three
  different answers. `failureFrom` builds one; the route's own words go to the
  logger instead of the page, because a connector's message can name a repository
  or a rate limit.

  `MapleClient` gains `clearError()`. `setStatus` no longer throws past the
  binding into a click handler; it records the failure like the other three.

  `load()` now asks `GET /me` **alongside** the list rather than after it. A 401
  on the comments is usually a reviewer who has not signed in, and the sign-in is
  the thing `/me` reports — so the one case that needed the offer was the one
  case that never fetched it.

  New in `@maple-kit/ui`, on its own subpath `@maple-kit/ui/notice`:
  `Maple.Notice`, one band carrying the sentence and the single thing that would
  fix it — **Sign in** under a 401 where a sign-in is on offer, **Try again**
  under anything retryable, and no offer at all where the deployment serves no
  sign-in, because pointing at a door that is not there is worse than silence.
  The default composition mounts one in the island for `load`, `status` and
  `link`, and one in the composer for `send`.

  `Maple.List` no longer claims a branch is empty when it failed to read it.

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

- 16f5582: Record what a reviewer calls a preview, and which commit it was serving.

  A preview hostname carries a shortened branch — a ticket key, or a name cut to
  fit a DNS label — and that shortening is lossy, so the string a person reads is
  not the string a store resolves a pull request from. `Comment.label` carries the
  readable one and `Comment.branch` stays the identifier; `Comment.commit` carries
  the exact thing the label is an abbreviation of, and is what a later re-verify
  compares against.

  Both are optional and set by the application: `<Maple branch label commit>` on
  the component, `label` and `commit` on `MapleClientOptions`. The branch chip in
  the island reads the label and keeps the branch as its title, because a label is
  what you recognise and a branch is what you copy. Neither field is ever shed by
  the export fence's byte budget.

  The route takes both off the draft the way it already takes the branch and the
  URL — the client describes its own page — and checks only that a commit is
  shaped like one. The author stays the route's to decide.

  **Breaking:** `MapleRootProps.options` now omits `label` and `commit` as well as
  `branch`. The three are props on the component, so passing them twice could
  disagree; move them out of `options`.

- 9fcecc0: Add GitHub Device Flow at `@maple-kit/core/auth`.

  `createDeviceFlow({ clientId })` gives a reviewer a short code to type, then
  waits for them, honouring GitHub's polling interval and its `slow_down`
  back-off. A preview URL differs on every deployment, so there is no stable
  callback to register; Device Flow needs none.

  It runs on the SDK route. A device code and a token are both credentials and
  neither belongs in a bundle the browser downloads.

- 33c1689: Add the SDK route at `@maple-kit/core/route`.

  `createMapleHandler({ store, identity })` is a web-standard handler — a
  `Request` in, a `Response` out — so the same code serves a Next route handler,
  a Vite middleware, Hono and a Worker. `toNodeMiddleware` adapts it for connect,
  and the Vite plugin mounts it on the dev and preview servers when given a
  `route` option.

  The author of a comment comes from the identity connector and never from the
  request body, and a connector's error message goes to the log rather than to
  the browser.

- 55dddc9: Picking works end to end, and one import mounts all of it.

  `Maple.Picker` in `@maple-kit/ui/picker` runs the gesture an armed pick starts
  and opens the composer on what it finds — until now `arm()` set a flag nothing
  read. `@maple-kit/ui/maple` exports `<Maple branch="…" />`, the whole reviewer
  interface as one element, for an application that wants the default.

  A screenshot of the page is taken at pick time, before the panel insets the
  layout it is over, and lands in the composer on its own; paste and drop
  override it and there is no button for either. Clicking a comment opens the
  panel on it to read, with the context badge and the screenshot a row cannot
  carry. Escape shuts the newest surface first: the panel, then the settings,
  then the island.

  The overlay's scheme and the island's corner are now the viewer's, remembered
  per origin and settable from the island's settings: `client.setTheme()`,
  `?maple-theme=`, and a corner picker beside it.

  **Breaking:** `PartForm` is now `"outline" | "partial" | "solid"` — a leaf
  fills up as a comment goes through its life rather than emptying out, so open
  is an outline, re-verify is half and resolved is full. `useOverlayScheme()`
  takes no argument and reads the viewer's preference from the controller.
  `MapleAttachments` no longer takes `capture`, and `Tip` moved from
  `@maple-kit/ui/island` to the package root.

- bf6e1ea: Add `@maple-kit/core/client`, the reviewer interface's state machine.

  `createMapleClient({ branch })` is a plain object with `subscribe` and
  imperative methods: the comment list and its five filters, the composer, the
  pick, a draft's whole life, the navigation guard and theme detection. No React
  and no DOM until `start()`, so a binding for React, Svelte or Astro is a
  subscription over it rather than a second implementation of it.

  A draft is written 400ms behind the keystroke, keyed by branch and anchor,
  expired after a week, cleared by a send and never by a close, and reconciled
  across tabs so one tab cannot hand back a comment another already posted.
  `beforeunload` exists only while a draft is dirty, because leaving it attached
  costs the host application its bfcache.

  The overlay's scheme is the opposite of the host's; the scheme a comment
  records is the host's. Those are two facts, and this is where they stay apart.

### Patch Changes

- 061766e: Update Effect to 3.20.0.
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
