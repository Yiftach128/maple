# Mock: showing a page in the state a reviewer asked for

The states that most need a visual review are the hardest to reach on a
preview: empty, error, forbidden, loading, one item, a thousand items. Maple
Mock lets a reviewer name the state, and rewrites the page's API responses into
it. The tracking issue is #166; the open questions are in Discussion #174.

This file records decisions as they land. It says what exists, not what is
planned.

## A model picks, code writes every byte

A model may be asked which state was meant and which calls it concerns. It is
never asked to write a response body. A transform reshapes a response the page
has already received, or one sampled from its schema, so the app's own parser
still accepts the result. A generated payload would be valid only by luck.

Nothing in the runtime calls a model.

## Where the pieces live

| Piece                                           | Home                      |
| ----------------------------------------------- | ------------------------- |
| The recipe type and its validator               | `@maple-kit/core/mock`    |
| Interceptor, codecs, transforms, recipe storage | `@maple-kit/mock`         |
| The one-line install                            | `@maple-kit/mock/install` |
| The box's controller, framework-free            | `@maple-kit/mock/client`  |
| The recipe a server request carries             | `@maple-kit/mock/server`  |
| `useMock()`                                     | `@maple-kit/react/mock`   |
| `MapleMock`, the box and its banner             | `@maple-kit/ui/mock`      |

**A package, not a core subpath.** The interceptor is imported from a host's
entry before its first request, and a host that does not mock should not carry
it. A host that only mocks installs `@maple-kit/mock` and never loads the review
overlay.

**The recipe type is in core** because the comment fence carries it, and the
fence is core's. The writer and the reader of a format share one validator and
ship in one release, which is the lesson of a reader pinned to an older core
that read a newer format and passed.

**`@maple-kit/mock` has no React and no Effect**, and never imports
`@maple-kit/ui` or `@maple-kit/react`. They depend on it through their own
`./mock` subpaths. A lint rule enforces the direction.

## The recipe

```ts
{
  version: 2,
  calls: [{ key: "trpc:project.list", state: "empty" }],
  flags: { "new-dashboard": false },
  as: { role: "billing-manager", permissions: { "invoice:void": false } },
  route: "/projects",
  request: "mock this page with an empty state",
}
```

- **A call is named by a key its codec owns**, prefixed with the codec's name:
  `rest:GET /api/projects/:id`, `trpc:project.list`. Core checks only the
  prefix; the grammar after the colon is the codec's.
- **A call not named passes through.** A mock is a list of exceptions to the
  real server, never a replacement for it. Mutations are no different: one is
  mocked only if the recipe names it.
- **The states are a closed set**:
  <!-- generated:mock-states -->`empty`, `error`, `forbidden`, `loading`, `one`, `many`, `long`, `sparse` or `mixed`<!-- /generated:mock-states -->. A state outside it is refused
  rather than ignored, since a recipe that silently mocks less than it says is
  worse than one that fails. A new state is appended, so the order a box lists
  and a plan breaks ties in holds. `long`, `sparse` and `mixed` came after
  0.9.0 without a version bump: no released reader has seen a version-2
  recipe, and a 0.9.0 reader refuses the unknown state, which is that same
  preferred failure.
- **Unknown fields are dropped, a newer version is refused.** Dropping lets a
  later layer be added to the record without an older reader rejecting it.
  Refusing a newer version stops a reader half-applying a format it does not
  know.
- **`flags` answers flags with the values named**, any JSON value, keyed by
  the flag's own key. A flag not named keeps its real value.
- **`as` is who the page is told the reviewer is**: a `role`, and
  `permissions` granted (`true`) or taken away (`false`) beside the ones the
  reviewer has. Both are the host's words; Maple has no list of roles, since
  every app has its own. The server still acts as the reviewer, so a mutation
  sent under `as` really happens.
- **Version 2 is always written, and version 1 is still read.** `flags` and
  `as` change what a recipe does, and a reader that dropped them would mock
  less than the recipe says. A released build refuses a version 2 recipe
  rather than showing half of it.
- **`route` scopes it to one route pattern**, such as `/projects/:id`. A
  recipe kept for the tab would otherwise follow the reviewer to every page,
  and empty a list they never asked to see empty. Absent, it applies
  everywhere.
- **`request` is the reviewer's words**, kept for display. Nothing reads it to
  decide what to mock.

`parseRecipe` returns a fresh copy and throws `InvalidRecipeError` listing
every problem at once.

## Applying a mock reloads the page

The recipe is written to `sessionStorage` and to the `?maple-mock=` parameter,
and the page reloads. Patching a client's query cache in place would mean one
integration per data library, each of them fragile; a reload makes every
library fetch again through the interceptor.

- **The link wins over the tab.** Opening a shared link shows what was shared,
  even in a tab that had another mock on.
- **The tab keeps it through navigation** that drops the query string.
- **The parameter is base64url of the JSON**, so it survives any router that
  re-encodes the query.

`readRecipe` throws on a recipe it cannot read rather than returning nothing,
so the caller decides whether to drop it. A broken link that silently shows
real data looks exactly like a working mock of a page with real data.

## The interceptor

`import "@maple-kit/mock/install"` from the app's entry, before its first
request, wraps `fetch` and `XMLHttpRequest` in the page. `installMock(options)`
from `@maple-kit/mock` is the same with a logger and an `ignore` for requests
that are not the page's data, such as Maple's own route.

- **No service worker.** It is built on `@mswjs/interceptors`, the layer MSW
  runs on, which patches the page's globals. Nothing is served from the host's
  origin and `docs/overlay-csp.md` still holds.
- **Preview builds only** is the host's build switch, the same one that keeps
  the overlay out of production. `examples/vite-app` imports it behind a
  build-time constant, and its `verify` script checks that a production build
  carries none of it.
- **With no recipe it changes nothing.** Every request goes through untouched,
  and its answer is recorded.
- **It says why a named call was not mocked**, at `debug` on its logger: a
  request its codec could name no call in, a response it could not read, or
  a body state with no data, sample or shape to reshape, which keeps the
  server's answer. Not louder: a persisted query's first request is one of
  those on every fresh tab, and a warning there would be noise in the host's
  monitoring.

## The MSW transport

`mockHandlers(recipe)` from `@maple-kit/mock/msw`, or `/node`, is the same
resolver as MSW request handlers, for a host that already runs MSW: Storybook,
Vitest, Playwright. It is one `http.all("*")` handler that answers the named
calls and falls through for the rest, so it goes first and the host's own
handlers after it still answer everything else. A forwarded request goes out
through `fetch(bypass(request))`.

It is opt-in, and `msw` is an optional peer. In a browser it needs
`mockServiceWorker.js` on the host's origin, which is the host's CSP decision;
Maple's own path never needs a worker. It records the answers it reshapes but,
seeing no passthrough response, not the ones it lets through. The recipe comes
from the caller, since nobody types into a test.

## Resolving a request

A **codec** takes one HTTP exchange apart into logical calls and puts it back
together: `split(request)`, `read(response)` and `join(calls, answers)`. `read`
is `split` for the response. An optional `prepare(request)` rewrites the
request sent on when its response will be rewritten. Everything a protocol does
differently stays inside those, so nothing else in the package reads a URL or a
header.

The default codecs are tRPC at `/api/trpc`, GraphQL at `/graphql`, then REST.
`installMock({ codecs })` replaces them, for example with
`trpcCodec({ endpoint: "/trpc" })`.

For each request, the calls the recipe names are answered and the rest keep
the server's answer:

| State                  | What is sent to the server | What the page gets                          |
| ---------------------- | -------------------------- | ------------------------------------------- |
| not named              | the request, as it was     | the server's answer                         |
| `error`, `forbidden`   | nothing                    | a failure in the protocol's own error shape |
| `loading`              | nothing                    | nothing, until the request is abandoned     |
| `empty`, `one`, `many` | the request, as it was     | the server's own answer, reshaped           |
| `long`, `sparse`       | the request, as it was     | the server's own answer, reshaped           |
| `mixed`                | the request, as it was     | the server's own answer, reshaped           |

- **A body state reshapes the live answer**, so the mock is as fresh as the
  page. When the server fails, the last recorded answer is reshaped instead;
  with neither, the server's failure goes through as it came.
- **A failure never reaches the server.** A mutation named `error` is a write
  the server never sees, which is the state the reviewer asked to look at.
- **A response the codec cannot read goes through untouched.** A body state on
  an HTML page is a mistake in the recipe, not a reason to break the page.

## The REST codec

One request is one call. Its key is the method and the path, with identifiers
collapsed: `rest:GET /api/projects/:id`. A segment is an identifier when it is
all digits, a UUID, a ULID, or sixteen or more hex characters with a digit
among them. The query string is not part of the key.

It is the last codec tried and claims every request that reaches it, but reads
only a JSON response, so a script or an image is never recorded or reshaped.

## The tRPC codec

`/api/trpc/project.list,user.me?batch=1` is two calls, `trpc:project.list` and
`trpc:user.me`. Input is not part of the key. A single call without batching,
a GET query and a POST mutation are all read the same way.

**A partial mock is a splice.** The real batch is still sent, and only the
named calls are replaced in the answer, so the server stays the truth for
everything the reviewer did not ask to change. The batch status is recomputed
as tRPC computes it: one status if every item agrees, 207 if they differ. An
item the mock did not touch is written back byte for byte as the server wrote
it; the suite checks that against tRPC's own server, not against this codec.

**A streamed batch (`httpBatchStreamLink`) is fetched plain and written back
as a stream.** The forwarded request drops `trpc-accept`, so the server answers
one JSON array, and the codec writes the JSONL the client asked for: the head,
failed calls, then each level of the rest, in the order tRPC's own producer
writes them for calls that settle at once. When they do, every line of a partly
mocked stream but the mocked one matches the server's own stream exactly.

When one settles later, the server numbers its chunks in the order they settle,
which a plain answer does not say. The lines then differ in those numbers only,
and tRPC's client decodes every untouched call to the value the server sent.

What is lost is streaming itself: the page gets every call when the slowest has
answered. In the Next example, a call batched beside one that takes 1.5 s
arrives in about 10 ms unmocked and in about 1.5 s with a mock on the batch.

**A stream the page receives unmocked is read without holding it.** Recording
reads a copy of the response after the page has it, because the interceptor
would otherwise wait for the whole stream before handing it over. The copy is
read from the moment it arrives, and kept as far as it got when the page
aborts: tRPC's stream link aborts its request once its last call has answered,
before the stream ends, and a copy still waiting to be read errored with it.

**superjson is read from the answers**, as the `{ json, meta }` envelope.
`meta` says which values were a `Date`, a `bigint` or a `Map`, by path, and a
transform keeps it true: an emptied list drops its items' annotations, a
repeated item repeats them. Referential equalities are kept on an untouched
answer and dropped from a reshaped one. In a stream each line is serialised
whole, so an answer's annotations move under `2.0.0` of its line, and back.

**A failure nothing was fetched for** borrows the envelope the call was last
recorded in. A call never seen, failed without a request, has no answer to
learn from; `trpcCodec({ transformer: "superjson" })` says it up front.

The error written is tRPC's default shape: `code` `-32603` or `-32003`, and
`data` with `code`, `httpStatus` and `path`. An `errorFormatter` that adds
fields is not reproduced.

Subscriptions (`httpSubscriptionLink`) are claimed and never read: only a JSON
response is, and an event stream is not one. The browser's own `EventSource`
never reaches the interceptor at all. A polyfill that reads the stream over
`fetch` or `XMLHttpRequest` does, and its events arrive as the server sends them.
The interceptor cancels its own copy of any body it did not read, since a
stream copied and left open cannot be closed by the page.

## The GraphQL codec

One request is one operation, keyed by its name: `graphql:GetProjects`. The
name is the request's `operationName`, else the one named operation in the
document. An anonymous operation is keyed by a hash of its text with comments,
commas and whitespace dropped, so the same operation printed two ways is one
call: `graphql:4b04480d`. Variables are not part of the key. A persisted
request carrying no text is keyed by its id, APQ's `sha256Hash` or a
`documentId`, unless `graphqlCodec({ manifest })` holds the host's persisted
documents, id to text as graphql-codegen's `persistedDocuments` writes them,
in which case it is named like any other. `readGraphqlOperation` in
`@maple-kit/core/mock` computes the key, since the route will name the same
operations when it serves their shapes.

It owns every request at its endpoints, `/graphql` and `/api/graphql` unless
`graphqlCodec({ endpoint })` names others, and reads `operationName`, `query`,
`documentId` and `extensions` from a `POST`'s JSON body or a `GET`'s query
string. A request there that it cannot name, a batch of operations, a
multipart upload, a body that is not JSON or one naming no operation, has no
call in it: it goes through as it came, and never reaches the REST codec, so
no state applies to it and no write is reported for it. Subscriptions over a
websocket never reach the interceptor.

**The page's own operation runs on the server.** A body state reshapes the
`data` the server answered, which matches the selection set exactly, so the
page gets the fields it asked for and nothing else. A response without
`data`, a persisted-query miss or a validation error, is not an answer: it is
never recorded, and it goes back as it came, at the server's own status. That
is how APQ keeps working under a mock: the first request misses, the page
retries with the text, and both are the same call. Once the call has been
recorded, a miss is answered from its sample and the page never retries. A
partial result, `data` beside `errors`, is reshaped like any other, without
its `errors`, but never recorded: a later failure falls back to the last whole
answer, not to a field the server could not resolve.

**A failure is written as a GraphQL server writes one**: `data: null` beside
one error whose `extensions.code` is `INTERNAL_SERVER_ERROR` or `FORBIDDEN`,
at HTTP 200. A client reads a 200 with `errors` as the operation failing,
which is the page's error state; a 500 would be a network error, a different
path in every client. The content type mirrors the server's,
`application/graphql-response+json` or `application/json`, and is
`application/json` when nothing was fetched.

**A mutation is a write, whatever its method.** Every GraphQL request is a
`POST`, so the call says whether it writes and the report of a write reaching
the server under `as` believes that over the method. A persisted request
without a manifest says nothing, and its method decides, so under `as` a
persisted query sent by `POST` is reported as a write. A `manifest` names it,
and the report stops.

## Transforms

Code, with no model. Every value in the output is derived from the input,
never invented. Until `long`, every value in the output was in the input; a
longer text is built from its own characters, so the promise became
"derived", and nothing a transform writes is a word it made up.

- **`empty`** turns each list into `[]` and the envelope keys beside it into an
  empty page: a count to `0`, a next cursor to `null`, a has-more to `false`.
- **`one`** keeps the first item, with the same envelope.
- **`many`** repeats the items to fifty and raises a count to match. A repeated
  item gets a unique `id`, `_id`, `uuid`, `key` or `slug`.

- **`long`** makes every text as long as the page could really receive: to its
  `maxLength` exactly, else four times over (at least 32 characters), in the
  shape the value already has, so the page looks like it received a long
  value rather than like it broke. Words repeat with a space between, so they
  wrap, and without a `maxLength` a text ends on a whole word. Only a value that is already one unbroken run grows as one, for
  `overflow-wrap`: a slug or a branch (`fix/chart`) by its own words after a
  dash, an address by its local part (at most 64 characters) and a URL by a
  path segment after its origin, so both still parse.
  A number goes to 1,234,567, never past its schema's bound. Identifiers,
  references (`ownerId`), cursors, enums, `const`, `pattern`, dates, UUIDs
  and colours are left alone, as is every superjson-typed value. Lists keep
  their length.
- **`sparse`** makes everything that may be missing missing. With a schema, a
  nullable field is `null` and an optional one is gone. Without one, only what
  the recording proves is dropped: a key one item of a list lacks is dropped
  from every item, a key one item holds `null` is `null` in every item. A lone
  object has nothing to prove anything with, and is left alone.
- **`mixed`** covers every combination that matters instead of adding items.
  Each field rotates through what it may be (every enum value, both booleans,
  null and set, absent and present, short and long text), the rotations side
  by side, so the list grows only to the longest rotation, never to a cross
  product, and at most to fifty or `maxItems`. A count is kept. A field set
  where no item holds a value borrows another item's, else samples its schema.

Lists are looked for three objects deep, which covers `{ data: { items } }`,
and never inside an item. An envelope key changes only when its value already
has the right type, so a `total` that is a sentence is left alone.

**Without a schema** nothing says a field may be null or which field a list is
keyed by, so a cursor is nulled on faith, and a list keyed by a field outside
the five names above repeats its keys under `many`. `long` also leaves alone a
single lowercase word of up to sixteen characters, which may be an enum, and
a fraction below one or a millisecond timestamp.

`long` and `sparse` walk the whole body, sixteen levels deep; `mixed`, like the
list states, looks for lists three objects deep.

## Shapes

A call's **shape** is one JSON Schema over what its data decodes to, and the
rung it came from: `supplied`, `router`, `validator`, `introspection` or
`sample`. `resolve` and `installMock` take a `shape(key)` lookup, asked only for
a call a body state reshapes. The type is `Shape` in `@maple-kit/core/mock`,
since the route writes it and the page reads it.

**The route serves shapes, per call, to a preview that asked.**
`RouteOptions.mock` is `{ preview, schemas }`: the host's preview build switch,
never `NODE_ENV`, since a preview is a production build; and OpenAPI documents,
each marked `rest` or `trpc`, highest rung first, or a function that reads them
once. `GET {base}/mock/schema?key=…` answers the shapes of up to a hundred keys
and leaves out any it has none for. It answers 404 unless `preview` is true,
and 401 to a reviewer the identity connector does not resolve, when there is
one. The documents are normalised on the first request, not at startup.

**The schema never reaches the page's bundle.** `installMock({ route })` reads
shapes from the route as calls need them, through the real `fetch`, one request
for every key asked in the same tick, and keeps every answer, a miss included,
for the page's life. Nothing under `route` is recorded or mocked. The Vite
example's `verify` checks that neither build carries its `openapi.json`.

**Router types, from `maple mock schema`.** `@maple-kit/cli` wraps
`@trpc/openapi`, which reads a router's TypeScript types statically, runs none
of its code, and needs no `.output()`:

```sh
maple mock schema server/router.ts --out=.maple/schema.json --superjson
```

The document it writes carries `x-maple-mock` (`codec: "trpc"`,
`source: "router"`, and `superjson` when asked), so `readSchemaDocument` hands
the route a document without being told what it is. **It is a preview build
artifact**: written by a step before the preview build and `next dev`, and
never committed, so it cannot fall behind the router it describes. The route
reads it on its first request, and without it has no shapes.

**`@trpc/openapi` is an alpha, and an optional peer.** It is loaded by dynamic
import inside that one command and nowhere else, pinned to one version, and a
missing install says which to add. Its programmatic API is used because the
alpha's own `bin` points at a file it does not ship. It asks for TypeScript
below 7, which holds the repository there while it is the rung this command
stands on. A subscription is not described; the generator does not yet do it.

**Normalising.** A `trpc` document has a path per procedure, `/project.list`,
and the shape is its 2xx answer's `result.data`. A `rest` document is keyed by
method and path, with `prefix` put in front, and a `{param}` segment matches any
one segment of a call's key. The first document that describes a key wins on
structure; the recorded or live answer still supplies the values. The box tags
each call with the rung its shape came from.

**A transform stays inside the schema.** A key is nulled only where it is
nullable (a type list with `null`, OpenAPI 3.0's `nullable`, a union with
`null`), dropped only where it is optional, and otherwise left as it was: an
empty page whose cursor is a required string keeps its cursor. `empty` and
`one` keep `minItems`, `many` stops at `maxItems`, and a repeated item takes
each enumerated field's next value, so `many` shows every status.

**A call nothing has answered is sampled from its schema.** When there is no
live answer and nothing recorded, the shape alone makes one, and the body
state reshapes it. The sample is deterministic, so a screenshot of it is the
same on every reload: `const`, then the first enum value, then an example or
a default, then the lower bound, one item, `"text"`, and fixed dates and
addresses by `format`. It ends a recursive schema eight levels down.

**It is not a dependency.** The sampler and the schema readers are about two
hundred lines in `src/schema/`, against openapi-sampler's whole surface, of
which this needs one function.

**A shape can say the call travels in superjson.** A sampled `date-time` is
then written as a `Date` in the envelope's `meta`, and tRPC's own client
decodes it to one. A failure on such a call is written in the envelope even
when nothing was ever recorded for it.

## The plan

A sentence becomes a recipe through `ClassifierConnector.plan`, an optional
method like `score` and `classify`: a classifier that can plan defines it, and
nothing else says so.

```ts
plan({ request, route, calls: [{ key, summary }] });
// → { state, distribution, confidence, calls: [{ key, concerned, p }] }
```

- **It picks, it writes nothing.** The answer is one of the nine states or
  `none`, and a verdict per call. The transforms and the sampler do the rest.
  A state joins the plan's vocabulary only with eval cases that measure it.
- **`none` is an answer.** "Make the header blue" names no state a page's data
  can be in, and a plan that says so is more use than a guessed `empty`.
- **A distribution, not a verdict**, as in `docs/assist.md`: a sentence
  between two states really is between them, and `confidence` says how much.
- **`concerned` is `p` at or above one half**, derived rather than chosen, so
  the two cannot disagree. Every call in the request gets exactly one verdict,
  in the request's order.
- **A summary is what the call returns**, in schema names and descriptions
  where a schema exists. A planner is given the calls' keys and summaries and
  never their bodies.

`MOCK_PLAN_STATES`, `stateFromWeights` and `plannedCall` in
`@maple-kit/core/connectors` are for a planner with no probabilities of its
own. `runClassifierContract` checks a plan's shape for any connector that
defines one.

**The route plans, the page never reaches a model.**
`RouteOptions.mock.plan` is `{ classifier, cacheSize?, rate? }`, and
`POST {base}/mock/plan` takes `{ request, route, calls: [{ key, summary }] }`
and answers `{ plan }`. It is gated as `/mock/schema` is: 404 unless `preview`
is true, 404 when the classifier does not define `plan`, and 401 to a reviewer
the identity connector does not resolve. A blank sentence is answered
`{ plan: null }` without asking anyone. A sentence is at most 500 characters,
and the calls at most a hundred.

It shares `/assist`'s budget code, not its budget: a cache of 200 plans keyed
by the whole request, and 40 plans a minute per reviewer. A classifier failure
is logged and answered 502 with nothing of the cause, since a provider's error
can name its key.

**The shapes add to each summary.** Where the shape index describes a call,
the route describes its schema in a line: title or component name,
description, field names, and a list's item in brackets, two levels deep, a
local `$ref` followed. `rest:GET /api/reviews` reads `items [Review: id, repo,
branch, …], total, nextCursor`, and `trpc:user.me` reads `User: id, name,
since`. When the page's words are all in that line, only the line is sent, and
the other way about; otherwise both, with a dash between. Only names reach the
planner; a value never does.

**`maple mock plan` asks a deployed route**, not a model:

```sh
maple mock plan "no projects yet" --url=https://preview.example.com/api/maple \
  --route=/projects "--calls=trpc:project.list,trpc:user.me"
```

It prints the recipe the box would put in its draft, `request` included, and
exits 1 with the reason when the gate says nothing: a sentence that names no
state, a plan under the floor, a route that plans nothing (404) or wants a
signed-in reviewer (401). Asking the route rather than a local classifier keeps
the model's key in the deployment, and gives CI the plan a reviewer would get,
schema names included. The gate is one function for both, `readPlan`, which is
why it lives in core rather than beside the box.

**The keyword planner** is `keywordClassifier().plan`, the floor the plan eval
measures against. State words pick the state (`no roasts`, `500`, `skeleton`,
`hundreds of`, `truncated`, `no avatar`, `every status`), and nothing matched
is `none`. "No" before a field a record may lack (`avatar`, `description`,
`owner`…) reads as `sparse`, before anything else as `empty`; "long" alone is
`long`, and "a long list" is torn between `many` and `long`, `many` first.
Every state starts with an equal share of a fixed prior, 1.4 in all, so adding
a state does not drag one matched word's confidence under the gate's 0.4
floor, as a fixed 0.2 each would have with nine. Words the sentence shares with
a call's key and summary pick the calls, a plural folded onto its singular and
a camel-cased key split into words. A sentence sharing no word with any call
is about the whole page, and concerns every call except a REST write and one
whose summary says `mutation`.

**A role or a flag picks no call.** Both planners judge the calls on the
sentence less the listed roles and flags it names, `withoutLayers`: a role as
the keyword planner reads one, a flag by its key's words with the words that
switch it or a listed value beside them, and a one-word key only with one of
those, since alone it may be the page's data. "As a member with the merge
forecast on, and the reviews table empty" is judged as "the reviews table
empty", and concerns the reviews call alone; left whole, jev read the role and
the flag as the whole page and put the session and the audit log in the state
too. jev still judges the state on the whole sentence, and gets the rest as
`data` beside it: "no roasts yet" alone reads as not yet a state. A flag named
in other words is left in, and the call question says who the page is shown as
and what is switched concern no call.

**The eval** is `evals/mock-plan.eval.test.ts`: 139 sentences against seven
pages' calls, scored on state accuracy, on the F1 of the calls a plan
concerns, and, on the three pages with flags and roles, on whether the flags
and role it sets are exactly the ones meant. It is scored per set: the 65
data cases, where jev must beat the word list on state and calls; 38
cases written for flags and roles, where it must beat it on the layers; and
36 written for `long`, `sparse` and `mixed`, where it must beat it on calls,
since the word list's patterns for those three were tuned on them.
`evals/cases/mock-plan/README.md` has the numbers, where the cases came from,
and why that flatters the word list.

It reads no grammar: "no errors" is `empty` and `error` at once, and two
states named equally come out torn between them, which is the honest answer
for a word list.

**jev plans in one request.** `jevClassifier().plan` sends the sentence, the
route and the calls as the `state`, and asks one `choice` over the seven plan
states, described by `MOCK_PLAN_STATE_DESCRIPTIONS`, and one `noul` per call:
does the sentence concern `calls[i]`? The probabilities are jev's own: the
state's distribution is the choice's, and each call's `p` is its `noul`. A
route with no calls asks only the state. The questions are keyed by index,
`call:0`, since a call key is any text.

A plan is a keystroke's judgement like a score, so there are no retries, and
`timeoutMs` (8 s by default) abandons one the endpoint never answers.

**The plan learns flags and roles.** The box lists the flags the page
evaluated, `{ key, type, variants? }` from `seenFlags()` and never a value,
and the route adds the roles from its own identity rules, never the page's.
The route drops a flag with no values a plan could set it to, and keeps an
answer to what was listed: a flag, a value or a role nobody listed is
dropped, whatever the planner said. A plan answers one `PlannedFlag` per
listed flag, `{ key, value, concerned, p }` with `value` one of its values,
and a `role` when the sentence names a listed one.

- **The gate carries them.** Named flags and a role at even odds or better
  ride on each state's reading, or make a reading of their own when the
  sentence names no state: "as a barista" sets the role and the flag, not
  "That doesn't name a state".
- **The keyword planner** sets a flag when every word of its key is in the
  sentence (a camel-cased or kebab key split, a ticket prefix like
  `ROAST-2210-` dropped), on unless "no", "without", "off" or the like sits
  next to it, and a variant only when the sentence names exactly one. A role
  is read only after "as", "for", or before "view", "sees": "the owner column"
  names no role. It never reads a key out of the sentence.
- **jev asks for them in a second request**, sent beside the first: one
  `choice` per flag over its values and `leave-unchanged`, and one over the
  roles and `no-role-named`, with the sentence, every flag's values and the
  roles as that request's `state`. The first request is exactly what it is
  without them. A host role named like the person typing, `reviewer`, is read
  poorly, since every question calls that person the reviewer; the Vite
  example's roles are `owner`, `member` and `guest` for that reason. Putting the lists in one shared `state` cost the data cases
  about two points of state accuracy, measured, which is why it is not done.

## Who the reviewer is

Maple never guesses which of a page's fields carries authorisation. The host
names it in `RouteOptions.mock.identity`:

```ts
identity: {
  call: "rest:GET /api/session",
  role: { path: "role" },
  permissions: { path: "permissions" },
  requires: {
    "rest:GET /api/audit": { roles: ["owner", "auditor"] },
    "rest:DELETE /api/roasts/:id": { permission: "roast:delete" },
  },
}
```

- **`call` says who the reviewer is**, and `path` is a dotted path into its
  answer. The permissions field is a list of names or an object of booleans.
- **The words are the host's.** A field's `values` are the ones given, else
  the call's shape's: a role's `enum`, a list's item `enum`, an object's
  property names. Every role and permission `requires` names is added.
- **`requires` says what a call needs**: any one of `roles`, or `permission`
  granted. It is what turns a call into the page's own 403 under `as`.

`GET {base}/mock/identity` serves the rules with each vocabulary filled in,
gated as `/mock/schema` is, and answers 404 when the host declares none.

**The page applies them.** `installMock({ route })` reads the rules once, and
only when the recipe has `as`; `installMock({ identity })` supplies them
instead.

- **The identity call's answer is told the recipe's identity**: the role
  written at its path, and each permission named added to or taken from the
  list, or set in the object. A role outside the rules' words is left as the
  server said it, and a warning says so.
- **A call the shown identity may not make answers 403**, in the protocol's
  own error shape, and is never sent. The identity is the recipe's where it
  names a role or permission, and otherwise the reviewer's own, as the
  identity call last answered. A need nothing can judge is let through: the
  server decides. A call the recipe names keeps its named state.
- **A write is not blocked.** The server still acts as the reviewer, so a
  write it allows really happens. Each one that reaches the server is logged
  as a warning and listed on the handle's `writes`, for a surface to say.
- **Nothing changes without rules.** A recipe with `as` on a route that
  declares none mocks only its calls, and a warning says so.

## Flags

A recipe's `flags` answer flags where the page evaluates them.

**OpenFeature**, the most portable, is `withMockFlags(provider)` from
`@maple-kit/mock/openfeature`:

```ts
OpenFeature.setProvider(withMockFlags(new VendorProvider(options)));
```

- **It answers the flags the recipe names and delegates the rest.** An
  answered flag carries `variant: "maple-mock"` and reason `STATIC`. A value
  of the wrong type answers OpenFeature's own `TYPE_MISMATCH`, as a provider
  would, rather than a value the page did not ask for.
- **It is typed structurally**, so it wraps a web or a server provider and
  imports neither SDK. `@openfeature/*` are not dependencies of the package.
- **A change to a named flag is held back.** A provider's configuration change
  is passed on without the keys the recipe names, and not at all when nothing
  is left, so the page never re-reads a flag it is being told something else
  about.
- **Every evaluation is recorded** with the provider's real value in
  `seenFlags()`, the page's one registry, for the box to list.
- **The recipe is the page's** by default, through the installed handle's
  `current()`. A server passes the request's, from `requestRecipe` (see
  "The recipe on the server").

**A vendor on the wire** is a flag source, `installMock({ flags: [...] })`,
for a page whose SDK is not behind OpenFeature. A source says which request
asks for flag values, reads the real ones for `seenFlags()`, and writes the
recipe's in; the interceptor forwards the request and answers with the
rewrite. Such a request is never recorded as one of the page's calls.

**LaunchDarkly** is `launchDarklyFlags({ baseUri?, streamUri? })` from
`@maple-kit/mock/launchdarkly`. Its browser SDK's format was read from the
source of `@launchdarkly/js-client-sdk` 4.10.3, and the tests run 4.10.2's
real client against a fake poll.

- **The 3.x SDK polls the same paths at another host.**
  `launchdarkly-js-client-sdk` 3.x, which `launchdarkly-react-client-sdk`
  3.x wraps, defaults `baseUrl` to `https://app.launchdarkly.com` where 4.x
  uses `https://clientsdk.launchdarkly.com`. Read from
  `launchdarkly-js-sdk-common` 5.8.0: the same `/sdk/evalx/…` GET and
  REPORT, the same answer, over `XMLHttpRequest`, and the same stream host.
  With no `baseUri`, both default hosts are claimed. A 3.x page that sets
  `baseUrl` passes it as `baseUri`.

- **The poll is `GET /sdk/evalx/{env}/contexts/{context}`**, or a `REPORT`
  to `…/context`, over `fetch`, answered by an object keyed by flag key. This
  is FDv1, the SDK's default. FDv2, which runs only when `dataSystem` is
  passed, is not read.
- **A named flag is answered with the largest safe version.** The SDK ignores
  a `patch` or `delete` that is not newer than the version it holds, so no
  real change replaces it. Its `variation` and `reason` are dropped, since
  they describe the real evaluation.
- **The stream is the page's `EventSource`, wrapped** while a recipe has
  flags. A `put` is rewritten; a `patch` or `delete` of a named flag is
  dropped; a `ping` makes the SDK poll again, which is rewritten too.
- **The SDK caches what it is told** in `localStorage` and shows it before
  its next poll answers, so the first load after Turn off shows the mocked
  values until that poll does. `disableCache: true` on a preview avoids it.
- **Evaluation events still go to LaunchDarkly**, with the mocked value.

`@maple-kit/mock/testing` has `runFlagProviderContract`, the suite every
wrapped provider runs, and `memoryFlagProvider`. The package's own tests run
it against the memory provider and wrap OpenFeature's own in-memory providers
under the web and the server SDK.

## The inventory

The last real 2xx answer of every call, per route pattern, in memory and in
`sessionStorage` so it survives the reload that applies a mock. A mocked answer
is never recorded. It is bounded to twenty routes, fifty calls a route, and
keeps a body over 64 KB of JSON in memory only. A full or blocked storage
leaves it working in memory.

## The box

`<MapleMock />` from `@maple-kit/ui/mock` is how a reviewer picks a state. It
lists the calls the page has made on this route, each with one button naming
its state, and Apply reloads into the choice. The button opens a menu of Real,
marked with a green dot as what the page does on its own, and the nine states.
Nine buttons per call made the box a wall of options that a reviewer scanned
past; the menu keeps each row to one line. It is a `popover="auto"` in the top
layer, since the box's body scrolls, and it closes when the body does. `m`
opens and closes the box and Escape closes it; inside an open menu, Escape
closes only the menu (`watchEscape` in `@maple-kit/core/client` leaves an open
`popover="auto"` its own Escape).
Inside `<Maple />` it is `Maple.Mock`, the same part, in the overlay's own
shadow root.

It is three layers, split as the overlay is:

- **`createMockClient()`** in `@maple-kit/mock/client` holds every rule: the
  draft, the filter, what is in force on this route, Apply, Turn off and the
  two copies. It touches no DOM until `start()`.
- **`useMock()`** in `@maple-kit/react/mock` is one subscription over it.
- **`MapleMock`** draws it, and touches no storage: persistence is the
  client's.

**The box finds the transport rather than importing it.** `installMock` leaves
its handle on the page, and the client reads it there. `<Maple />` therefore
carries the box's code on every page but the interceptor only where the host
installed it; with none installed the box draws nothing and does not bind `m`.
The Vite example's `verify` checks both halves: a production build with
`<Maple />` mounted carries no interceptor, and its mock-only page carries none
of the island, the composer or the marks.

**On its own it has its own shadow host** and adopts `MOCK_CSS`: the tokens,
the base rules and the box's, which `scripts/size.js` keeps under 8.5 KB with
everything it reaches. Its scheme is the opposite of the page's, as the
overlay's is by default.

**A banner is on while a mock is**, naming the first call and counting the
rest. It has Edit and Turn off and no dismiss: a reviewer who forgets a mock is
on reads mocked data as real. It docks bottom-left, where a host's own controls
rarely are and the island is not (bottom-right); under 640 px it takes the width
and sits a row above the island, wrapping rather than covering the top bar.

**Where the route plans, the field is a sentence.** `installMock({ route })`
leaves a `plan` lookup on the handle beside `shape`, over the real `fetch`, and
the client asks it 500 ms after typing pauses, abandoning the request before.
It sends every call recorded on the route with a summary of the names in its
last answer, never a value. The list is not filtered while it plans.

What comes back passes the calm-UI gate, `readPlan` in `@maple-kit/core/mock`,
before anything is drawn:

| The plan                                  | The box                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| confidence below 0.4                      | nothing                                                 |
| `none`                                    | "That doesn't name a state this page's data can be in." |
| a state, the runner-up more than 0.15 off | the calls go into that state                            |
| the runner-up within 0.15                 | the likelier one, alone                                 |
| no call concerned                         | nothing                                                 |

The reading goes straight into the draft, over what the draft held before the
sentence, and the sentence goes into the recipe's `request`. A chip to take it
was one more thing to read and click between the sentence and the result. Each
new reading replaces the last one over that same starting point; emptying the
field puts it back, and so does a sentence that names no state. A change by
hand makes the draft the reviewer's own, so emptying the field after it keeps
it. While a plan is on its way a sweep runs along the field's lower edge
(`aria-busy`), so nothing moves when it lands. A failure is swallowed, as the
assist tier's is, and a 404 turns the field back into a filter for the page's
life: every word must match a key, as before a plan existed. `plan: false`
keeps it a filter.

A call the recipe names that this route never recorded is listed after the
rest, since a mocked answer is never recorded.

**Flags and who the page is shown as are a second panel**, under the calls,
and the two scroll together between the field and the footer, so a short
window never squeezes the calls to a sliver. A reading scrolls the rows it set
into view. The panel is
a role picker and a Granted / Taken away pair per permission, from the
host's identity rules (`handle.identity()`, read once from
`/mock/identity`), and a toggle per flag the page evaluated (`seenFlags()`):
On / Off for a boolean, its variants where the source lists them, and its
real value, read-only, otherwise. Each row starts on the real value, marked
with a green dot: the role and permissions from the identity call's last real
answer (`MockClientState.realAs`), a flag from what the page evaluated.
Choosing the real option, or the chosen one again, drops the override. The
role is always shown; permissions and flags fold to `Permissions · 8` and
`Flags · 12`, since a host can declare dozens and a page evaluate hundreds, and
a folded list still shows every row the draft overrides. The words are the
host's and the page's; the box has no role list.

- **It is a lazy chunk.** `mock/layers.js` is loaded by a dynamic import only
  when the page has identity rules, has evaluated a flag, or has a recipe with
  either layer, so the box alone stays under 8.5 KB. `scripts/size.js` weighs a
  dynamic import as its own entry (2.5 KB), and fails on one no budget names.
- **The banner says what `as` cannot do**, exactly: "Showing as barista. The
  server still acts as you." It counts the flags set, and every write that
  reached the server under `as`: "2 writes reached the server as you."
- **A recipe can name no call.** Flags or `as` alone apply, copy and link.

**Without a store, the box shares a mock by copying**: Copy link writes the
page's URL with the recipe in `?maple-mock=`, and Copy recipe writes the JSON.
`RouteOptions.store` is optional for such a host, and the comment endpoints
answer 404 without one.

## A comment remembers the mock

A comment written while a mock is on stores the recipe as `context.mock`: every
call it named and the state it was put in, the route pattern, and the sentence
behind it. The recipe, not the mocked bodies: `error`, `forbidden`, `loading`
and `empty` replay identically, while `one` and `many` reshape whatever the
server answers at replay time. Bodies would cost the fence space and could put
a page's real data in a public pull-request comment.

- **The page says what is in force.** `installMock` leaves `current()` on its
  handle, the recipe when it applies on the page's route, and core's
  `activeRecipe()` reads it by `MOCK_HANDLE_KEY` without importing the
  interceptor. `captureContext` records it with the viewport and the scheme.
- **The fence reads it through `parseRecipe`.** A recipe a build cannot read is
  dropped from the comment rather than failing the ledger; the comment stays.
- **It is the first detail shed** when the fence is over budget, before the
  quote's context: a replay is worth less than the words that locate a
  comment. Nothing is shed where no comment carries a recipe.
- **The ledger row says `mocked`** beside the viewport, so a person reading the
  pull request knows the page looked unlike the preview does now, and
  `mocked as billing-manager, without invoice:void` under `as`.
- **An agent gets it back from `get_comment_context`** as `mock.recipe`, with
  `mock.replay`, the comment's page with the recipe in `?maple-mock=`, and a
  `mocked: trpc:roast.list empty (…)` line in its conditions that names the
  flags and the identity too, and says the server acted as the reviewer. The link's
  encoding, `encodeRecipe` and `linkRecipe`, is core's, beside the recipe.
- **`maple-action` reads the fence through core's `githubStore`**, keeps
  fields it does not know, and the fence stays version 1: the field is
  additive. A `maple-action` on an older core drops a version 2 recipe from
  the comment and keeps the comment. It moves to the core that writes it in the same release.

## The recipe on the server

After the first load the recipe lives in `sessionStorage`, which a server never
sees, so a flag evaluated in a server render would show its real value. The
page keeps a `maple-mock` cookie for it, and `requestRecipe(request)` from
`@maple-kit/mock/server` reads it:

```ts
OpenFeature.setProvider(withMockFlags(provider, { recipe: () => requestRecipe(request) }));
```

A server whose provider is shared by every request, as OpenFeature's global
one is, keeps each request's recipe in an `AsyncLocalStorage` for the
duration of the evaluation. The Next example's `server/flags.ts` does, and
only on a preview:

```ts
const rendering = new AsyncLocalStorage<Recipe | undefined>();
OpenFeature.setProvider(withMockFlags(provider, { recipe: () => rendering.getStore() }));
rendering.run(requestRecipe(request), () => client.getBooleanValue("launch-week", false));
```

A server component has no URL, so the example builds `url` from its
`searchParams` and passes `headers()`. That makes the page dynamic on a
preview only; a production build never reads the request and stays static.
A flag evaluated only on the server is not listed in the box, whose list is
the page's own `seenFlags()`: a link or a copied recipe sets it.

- **Only a preview writes it.** The interceptor sets it on install and the box
  on Apply, before the reload, so the reloaded page's server render reads it.
  Turn off, a recipe that cannot be read and no mock at all clear it. A
  production build has no interceptor and no box, so it never sets one.
- **It carries the layers a server evaluates**: `flags`, `as` and `route`,
  never `calls` or `request`. Calls are answered in the page, and leaving them
  out keeps the cookie small. A recipe with neither layer clears it, so the
  cookie exists only while a server-side layer is on.
- **It is site-wide, `SameSite=Lax`, and `Secure` over HTTPS**, and lasts the
  browser session. It is not `HttpOnly`, because the page writes it.
- **Over 4096 bytes it is not written.** Browsers drop a larger cookie without
  a word, which would show real flag values in a mock that says otherwise, so
  the interceptor clears it and warns, and the page's own layers still apply.
- **A `?maple-mock=` link in the request's own URL wins** over the cookie, as
  it does in the page. A link or cookie that cannot be read is no recipe.
- **The route is not checked.** An API request made for a page has the API's
  path, not the page's, so a server that cares compares `route` itself.
- **It is a subpath of its own**, not `./node`, because `./node` imports MSW,
  an optional peer a server that only reads the cookie does not have.
- **It is opt-in.** Nothing reads the cookie unless the host calls
  `requestRecipe` from its own server code.

## What is not done

- A vendor other than LaunchDarkly on the wire, and a flag's value typed in
  the box: a string or number flag with no variants listed is read-only.
- `as` in `mockHandlers`, which takes no rules. On the server `requestRecipe`
  gives the host the recipe's `as`, and applying it there is the host's code.

- A recorded error body shape. REST `error` answers `{ message }`, and tRPC
  answers its default error shape.
- A delay for `loading`. It holds until the page reloads, and a held call in a
  batch holds the whole batch.
- A second box on the same page. Each claims `m`, and the first to hear it
  opens.
- A streamed procedure whose data is itself a promise or an async iterable.
  Such a stream is not read, so it is neither recorded nor reshaped.
