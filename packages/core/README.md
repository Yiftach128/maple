# @maple-kit/core

The server SDK, the overlay controller, the build plugins and the connector
contracts for [Maple](https://github.com/maple-kit/maple) — visual review
comments on deployed previews, written for people and read by agents.

**Pre-release.** Every package here is 0.x and makes no compatibility promise.

## Install

```sh
npm install @maple-kit/core @babel/core
```

`@babel/core` is an optional peer that only the JSX tagger uses; skip it if you
never set `tagger: true`.

Most applications also install [`@maple-kit/ui`](../ui) for the overlay a
reviewer sees. Core is the part that runs on your server and in your build.

## On deployed previews

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/deployed-previews.gif" alt="A browser opens a pull request's preview URL, and the review comments already left on the page appear on it one by one." width="480">
</p>

Maple runs on the preview URL your CI already builds, so anyone holding the
link can comment. The route is mounted inside your own application, on your
own origin, at `/api/maple/*`: no hosted service, and nothing added to your
`connect-src`.

```ts
// vite.config.ts
import { createCommentStore } from "@maple-kit/core";
import { githubStore } from "@maple-kit/core/connectors";
import { maple } from "@maple-kit/core/vite";

export default defineConfig({
  plugins: [
    maple({
      tagger: process.env.MAPLE_PREVIEW === "1",
      route: {
        // Local development only: every comment is written as this one token.
        store: createCommentStore(githubStore({ owner, repo, token: process.env.GITHUB_TOKEN! })),
      },
    }),
  ],
});
```

A shared token is for trying it locally. A preview other people review builds
the store per request from each reviewer's own token, with the resolver in
[`docs/github-auth.md`](https://github.com/maple-kit/maple/blob/main/docs/github-auth.md#configuration).

Next.js wraps its config in `withMaple` from `@maple-kit/core/next` and mounts
`createMapleHandler` from `@maple-kit/core/route` at
`app/api/maple/[...maple]/route.ts`. Any other server mounts the same handler:
it is Web-standard `Request` in, `Response` out.

## The file and the line

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/tagger.gif" alt="In developer mode, hovering the page shows each element's component name and its file, line and column." width="480">
</p>

On a preview build the tagger marks every JSX element with the file, line and
column it was written at, so a comment reaches an agent pointing at source
rather than at a selector. A production build strips every mark; `withMaple`
makes taking one half without the other impossible by accident.

## Connectors

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/connectors.gif" alt="A comment flows into Maple and out to the connectors wired today, GitHub and a classifier, while Linear and Bitbucket wait as coming soon." width="480">
</p>

Maple stores nothing itself. Comments live in what you already run, starting
with the pull request itself. A connector is one file of plain
Promise-returning methods, and its capabilities are exactly the methods it
defines:

| Kind            | Required            | Optional                                                                        |
| --------------- | ------------------- | ------------------------------------------------------------------------------- |
| `store`         | `list`, `append`    | `appendMany`, `setStatus`, `head`, `watch`, `approvals`, `approve`, `unapprove` |
| `media`         | `putBlob`, `getUrl` | `remove`                                                                        |
| `observability` | `getReplayLink`     | `fetchEvents`                                                                   |
| `identity`      | `resolveUser`       | —                                                                               |
| `gate`          | `publish`           | `read`                                                                          |
| `classifier`    | —                   | `score`, `classify`, `plan`                                                     |

Bundled today: `githubStore` and `githubGate`, and `keywordClassifier`, which
scores and plans offline with no credential. A model-backed classifier is
[`@maple-kit/classifier`](../classifier).

Every connector runs the shared contract suite from `@maple-kit/core/testing`
(`runStoreContract`, `runClassifierContract`, …). That entry declares `vitest`
as an optional peer: it registers its tests against whichever runner you
invoke, so it has to be yours.

## The merge gate

<p align="center">
  <img src="https://raw.githubusercontent.com/maple-kit/maple/main/docs/assets/features/merge-gate.gif" alt="A pull request's checks: maple/visual-review fails with two comments open, they resolve, the check passes and the merge button wakes up." width="480">
</p>

`maple/visual-review` fails while a comment is open and, with
`requireApproval`, until somebody says they looked. The decision lives in
`@maple-kit/core/gate`, independent of any forge; `githubGate` publishes it as
a check run.

## Entrypoints

| Import                       | What it is                                                      |
| ---------------------------- | --------------------------------------------------------------- |
| `@maple-kit/core`            | Comment types, the connector contracts, `createCommentStore`    |
| `@maple-kit/core/route`      | The SDK route a host application mounts at `/api/maple/*`       |
| `@maple-kit/core/vite`       | The Vite plugin: tagger transform plus the mounted route        |
| `@maple-kit/core/next`       | `withMaple`, both halves of the Next case                       |
| `@maple-kit/core/loader`     | The Turbopack loader the Next path uses                         |
| `@maple-kit/core/client`     | The framework-free reviewer controller the bindings wrap        |
| `@maple-kit/core/overlay`    | The shadow-root host, the pickers and the anchor cascade        |
| `@maple-kit/core/anchor`     | Anchoring and re-anchoring, five rungs with four orphan reasons |
| `@maple-kit/core/connectors` | The bundled connectors and the classifier's default pillars     |
| `@maple-kit/core/gate`       | The merge gate's decision, independent of any forge             |
| `@maple-kit/core/mock`       | Maple Mock's recipe: parse, encode, link, and read a plan       |
| `@maple-kit/core/auth`       | GitHub Device Flow, including the `slow_down` back-off          |
| `@maple-kit/core/export`     | Markdown with a visible ` ```maple ` fence                      |
| `@maple-kit/core/screenshot` | Paste, drop and file capture, with snapdom as an optional peer  |
| `@maple-kit/core/tagger`     | The JSX tagger that turns a comment into `file:line`            |
| `@maple-kit/core/logger`     | `createLogger({ sinks })`                                       |
| `@maple-kit/core/config`     | Standard Schema validation of Maple's own options               |
| `@maple-kit/core/testing`    | The shared connector contract suite. Needs `vitest`             |

## Documentation

- [Connectors and the capability matrix](https://github.com/maple-kit/maple/blob/main/docs/connectors.md)
- [Configuration](https://github.com/maple-kit/maple/blob/main/docs/configuration.md)
- [The JSX tagger](https://github.com/maple-kit/maple/blob/main/docs/tagger.md)
- [The overlay and CSP](https://github.com/maple-kit/maple/blob/main/docs/overlay-csp.md)
- [The merge gate](https://github.com/maple-kit/maple/blob/main/docs/gate.md)
- [GitHub sign-in](https://github.com/maple-kit/maple/blob/main/docs/github-auth.md)

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
