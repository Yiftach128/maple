# Contributing

## Getting set up

```
nvm use          # or fnm use, mise install — .nvmrc pins the version
pnpm install
pnpm hooks
pnpm lint && pnpm typecheck && pnpm test
```

Node 24, the active LTS, and pnpm 10. `.nvmrc` pins the exact version.

### Switch Node first

`nvm use` is the first line for a reason, and it is not covered by
`engine-strict`. pnpm 10 and 11 `require("node:sqlite")` on startup, and Node
23 does not have that module, so pnpm dies before it reads this repository's
`engines` field:

```
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
```

That is a Node version error wearing a different hat. `nvm use` fixes it; so
does any version manager that reads `.nvmrc`. `engine-strict=true` still
catches the versions where pnpm itself runs — Node 22, say — but it cannot
catch one where pnpm cannot start.

nvm does not switch on its own when you `cd` into a directory unless you have
installed its shell hook, so a fresh terminal lands on your default version. If
you work here often, `nvm alias default 24.21.0`, or add nvm's
[deeper shell integration](https://github.com/nvm-sh/nvm#deeper-shell-integration)
so `.nvmrc` is picked up automatically.

Global packages are per Node version under nvm and fnm. After switching to a
version for the first time you may have no `pnpm` at all, which reads as
`command not found`. Install it there with `npm i -g pnpm@10`; do not reach for
Corepack, which is deprecated and which a corporate registry proxy often
blocks.

`pnpm hooks` is a separate step on purpose. `.npmrc` sets `ignore-scripts=true`,
so no package — including this one — runs code at install time. That is worth
one extra command.

Browser-mode tests need Chromium once:

```
pnpm exec playwright install chromium
pnpm test:browser
```

## Sign your commits

### Your commit identity

Set one for this repository before your first commit:

```
git config user.name "your-name"
git config user.email "you@example.com"
```

A hook requires it. Git otherwise falls back to your global identity, which is
how an address someone did not mean to publish ends up in a public history —
and history here is not rewritten. GitHub's `@users.noreply.github.com` address
works if you would rather not publish a real one.

Every commit needs a Developer Certificate of Origin sign-off:

```
git commit -s -m "fix(core): reject a non-positive list limit"
```

That adds a `Signed-off-by:` line, which certifies you wrote the change or have
the right to submit it under Apache-2.0. The full text is in [DCO](DCO). CI
checks every commit in a pull request. There is no CLA.

### Cryptographic signatures are a separate thing

A DCO sign-off is a line of text, not a signature. `main` separately requires
every commit on it to be verified, so a pull request whose commits are unsigned
is squash-merged — GitHub signs the commit it creates, and the branch stays
verified. That path needs nothing from you.

Rebase-merging is what unsigned commits cannot do, because it replays your
commits onto `main` as they are. If you would like your own commits to land
verified, sign them with
[SSH or GPG](https://docs.github.com/authentication/managing-commit-signature-verification)
and set `git config commit.gpgsign true` here. Otherwise ignore this; the
default path works.

## Commit messages

Conventional commits, one concern per commit:

```
<type>(<scope>): <summary>

<why this change, not what the diff already shows>
```

Types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
`revert`, `style`, `test`.

The body is where the reasoning goes. A reader six months from now has the diff
and needs the rest.

## Breaking changes

These packages are 0.x, which makes no compatibility promise, and they are
meant to be used as such. If an interface is the wrong shape, change it:
rename the export, change the signature, move it to a different entrypoint.
Update every call site, test and example in the same commit, and write what
broke in the changeset — that line is what a reader of the release notes has.

What not to do is leave the old shape behind. No deprecation aliases, no
compatibility re-exports, no branch that handles both spellings. Nothing
downstream depends on the old one yet, and a shim written now is dead code
somebody deletes later after reading it twice.

This holds until 1.0.

## Adding a dependency

Maple takes very few, on purpose. Before adding one:

1. If fewer than about five of its functions are needed, port them into
   `packages/core/src/lib/` with attribution and unit tests instead.
2. Otherwise check its stars, its last release, whether it is maintained and
   whether its licence is compatible with Apache-2.0.
3. **Put that reasoning in the commit body.** It is the record that survives.

`.npmrc` pins exact versions and refuses install scripts; `pnpm-workspace.yaml`
refuses anything published in the last three days.

### The lockfile

`pnpm-lock.yaml` should contain no URLs at all — pnpm records integrity hashes,
which verify content whatever host served it.

If you install behind a corporate registry mirror, check the lockfile diff
before committing. A mirror's tarball URLs resolve on your machine and nowhere
else, and because the integrity hashes still validate, nothing downstream would
notice until someone else's install failed. A hook and a CI job both check for
this.

## Adding a connector

Use the `contribute-connector` skill in `.claude/skills/`, or follow it by hand:
copy the template, implement the interface, run the shared contract suite, and
add the row to the matrix in [`docs/connectors.md`](docs/connectors.md).

A connector that cannot pass the contract suite is a connector Maple cannot use,
so that suite is the review.

## What CI checks

`lint`, `typecheck`, `format`, `test` (including browser mode), `build` with
`publint` and `attw`, `gitleaks`, and the DCO sign-off. All of them are
reproducible locally with the commands above.

Lint failures are errors, never warnings. If a rule is wrong for a case, say so
in the pull request rather than adding a suppression: the suppressions file is
frozen and CI fails on a change to it.

## Changesets

If you changed a published package:

```
pnpm changeset
```

Pick the packages, pick the bump, and write the line a user will read in the
release notes — not the commit summary.

A change to documentation alone — Markdown, `docs/`, a skill — ships no
changeset, and a changeset may not bump a package minor or major for a change
that touched only that package's docs. `pnpm check:changeset-level` checks both
against `origin/main`, as CI does against the pull request's base.

## Reporting a security issue

Do not open an issue. See [SECURITY.md](SECURITY.md).
