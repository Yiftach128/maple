# Releasing

Every release goes out through `release.yml`, on a push to `main`. Changesets
opens a "chore: version packages" pull request; merging it publishes what it
versioned. npm authenticates the workflow by OIDC, as a trusted publisher, so
no publish credential is stored anywhere.

The version pull request also runs `pnpm docs:sync-versions`. Every version
pinned in the docs moves to the new one, as does the plugin's `@maple-kit/mcp`
pin in `plugins/maple/.mcp.json`, and when the plugin changed its
`plugin.json` version gets a patch bump, because an installed plugin updates
only when that version does. CI's stale-version guard compares against
`package.json`, so it passes on that pull request and on every one after.

## A new package name

npm registers a trusted publisher only against a package that already exists,
so the first version of a new name cannot go through `release.yml`. Merging
the version pull request before the name exists fails that package's publish.

`bootstrap-package.yml` publishes that one version with a token, and is
dormant the rest of the time. The procedure, in order:

1. **Token.** On npmjs.com, a granular token with read and write on the new
   package's scope, the shortest expiry offered, and "bypass two-factor
   authentication" if it is offered.
2. **Secret.** `gh secret set NPM_TOKEN --repo maple-kit/maple`, pasting the
   token at the prompt.
3. **Two-factor.** Only if the token could not bypass it: set the account to
   "Authorization only" for the length of the run.
4. **Dispatch** `bootstrap-package.yml` with the package's directory, from the
   version pull request's branch (`changeset-release/main`), so the version
   published is the one about to be released and its workspace dependencies
   are versions about to exist.
5. **Merge the version pull request.** `changeset publish` skips a version the
   registry already has, and publishes the rest.
6. **Close everything that was opened.** Two-factor back to "Authorization and
   publishing", the trusted publisher registered on the package's settings
   page (GitHub Actions, `maple-kit/maple`, `release.yml`), and
   `gh secret delete NPM_TOKEN --repo maple-kit/maple`.

A new name answered 404 on the read path for seven minutes after it was
genuinely published, the first time. `npm stage list` in the run's last step
tells that apart from a staged publish.

Fewer names means fewer bootstraps. A new piece of an existing package is a
subpath export, not a package of its own, unless it has its own audience.
