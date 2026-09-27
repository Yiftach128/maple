# @maple-kit/cli

The `maple` binary for [Maple](https://github.com/maple-kit/maple) — visual
review comments on deployed previews, written for people and read by agents.

**Pre-release.** Every package here is 0.x and makes no compatibility promise.

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/cli.gif" alt="A terminal: an agent is asked to put the reviews table in its empty state, runs maple mock plan with --json against the preview, and gets back a recipe that mocks only the reviews call, as empty." width="480">
</p>

Every command that prints a table also takes `--json`, so an agent drives it
from a terminal as easily as a person does.

## Install

```sh
npm install -g @maple-kit/cli
```

## Commands

| Command                        | What it does                                                          |
| ------------------------------ | --------------------------------------------------------------------- |
| `maple mock plan "<sentence>"` | Prints the recipe a preview's route plans for a sentence.             |
| `maple mock schema <router>`   | Writes an OpenAPI document of a tRPC router's response types.         |
| `maple connectors`             | Shows each connector kind and the methods it requires or may define.  |
| `maple setup app`              | Prints the prefilled GitHub App registration URL and what follows.    |
| `maple setup verify`           | Checks that a comment App has Device Flow on.                         |
| `maple setup ci`               | Prints or writes the gate workflow, and the ruleset that requires it. |

### `maple setup`

Registering Maple's GitHub Apps, and gating a merge on the review. The
permissions each App is registered with are one constant in this package,
`GITHUB_APP_PERMISSIONS`, so this is where they are read from rather than
copied.

```sh
maple setup app --owner=acme            # the comment App: pull_requests=write
maple setup app --owner=acme --gate     # the gate App: checks=write
maple setup verify --client-id=<Iv…>     # exits 1 if Device Flow is off
maple setup ci --require-approval --write
```

`setup app` prints a URL that opens GitHub's New GitHub App form already filled
in, then the steps no URL parameter can set: Device Flow, token expiry, the
logo, the installation and where the Client ID goes. `--personal` registers
under a personal account instead of an organisation, and `--json` prints the
URL, permissions and steps as one object.

`setup verify` asks GitHub for a device code the way a reviewer's first sign-in
will, and prints neither code it receives.

`setup ci` writes `.github/workflows/maple.yml` on `maple-kit/maple-action@v0`,
refusing to overwrite one that is there, and prints the `gh api` command that
makes `maple/visual-review` a required check pinned to GitHub Actions.

### `maple mock plan`

Asks a deployed Maple route to read a sentence as a mock, and prints the
recipe [Maple Mock](../mock)'s box would apply. It asks the route rather than a
model, so CI holds no key and gets exactly the box's own plan.

```sh
maple mock plan "the reviews list is empty" \
  --url=https://preview.example.com/api/maple \
  --route=/reviews \
  --calls="rest:GET /api/reviews,rest:GET /api/audit" \
  --json
```

```json
{
  "version": 2,
  "calls": [{ "key": "rest:GET /api/reviews", "state": "empty" }],
  "route": "/reviews",
  "request": "the reviews list is empty"
}
```

| Flag      | What it is                                                               |
| --------- | ------------------------------------------------------------------------ |
| `--url`   | Where Maple's route is mounted on the preview.                           |
| `--route` | The page's route pattern the recipe applies on, such as `/projects/:id`. |
| `--calls` | The calls the page makes, comma-separated, named as the box names them.  |

It exits 1, saying why, when the sentence names no state or the plan is not
sure enough to mock anything: the same gate the box applies.

### `maple mock schema`

```sh
maple mock schema server/router.ts --out=.maple/schema.json [--export=AppRouter] [--superjson]
```

Reads the router's TypeScript types statically, runs none of its code, and
writes the document Maple's route serves as each call's shape. It needs
`@trpc/openapi`, an optional peer loaded only by this command.

### `maple connectors`

```
Connector kinds
  store         required: list, append
                optional: appendMany, setStatus, head, watch, approvals, approve, unapprove
  media         required: putBlob, getUrl
                optional: remove
  observability required: getReplayLink
                optional: fetchEvents
  identity      required: resolveUser
                optional: none
  gate          required: publish
                optional: read
  classifier    required: none
                optional: score, classify, plan
```

Built from core's own tables, so it cannot drift from the code. A connector's
capabilities are exactly the methods it defines.

## Reading comments from a terminal

Listing, reading and resolving review comments is the agent's job, over
[`@maple-kit/mcp`](../mcp).

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
