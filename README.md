<a href="https://blog.nitzan.fyi/introducing-maple"><picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/assets/card-dark.svg">
<img src="docs/assets/card.svg" alt="Maple: visual review comments on deployed previews, written for people and read by agents. Read the intro post." width="100%">
</picture></a>

<a href="https://maple-kit.org"><img src="https://img.shields.io/badge/site-maple--kit.org-465a2b?style=flat-square&labelColor=1a1d23" alt="maple-kit.org"></a>
<a href="https://github.com/maple-kit/maple/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/maple-kit/maple/ci.yml?branch=main&label=CI&style=flat-square&color=465a2b&labelColor=1a1d23" alt="CI"></a>
<a href="https://www.npmjs.com/package/@maple-kit/core"><img src="https://img.shields.io/npm/v/@maple-kit/core?style=flat-square&label=%40maple-kit%2Fcore&color=465a2b&labelColor=1a1d23" alt="@maple-kit/core on npm"></a>
<a href="LICENSE"><img src="https://img.shields.io/github/license/maple-kit/maple?style=flat-square&color=465a2b&labelColor=1a1d23" alt="Apache-2.0"></a>

<p align="center">
  <img src="docs/assets/demo.gif" alt="A reviewer opens Maple on a dashboard that already carries nine comments, picks the date range in the top bar, and writes that it reads as a label rather than a control. As they type, the assist tier scores the comment against five pillars and calls it a request. They publish it, a new pin lands on the date range, and the count reads ten open." width="100%">
  <br>
  <sub><a href="docs/assets/demo.mp4">Watch it as video</a> · recorded from <a href="examples/vite-app">the Vite example</a> by <a href="tools/demo-recorder">tools/demo-recorder</a></sub>
</p>

A reviewer points at something on a preview deployment and says what is wrong.
Maple captures where they pointed, what they were looking at and who they are,
hands it to a coding agent in a form it can act on, and holds the merge until
every comment is resolved.

**Status: 0.x.** All eight packages are published, with provenance, through a
trusted publisher. 0.x makes no compatibility promise: a public interface is
broken when breaking it is the right shape, and the changeset says what broke.

## What it does

<table>
<tr>
<td width="33%" valign="top"><a href="packages/ui"><img src="docs/assets/features/three-types.gif" alt="Three picks in a row: a metric card, a box dragged over part of a chart, and a sentence selected under it." width="100%"></a><br><b>An element, an area, or a passage.</b> Pick a component, drag a box, or select the words that are wrong. The anchor finds it again after a redeploy.</td>
<td width="33%" valign="top"><a href="packages/mcp"><img src="docs/assets/features/agentic-tooling.gif" alt="A terminal: the agent waits for comments, receives one naming a file and line, edits one line, and resolves the comment in a commit." width="100%"></a><br><b>Your agent picks it up over MCP.</b> It waits for comments, reads each with its context, makes the change, and resolves it against the commit.</td>
<td width="33%" valign="top"><a href="docs/gate.md"><img src="docs/assets/features/merge-gate.gif" alt="A pull request's checks: maple/visual-review fails with two comments open, they resolve, the check passes and the merge button wakes up." width="100%"></a><br><b>A merge gate.</b> <code>maple/visual-review</code> fails while a comment is open and, if you want, until the reviewer approves.</td>
</tr>
<tr>
<td valign="top"><a href="packages/core"><img src="docs/assets/features/tagger.gif" alt="In developer mode, hovering the page shows each element's component name and its file, line and column." width="100%"></a><br><b>The file and the line.</b> A build-time tagger marks every JSX element with where it was written, so a comment arrives pointing at source.</td>
<td valign="top"><a href="packages/mock"><img src="docs/assets/features/edge-case-states.gif" alt="A table of open reviews loads with real data, then empty, then failing, with a banner naming the state each time." width="100%"></a><br><b>Any state, on request.</b> Type empty, failing or a thousand rows, and the page's API calls return it. A model picks the state; code writes every byte.</td>
<td valign="top"><a href="packages/classifier"><img src="docs/assets/features/assist-scoring.gif" alt="A reviewer types a comment on a chart and it is scored as a request, rated on being specific, actionable, concise, standalone and placed." width="100%"></a><br><b>A score, if you want one.</b> The comment is judged as it is typed, against five pillars, by a classifier you supply.</td>
</tr>
</table>

Each package's README shows the rest: [the CLI](packages/cli), [the design
lint](packages/lint), [flags and roles in a mock](packages/mock#flags-and-roles)
and [the connectors](packages/core#connectors).

## Why another one

Pincushion, Vercel Toolbar, Chromatic, BugHerd and Marker.io each do some of
this. None combines all four of:

- **Open source**, Apache-2.0, with no hosted service required.
- **Deployed previews.** Maple runs on the preview URL your CI already builds,
  so anyone with the link can comment — a designer, a product manager, a client.
  Tools like Agentation run against `localhost`, which means the only person who
  can leave a comment is the person running the build.
- **A merge gate** — CI blocks while a visual comment is unresolved, and
  optionally until somebody says they looked. See [`docs/gate.md`](docs/gate.md).
- **An agent loop** — the agent reads comments, fixes, and resolves them.

## Add it to an app

```sh
npm install @maple-kit/core @maple-kit/ui @babel/core
```

`@babel/core` is an optional peer, and the tagger is what needs it: leave it out
and `tagger: true` has nothing to transform with.

Mount the route and the tagger from the build, then render the overlay:

```ts
// vite.config.ts
import { createCommentStore } from "@maple-kit/core";
import { githubStore } from "@maple-kit/core/connectors";
import { maple } from "@maple-kit/core/vite";

const preview = process.env.MAPLE_PREVIEW === "1";

export default defineConfig({
  plugins: [
    react(),
    maple({
      tagger: preview,
      route: {
        // Local development only: every comment is written as this one token.
        store: createCommentStore(
          githubStore({ owner: "acme", repo: "web", token: process.env.GITHUB_TOKEN! }),
        ),
      },
    }),
  ],
});
```

```tsx
// main.tsx
import { Maple } from "@maple-kit/ui/maple";

createRoot(root).render(
  <>
    <App />
    <Maple branch={import.meta.env.VITE_MAPLE_BRANCH} />
  </>,
);
```

The shared `GITHUB_TOKEN` is for trying Maple on your own machine. A preview
other people review builds the store per request from each reviewer's own
token — the resolver in
[`docs/github-auth.md`](docs/github-auth.md#configuration) — so a comment is
authored by whoever wrote it and no GitHub secret sits in the preview.

Next.js uses `withMaple` from `@maple-kit/core/next` and a catch-all route at
`app/api/maple/[...maple]/route.ts`; [`examples/next-app`](examples/next-app)
has both. The `setup-maple-org` skill walks through the GitHub App a reviewer
signs in with.

## Use with Claude Code

The Maple plugin bundles the skills that set Maple up and act on its
comments, and the MCP server that reads and resolves them:

```
/plugin marketplace add maple-kit/maple
/plugin install maple@maple-kit
```

The server reads `GITHUB_TOKEN`, `MAPLE_GITHUB_OWNER` and `MAPLE_GITHUB_REPO`
from the environment Claude Code starts in. The Stop hook is not bundled yet;
the `setup-maple-agent-loop` skill adds it by hand.

## Vendor-agnostic by construction

Maple stores nothing itself. A connector is one file implementing plain
Promise-returning methods:

```ts
import type { StoreConnector } from "@maple-kit/core/connectors";

export function myStore(options: MyOptions): StoreConnector {
  return {
    name: "my-store",
    async list(query) {
      /* … */
    },
    async append(comment) {
      /* … */
    },
  };
}
```

There are six kinds — store, media, observability, identity, gate and
classifier — and a connector's capabilities are exactly the methods it defines.
Run `maple connectors` to print the matrix from the code, or see
[`docs/connectors.md`](docs/connectors.md).

## Packages

| Package                                        | What it is                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| [`@maple-kit/core`](packages/core)             | Server SDK, overlay controller, connector contracts, build plugins.  |
| [`@maple-kit/ui`](packages/ui)                 | The marks, the island and the composer: the overlay a reviewer uses. |
| [`@maple-kit/react`](packages/react)           | Hooks over the controller, for an overlay in your own design system. |
| [`@maple-kit/mcp`](packages/mcp)               | The MCP server an agent talks to, and a Stop hook.                   |
| [`@maple-kit/cli`](packages/cli)               | The `maple` command.                                                 |
| [`@maple-kit/mock`](packages/mock)             | Rewrites a page's API responses, flags and role into a named state.  |
| [`@maple-kit/classifier`](packages/classifier) | Scores a comment as it is written, and plans a mock from a sentence. |
| [`@maple-kit/lint`](packages/lint)             | Design-system rules read off the page the browser laid out.          |

## Documentation

- [Connectors and the capability matrix](docs/connectors.md)
- [The JSX tagger](docs/tagger.md) — how a comment becomes `file:line`
- [The overlay and CSP](docs/overlay-csp.md) — what Maple asks of your policy
- [The agent loop](docs/agent-loop.md) — the MCP tools and the Stop hook
- [Drafts and publishing](docs/drafts.md) — why a comment is unsent until it is not
- [The merge gate](docs/gate.md) — what blocks a merge, and what approving does
- [Maple Mock](docs/mock.md) — a model picks the state, code writes every byte
- [The assist tier](docs/assist.md) — what a score is, and what it is never allowed to be
- [Design lint](docs/lint.md) — the rendered rules and the tiers around them

## See it running

```
nvm use
pnpm install
pnpm --filter @maple-kit/example-vite dev   # http://localhost:5173
```

A real Vite application with three comments already on it: marks on the page,
the island in the corner, and all three picks working against an SDK route the
dev server mounts. [`examples/vite-app`](examples/vite-app) says what it does
and does not prove.

## Development

```
nvm use          # or fnm use, mise install — .nvmrc pins the version
pnpm install
pnpm hooks
pnpm lint && pnpm typecheck && pnpm test
```

Requires Node 24, the active LTS, and pnpm 10. Switch **before** the install:
pnpm 10 and 11 load `node:sqlite`, which Node 23 does not have, so on the wrong
version pnpm crashes rather than telling you the version is wrong. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Apache-2.0. Contributions are accepted under the
[Developer Certificate of Origin](DCO) — sign off with `git commit -s`. There is
no CLA.
