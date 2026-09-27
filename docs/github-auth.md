# GitHub authentication

Maple's default store is the GitHub pull request, so every comment is a write to
GitHub and every write needs a GitHub credential. The environment that has to
hold that credential is a preview deployment: rebuilt on every push, reachable
by everyone who has the link, shared by dozens of reviewers, and often the real
application pointed at real data.

This file is how a reviewer's comment reaches GitHub without a GitHub secret
ever existing in that environment.

The short version: the comment App, OAuth Device Flow, one user-to-server token
per reviewer, held in an `HttpOnly` cookie on the preview's own origin. The
preview holds no GitHub secret at all. It holds the App's `client_id`, which is
public by design.

## The flow

1. An organisation owner installs Maple's comment App on the repositories that
   should be reviewable. One-time, by a person with owner rights. The runbook is
   the `setup-maple-org` skill.
2. A reviewer opens a preview and clicks **Link GitHub** in the overlay.
3. The SDK route — same origin, server-side — posts the App's `client_id` to
   GitHub's device-code endpoint and receives an eight-character user code, the
   verification URL `https://github.com/login/device`, an expiry and a polling
   interval.
4. The overlay shows the reviewer the user code and the URL. The device code
   itself never leaves the server; it is a credential for the few minutes it
   lives.
5. The reviewer opens the URL on github.com, enters the code, and authorises the
   App against the account they are already signed in as.
6. The route has been polling GitHub's token endpoint the whole time, backing
   off when GitHub says `slow_down`. The authorisation turns the next poll into
   a **user-to-server access token**.
7. The route puts that token in a cookie —
   `HttpOnly; Secure; SameSite=Lax; Path=/api/maple` with a seven-day
   `Max-Age` — and returns nothing else to the browser.
8. Every later write builds the GitHub store connector from _that_ reviewer's
   token. The pull-request comment is authored by the reviewer's own GitHub
   account, and one reviewer's token can never be used by another.

Steps 3 to 6 are `createDeviceFlow` in `packages/core/src/auth/device-flow.ts`,
served over three requests on the route: `POST /auth/github` starts a link,
`PATCH /auth/github` makes one exchange attempt, and `DELETE /auth/github`
forgets the token. The browser does the waiting between attempts, because a
person takes minutes to type a code and a request held open that long is a
request a proxy will close.

Step 8 is `githubStore` in `packages/core/src/connectors/github.ts`, constructed
per request rather than once per process, because the token differs per
reviewer. `RouteOptions.store` takes a resolver for exactly this.

The device code is a credential for the minutes it lives, so it is held the same
way the token is: in an `HttpOnly` cookie this route sets, never in a response
body. `GET /me` reports whether this reviewer has linked and under which login,
read out of the cookie rather than by asking GitHub on every page load.

## Why Device Flow and not the redirect flow

**Device Flow's token exchange requires no `client_secret`.** It sends only the
`client_id` and the device code. The `client_id` is public: it is in the App's
settings page, it is in the URL of every authorisation, and leaking it gains an
attacker nothing.

The ordinary OAuth redirect flow requires the `client_secret` at exchange time.
GitHub's wildcard redirect URIs, shipped 2026-08-14, solve the other half of the
problem — a preview URL that differs on every deployment has no stable
callback to register — but they do not remove the secret. Using the redirect
flow would put a GitHub App secret into every preview environment, which is
exactly the thing this design exists to avoid.

That single fact is the reason for the whole shape. Everything below follows
from it.

## The alternatives, and why each was rejected

**A shared Personal Access Token or installation token in an environment
variable.** Every reviewer comments as one bot identity, so a pull request full
of Maple comments says nothing about who wrote them. Worse, it puts a long-lived
credential with write access into an environment that is rebuilt constantly and
reachable by anyone holding a preview link. One leak is every repository the
token can reach, for every reviewer, until someone notices. Rejected.

**A browser extension reusing the reviewer's github.com session.** It cannot
work. GitHub's REST API does not accept cookie authentication, so the extension
would have to drive the web UI with a scraped CSRF token, which breaks whenever
GitHub changes a form. To post as the user it still needs a token, which means
the same OAuth flow, plus an installation step for every reviewer. An extension
is worth building for other reasons — compositor-accurate screenshots are the
real one — but never for this.

**A hosted service minting installation tokens.** Maple will need one
eventually, because only a GitHub App acting as itself can create check runs and
the CI merge gate is a check run. But an installation token authors comments as
the App, not as the reviewer, so it is the wrong answer for comments. The gate
and the comments have different identity requirements and get different
credentials.

## What the App may do

Repository permissions, and nothing else:

| Permission      | Access         | Why it is needed                                                                                                                                      |
| --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Pull requests` | Read and write | Every call Maple makes: listing, posting, reading and editing a comment, and resolving a branch or commit to the pull request its comments belong to. |
| `Metadata`      | Read-only      | Mandatory; GitHub grants it to every App.                                                                                                             |

That is the whole set. Two permissions.

**`Issues` is not needed, although the endpoints look like it.** Maple stores a
comment as a pull-request conversation comment, and a pull-request conversation
comment _is_ an issue comment, so every call goes to
`/repos/{owner}/{repo}/issues/…`. It is tempting to conclude the App needs
`Issues: Read and write`. It does not: GitHub lists all four of those endpoints
— list, create, read and update — under **both** `Issues` and `Pull requests`,
and Maple only ever comments on a pull request. Granting `Issues` would hand
every reviewer's token write access to every issue in the repository, for
nothing.

In particular there is **no `Contents` permission**. Maple never reads or writes
repository code. An attacker holding a reviewer's token cannot read the source,
cannot push, and cannot open a pull request.

### Two Apps, and why that is a security decision

**Register two Apps: one for comments, one for the gate.** Using one App for
both is not a shortcut, it is a vulnerability.

The mechanism is one sentence: **a user-to-server token is bounded by the App's
permissions, not by what the reviewer is doing with it.** Every permission the
App carries is a permission every reviewer's token carries.

Those two jobs want opposite things:

| App      | Permissions                 | Authenticates as | Where its token lives           |
| -------- | --------------------------- | ---------------- | ------------------------------- |
| Comments | `Pull requests`, `Metadata` | the reviewer     | a cookie on the preview         |
| Gate     | `Checks`                    | itself           | server-side, never in a preview |

The comment flow needs a _user_ token — that is the whole point of Device Flow,
so a comment is authored by the reviewer's own account. The gate needs
`Checks: Read and write` and authenticates **as itself** with an installation
token; it never wants a user token at all.

Put both sets on one App and every reviewer is now carrying a token that can
write check runs and read your source. The claim that a stolen Maple token
cannot reach your code stops being true — and it stops being true **silently**.
Nothing about linking a reviewer changes, no permission is re-requested, and no
error is raised anywhere. The blast radius of one phished reviewer goes from
"comments they could write anyway" to "a read of every repository the App is
installed on", and nothing in the product says so.

The cost of two Apps is one extra installation, once. That is the whole price.

**Do not let the comment App carry the gate's permissions in advance.** An App
holding `Checks` and `Contents` for a gate that is not built yet has all of the
exposure and none of the benefit. Permissions are cheap to add when the gate
arrives and expensive to have been carrying in the meantime.

### No gate credential leaves the server

The gate App's key and the installation tokens minted from it stay on the SDK
route. An agent that resolves a comment through `maple-mcp` and wants the check
to move does not get one: it asks the route's `POST /gate/refresh` with its own
`GITHUB_TOKEN`, the route checks that token can push to the repository, and the
route decides the verdict and publishes it. `docs/gate.md` has the request.

Two simpler shapes were rejected.

**The App's private key on the developer machine.** It mints tokens for every
repository the installation covers, not the one being worked on, and it does
not expire. A key on a laptop is a key in every backup, every dotfile sync and
every agent transcript that ever printed the environment.

**Short-lived installation tokens handed out by the route.** An hour sounds
narrow, but any token the gate App mints can write `maple/visual-review` with
any conclusion. A ruleset pins the App, not the verdict, so whoever held one
could publish a green check over open comments, on any pull request, for the
hour. The route's refresh takes a branch and nothing else, so the verdict is
always the one the store decides.

Push access is the bar because it is the power the check already concedes:
anyone who can push can move the check by pushing. The refresh gives them
nothing a commit would not.

## Two settings that decide whether this works

**Expire user authorisation tokens — off.** With expiry on, a user-to-server
token lasts eight hours and refreshing it requires the `client_secret`. That
puts the secret back into the preview environment and defeats the design.

Off means a non-expiring token, bounded by the seven-day cookie and by the
reviewer's own revocation. Be clear about the trade: seven days is a **longer**
window than the eight hours expiry would have given. What is bought with it is
that no GitHub secret exists in the preview environment at all — and a secret
sitting in a constantly rebuilt environment, readable by everything deployed
beside it, is the larger exposure of the two. Shorten `maxAgeSeconds` if the
trade reads differently for a given repository; nothing else has to change.

**Device Flow — on.** Without it GitHub answers the device-code request with
`device_flow_disabled`, which surfaces as a `DeviceFlowError` with reason
`unsupported`. It is the one setting a GitHub App manifest cannot carry, so it
is always a manual checkbox.

## The cookie

| Property   | Value        | What it defends against                                              |
| ---------- | ------------ | -------------------------------------------------------------------- |
| `HttpOnly` | set          | Cross-site scripting in the previewed application reading the token. |
| `Secure`   | set          | The token crossing plaintext HTTP.                                   |
| `SameSite` | `Lax`        | Another site causing a write with it.                                |
| `Path`     | `/api/maple` | The token being attached to requests that are not Maple's.           |
| `Max-Age`  | 7 days       | An abandoned session staying usable indefinitely.                    |

`HttpOnly` is the defence that matters, because the realistic threat is
cross-site scripting in the application being previewed — a preview is where
half-finished code runs. Page JavaScript cannot read the cookie, so an injected
script cannot exfiltrate the token.

`SameSite=Lax` and the path scope work together: a cross-site form post to
`/api/maple/comments` carries no cookie, so another site cannot make a reviewer
write a comment.

The cookie is scoped to the preview's own origin, so it is never sent to GitHub
or to any third party. The token leaves the server only in requests the route
itself makes to `api.github.com`. The overlay never sees it; there is no code
path that returns it to the browser.

The cookie path is `githubAuth.path`, defaulting to `/api/maple`. It does not
follow `basePath`: a route mounted somewhere else must set `githubAuth.path` to
the same value, or the browser never sends the cookie to it and every reviewer
reads as unlinked.

### Encryption at rest is optional, and narrow

`githubAuth.key` is optional, and when set the route encrypts the cookie value
with AES-GCM. A store resolver reading the cookie passes the same key to
`readGitHubSession(request, { key })`. Be clear about what that buys.

It protects the token from something that can read the cookie jar but not the
server's configuration: a backup of a request log, a proxy that stores response
headers, an operator reading a browser profile. That is a real class of
exposure, and it is a narrow one.

It does **not** defend against a compromised server. An attacker who can read
the cookie on the server can read the key next to it. Encryption at rest here is
defence in depth, not the load-bearing control; `HttpOnly` is.

Turn it on. It costs one environment variable and it closes the narrow case.
Treat the day it is missing as a hardening gap, not an incident.

## Worst case

Assume one reviewer's token is stolen outright. The attacker holds a credential
that can:

- Write and edit pull-request comments as that user, on the repositories the App
  is installed on.
- Read pull requests on those same repositories.

It cannot read or write repository code, cannot merge, cannot approve, cannot
change any setting, cannot create a repository, and cannot reach a repository
the App was not installed on. It is not a GitHub session: it does not let the
attacker act as that user anywhere else on github.com.

The blast radius is one person and the repositories that were deliberately
opted in. That is the property a shared token cannot have at any price — a
shared token's blast radius is everyone, every time.

## Revocation

The user revokes their own token from **Settings → Applications → Authorized
GitHub Apps**, then **Revoke** on the Maple App. Two clicks, no administrator, no Maple
deployment involved. Every Maple session that user has anywhere ends, because
every one of them is the same token.

An organisation owner can go further and uninstall the App from a repository or
the whole organisation, which invalidates every reviewer's token for it at once.

A revoked token still sits in the reviewer's cookie until it expires. The next
write fails with GitHub's own `401`, and the overlay treats that as signed out
and offers **Link GitHub** again. The cookie is cleared at that point rather
than retried, because a token GitHub has rejected will not start working.

## Preview environments only

The auth route and the overlay belong in preview deployments. Both are gated off
by default and neither is mounted in a production build: `MAPLE_PREVIEW`
controls the tagger and the mount, and the route is wired in the preview branch
of the application's configuration, never unconditionally.

This is not a second layer of security for the cookie. It is the boundary that
keeps a review tool out of the path of real users. A production build that ships
the overlay is a bug even if nothing can be done with it.

Verifying it is one request against a production build: fetch
`/api/maple/comments?branch=web-482` and expect a `404`. An application mounting
Maple should assert that in whatever check it already runs against a production
build, so the gate is enforced rather than remembered.

## Configuration

| Name                     | Where it is read | What it is                                        |
| ------------------------ | ---------------- | ------------------------------------------------- |
| `MAPLE_GITHUB_CLIENT_ID` | SDK route        | The App's client id. Public; it is not a secret.  |
| `MAPLE_COOKIE_KEY`       | SDK route        | Optional AES-GCM key for the cookie. Recommended. |
| `MAPLE_PREVIEW`          | Build and route  | `1` in a preview, unset everywhere else.          |

There is deliberately no `MAPLE_GITHUB_CLIENT_SECRET` and no
`MAPLE_GITHUB_TOKEN` in a preview environment. If a deployment has either, the
design has been worked around and the whole argument above stops applying.

The gate App's three variables are not in that table for the same reason they
are not on this App: they belong to the other one. `docs/configuration.md` has
every variable a host sets, and which of them are secrets.
