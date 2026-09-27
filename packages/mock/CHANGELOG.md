# @maple-kit/mock

## 0.12.0

### Patch Changes

- @maple-kit/core@0.12.0

## 0.11.0

### Patch Changes

- 6ac8d9b: Apply and reload, and Turn off, in the mock box and its banner reload the page
  without the browser's "Leave site?" dialog, even while a comment draft is
  open. The reviewer chose to reload, and the draft is saved first as it always
  was. `navigateOnPurpose(view, url)` joins `@maple-kit/core/client` for any
  surface that navigates on the reviewer's say-so; Discard in the leave prompt
  uses it too.
- Updated dependencies [b7a0f25]
- Updated dependencies [2bf7ed3]
- Updated dependencies [b7a0f25]
- Updated dependencies [6ac8d9b]
- Updated dependencies [b7a0f25]
  - @maple-kit/core@0.11.0

## 0.10.0

### Minor Changes

- 1cb2f6f: `encodeRecipe`, `decodeRecipe`, `linkRecipe` and `RECIPE_PARAM` move to
  `@maple-kit/core/mock`, beside the recipe whose wire format they are, so a
  server replaying a comment's mock builds the same link the page reads.

  **Breaking:** `@maple-kit/mock` no longer exports them; import them from
  `@maple-kit/core/mock`.

- d9ff194: A recipe's `as` is applied. With identity rules, read from the route's
  `/mock/identity` or passed as `installMock({ identity })`, the identity call's
  answer carries the recipe's role and permissions, and a call the shown
  identity may not make answers 403 without being sent. Writes are not blocked:
  each one that reaches the server is logged as a warning and listed on
  `MockHandle.writes`. `resolve` takes `identity` and `onWrite`; `impose`,
  `meetsNeed`, `realIdentity` and `routeIdentity` are exported.
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

- 50f80c9: The mock box sets flags and who the page is shown as. `createMockClient()`
  lists the flags the page evaluated (`state.flags`), reads the host's identity
  rules (`state.identity`), drafts both (`draftFlags`, `draftAs`, with
  `setFlag`, `setRole` and `setPermission`), counts the writes that reached the
  server under `as` (`state.writes`), and applies a recipe that names flags or
  `as` with no call. `MockHandle.identity()` reads the rules once, from the
  options or the route.

  `MapleMock` draws them in a panel loaded as a separate chunk, only on a page
  with identity rules or evaluated flags, and its banner says "Showing as …. The
  server still acts as you."

  **Breaking:** `MockClientState` has five new fields, so a hand-built state
  must set them, and `clear()` also empties the draft's flags and identity.

- 7ace7e4: The mock box reads a sentence where Maple's route plans one. `installMock({
route })` leaves a `plan` lookup on the handle (`routePlan`, over the real
  `fetch`), and `createMockClient()` asks it once typing pauses, gates the answer
  the calm-UI way (core's `readPlan`: nothing under 0.4, two suggestions within
  0.15, `unnamed` for `none`) and exposes `planning`, `suggestions`, `unnamed` and
  `request` on its state. `suggest(index)` puts a suggestion's calls in its
  state, and the sentence goes into the recipe's `request`. A route with no
  planner turns the field back into a filter; `plan: false` keeps it one.
- 5fc5eb1: `createMockClient()`, at the new `@maple-kit/mock/client` entry and the root,
  is the mock box's controller without a framework: the calls this route has
  recorded, a draft of states, Apply and Turn off, and Copy link and Copy recipe
  for a page with no store. It finds the transport `installMock` put in the page
  rather than importing the interceptor, so a page that shows the box without
  mocking loads none of it.

  **Breaking:** `Inventory` has a `subscribe(listener)` method, so an object
  written to satisfy that interface needs one.

- 4493ac7: `MockHandle.current()` answers the recipe in force on the page's current route,
  which a comment written under the mock records. It is optional on the
  interface, so a handle a test builds need not define it.
- 13fe029: `installMock({ flags })` takes flag sources: a vendor's flag request, read for
  `seenFlags()` and answered with the recipe's flags, and its stream, held
  through a wrapped `EventSource`. `launchDarklyFlags({ baseUri?, streamUri? })`
  from `@maple-kit/mock/launchdarkly` is LaunchDarkly's browser SDK: its
  `/sdk/evalx/` poll, and its stream's `put`, `patch` and `delete`. `FlagSource`,
  `holdStreams` and `flagType` are exported for another vendor's source.
- a93dc26: `withMockFlags(provider)` from `@maple-kit/mock/openfeature` answers the flags
  a recipe names and delegates the rest, for a web or a server OpenFeature
  provider, and holds back the provider's change events for an answered flag.
  Every evaluation is recorded with its real value in `seenFlags()`.
  `@maple-kit/mock/testing` has `runFlagProviderContract` and
  `memoryFlagProvider`; `vitest` is an optional peer, needed only there.
- 8707fda: The mock box puts the planner's reading straight into the draft instead of
  offering it as a chip. Each new reading is applied over what the draft held
  before the sentence, and emptying the field, or a sentence that names no
  state, puts that back; a change by hand keeps what is there. While a plan is on
  its way a sweep runs along the field's lower edge, and stands still under
  reduced motion.

  Breaking: `MockClient.suggest` is gone, since nothing is left to take. The
  reading is still on `MockClientState.suggestions`.

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

- 1b2b4ae: `MockClientState.thinking` is true while the route reads the box's sentence,
  and not while it is still being typed. Two motion tokens join the contract for
  a wait like that one: `--mk-dur-shimmer` and `--mk-shimmer-sweep`.
- d57cb19: The mock box's "Shown as" and "Flags" rows start on what the page really sees:
  the reviewer's role and permissions, read from the identity call's last real
  answer, and each flag's evaluated value. The real option carries a green dot,
  and choosing it again drops the override. `MockClientState.realAs` (a new
  `RealAs` type) holds the real role and permissions.
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

- 4acc6db: `installMock({ route: "/api/maple" })` reads each call's shape from Maple's
  route as it is needed, batched and cached, and never records or mocks anything
  under that path. `routeShapes` is the same lookup on its own. `MockHandle.shape`
  and a row's `source` let the box say where each shape came from. `Shape`,
  `JsonSchema` and `SHAPE_SOURCES` now come from `@maple-kit/core/mock`.
- c62cad0: Shapes: `resolve` and `installMock` take a `shape(key)` lookup, one JSON Schema
  per call. A transform then stays inside it (a key is nulled only where it is
  nullable and dropped only where it is optional, `minItems` and `maxItems` hold,
  and `many` cycles enum values), and a call with no live answer and nothing
  recorded is sampled from the schema alone with `sampleSchema`, deterministic
  and superjson-aware. `reshape` and `reshapeTyped` take the schema as an
  optional last argument.

### Patch Changes

- 7ff6fd9: A `loading` call held on Node, as by the `@maple-kit/mock/node` handlers, now
  settles when its request is abandoned after a garbage collection. Node links a
  `Request`'s signal to the caller's only weakly, so a held request nothing else
  referenced could be collected and never hear the abort.
- 59e5de3: `launchDarklyFlags()` with no `baseUri` claims the 3.x browser SDK's default
  host, `https://app.launchdarkly.com`, as well as 4.x's
  `https://clientsdk.launchdarkly.com`. A page on `launchdarkly-react-client-sdk`
  3.x had its flags neither read nor answered.
- 111360f: `long` no longer glues a value's letters into one unbroken run, which read on
  a page as Maple breaking it ("AdaAdaAda"). Words repeat with a space between;
  only a value that is already unbroken, such as a branch, a slug, an address or
  a URL, grows as one, from its own words.
- a939399: `withMockFlags`' `recipe` option names `requestRecipe` from
  `@maple-kit/mock/server` as the server's source, where it named `./node`.
- 2d13012: A streamed tRPC batch the page let through is recorded again. tRPC's stream
  link aborts its request once the last call has answered, which errored the
  interceptor's copy of the body before it was read, so the inventory stayed
  empty on every page using `httpBatchStreamLink`. The copy is now read from the
  moment it arrives, and what was read before the abort is kept.
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

### Minor Changes

- 9371621: `@maple-kit/mock/msw` and `@maple-kit/mock/node` export `mockHandlers(recipe)`:
  the same resolver as MSW request handlers, for a host that already runs
  `setupWorker` or `setupServer`. Put them first; a call the recipe does not name
  falls through to the host's own handlers. `msw` is an optional peer.
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

- 1600f2f: **`@maple-kit/mock` rewrites REST responses in the page.**

  `import "@maple-kit/mock/install"` wraps `fetch` and `XMLHttpRequest` over
  `@mswjs/interceptors`, with no service worker. `installMock(options)` is the
  same with a logger and an `ignore`. The active recipe is read once at install,
  from `?maple-mock=` or the tab.

  A call the recipe names is answered in its state and every other call keeps
  the server's answer. `empty`, `one` and `many` reshape the server's own JSON,
  keeping envelope keys, and fall back to the last recorded answer when the
  server fails. `error` and `forbidden` answer 500 and 403 without sending the
  request, and `loading` holds it.

  Also exported: `resolve`, `restCodec`, `restKey`, `pathPattern`, `reshape`,
  `createInventory`, and the `Codec` contract.

- 9371621: **`@maple-kit/mock` mocks tRPC**, batched, streamed and with superjson.

  `trpcCodec({ endpoint, transformer })` is a default codec, before REST, at
  `/api/trpc`. `/api/trpc/a,b?batch=1` is two calls, `trpc:a` and `trpc:b`. A
  partial mock sends the real batch and replaces only the named calls, leaving
  the rest byte for byte and recomputing a 207. A `httpBatchStreamLink` batch is
  fetched plain and written back as tRPC's own JSONL. superjson annotations stay
  true through `empty`, `one` and `many`.

  The `Codec` contract gains an optional `prepare(request)`, and an `Answer` an
  optional `meta`. `reshapeTyped` is new beside `reshape`.
  `installMock` takes `codecs`.

### Patch Changes

- b84f8e1: A `loading` call whose request is abandoned before the interceptor gets to it
  now settles, instead of being held forever.
- 0d957fd: A page can close a stream the interceptor let through. The interceptor's copy
  of a response it did not read, such as a server-sent event stream read over
  `fetch` or `XMLHttpRequest`, is now cancelled. Before, the page's own `cancel()`
  never settled, and the server kept the stream open for as long as it ran.
- Updated dependencies [9371621]
- Updated dependencies [8cfc7b5]
  - @maple-kit/core@0.9.0
