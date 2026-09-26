# @maple-kit/mock

The runtime behind Maple Mock: a page's API responses, rewritten into the state
a reviewer asked to see — empty, failing, forbidden, loading, one item or a
thousand — and its flags and role set to whatever the reviewer names.

**Pre-release.** Every package here is 0.x and makes no compatibility promise.

<table>
<tr>
<td width="50%" valign="top"><img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/edge-case-states.gif" alt="A table of open reviews loads with real data, then empty, then failing, with a banner naming the state each time." width="100%"><br><b>Any state, on request.</b> The same table with real data, then empty, then failing. A banner names the state in force.</td>
<td width="50%" valign="top"><img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/external-variables.gif" alt="A reviewer types 'as a member, with the merge forecast on', and the mock box sets the role to member and turns the merge-forecast flag on." width="100%"><br><b>As any user, with any flag.</b> "As a member, with the merge forecast on" becomes a role and a flag, checked before the page reloads.</td>
</tr>
</table>

## Why

The states a reviewer most needs to see are the ones a preview never shows:
the empty dashboard, the failed request, the page a viewer is not allowed to
open. Maple Mock puts a preview into any of them from one sentence, with no
fixtures to write and no backend to seed.

**A model picks; code writes every byte.** A classifier may be asked which
state was meant and which calls it concerns. It is never asked to write a
response body. A transform reshapes the response the page already received,
or one sampled from its schema, so the app's own parser still accepts the
result. Nothing in the runtime calls a model.

## The states

| State       | What the page receives                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `empty`     | Each list as `[]`, with the envelope beside it: count `0`, no next page.    |
| `one`       | The first item, with the same envelope.                                     |
| `many`      | The items repeated to fifty, each with a unique id, and the count to match. |
| `long`      | Every text as long as the page could really receive, to its `maxLength`.    |
| `sparse`    | Everything that may be missing, missing.                                    |
| `mixed`     | Every combination that matters, rather than more items.                     |
| `error`     | A 500 in the protocol's own error shape; GraphQL's `errors` at 200.         |
| `forbidden` | A 403 in the protocol's own error shape; GraphQL's `FORBIDDEN` at 200.      |
| `loading`   | Nothing, until the request is abandoned.                                    |

A failure never reaches the server: a write named `error` is answered in the
page and never sent.

## Install

```ts
// The app's entry, first line, on preview builds only.
import "@maple-kit/mock/install";
```

or, with options:

```ts
import { installMock } from "@maple-kit/mock";
import { launchDarklyFlags } from "@maple-kit/mock/launchdarkly";

if (__MAPLE_PREVIEW__) {
  installMock({ route: "/api/maple", flags: [launchDarklyFlags()], logger });
}
```

`route` is where Maple's route is mounted. Nothing under it is mocked, its
`/mock/schema` answers each call's shape, and its `/mock/plan` reads a
sentence. Behind a build-time constant, a production build drops the import
entirely.

It patches `fetch` and `XMLHttpRequest` and reads REST, tRPC (batches, streams
and superjson included) and GraphQL (APQ and persisted documents included). A
call the recipe does not name passes through untouched.

## The box

`<MapleMock />` from `@maple-kit/ui/mock` is the box a reviewer types into,
over `createMockClient()` from `@maple-kit/mock/client`. Inside `<Maple />` it
is already mounted. It lists the calls the page made, reads the sentence into
a plan, and lets the reviewer check and change it before **Apply and reload**.
**Copy link** gives anyone else the same page in the same state.

## The recipe

A mock is a small record, validated by `parseRecipe` from
`@maple-kit/core/mock`:

```ts
{
  version: 2,
  calls: [{ key: "rest:GET /api/reviews", state: "empty" }],
  flags: { "merge-forecast": true },
  as: { role: "member" },
  route: "/reviews",
  request: "as a member, with no reviews and the merge forecast on",
}
```

Applying one reloads the page with the recipe in `sessionStorage` and in the
`?maple-mock=` parameter, so a link reproduces it:

```ts
import { linkRecipe } from "@maple-kit/core/mock";
import { saveRecipe } from "@maple-kit/mock";

saveRecipe(sessionStorage, recipe);
location.assign(linkRecipe(location.href, recipe));
```

A comment written under a mock records the recipe, so the agent reading it
over MCP gets a link that replays the page the reviewer saw.

## Planning from a sentence

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/cli.gif" alt="A terminal: an agent runs maple mock plan with --json against the preview and gets back a recipe that mocks only the reviews call, as empty." width="480">
</p>

The route's `/mock/plan` turns a sentence into a recipe, through any
classifier that defines `plan`: `keywordClassifier()` from
`@maple-kit/core/connectors` offline, or
[`@maple-kit/classifier`](../classifier#planning-a-mock) with a model. The
`maple` CLI asks the same route, so an agent or CI gets the box's own plan
without holding a key:

```sh
maple mock plan "the reviews list is empty" \
  --url=https://preview.example.com/api/maple \
  --route=/reviews --calls="rest:GET /api/reviews" --json
```

For tRPC, `maple mock schema server/router.ts` writes the OpenAPI document the
route serves as each call's shape.

## Flags and roles

A recipe's `flags` are answered where the page evaluates them, and `as` tells
the page who the reviewer is. The server still acts as the real reviewer.

**OpenFeature**, the most portable, wraps the provider you already have. It
answers the flags the recipe names and delegates every other one:

```ts
import { withMockFlags } from "@maple-kit/mock/openfeature";

OpenFeature.setProvider(withMockFlags(new VendorProvider(options)));
```

**LaunchDarkly** is read on the wire instead: `launchDarklyFlags()` from
`@maple-kit/mock/launchdarkly`, passed to `installMock({ flags })`, answers the
browser SDK's poll and stream with the recipe's flags written in.

**The role** comes from the host's own session call, named in the route's
`mock.identity`. Maple never guesses which field carries authorisation, and a
call the role may not make answers the page's own 403:

```ts
identity: {
  call: "rest:GET /api/session",
  role: { path: "role" },
  permissions: { path: "permissions" },
  requires: { "rest:GET /api/audit": { roles: ["owner"] } },
}
```

**On the server**, `requestRecipe(request)` from `@maple-kit/mock/server`
reads the recipe from a request's `?maple-mock=` link or the page's cookie, for
flags and roles evaluated in a server render.

## Tests and Storybook

For Storybook or a test that already runs MSW, put the handlers first:

```ts
import { mockHandlers } from "@maple-kit/mock/node";

const server = setupServer(...mockHandlers(recipe), ...handlers);
```

## Entries

| Entry                          | What it is                                                                 |
| ------------------------------ | -------------------------------------------------------------------------- |
| `@maple-kit/mock`              | `installMock`, and reading and writing the recipe: link, tab, encode.      |
| `@maple-kit/mock/install`      | The in-page transport with every default, imported first from the entry.   |
| `@maple-kit/mock/client`       | The box's controller, which finds the transport without importing it.      |
| `@maple-kit/mock/openfeature`  | `withMockFlags(provider)`, for flags evaluated through OpenFeature.        |
| `@maple-kit/mock/launchdarkly` | `launchDarklyFlags()`, LaunchDarkly's browser SDK answered on the wire.    |
| `@maple-kit/mock/server`       | `requestRecipe(request)`, the recipe for flags and roles read server-side. |
| `@maple-kit/mock/msw`          | Handlers for a host that already runs MSW's `setupWorker`.                 |
| `@maple-kit/mock/node`         | The same handlers for `setupServer` in tests or a server render.           |
| `@maple-kit/mock/testing`      | The flag-provider contract suite and an in-memory provider. Needs vitest.  |

This package uses no React, no Effect and no model. `@maple-kit/ui` and
`@maple-kit/react` import it; it never imports them.

## Documentation

- [Maple Mock](https://github.com/maple-kit/maple/blob/main/docs/mock.md) — the design record: the recipe, the codecs, the transforms, the plan, flags and roles

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
