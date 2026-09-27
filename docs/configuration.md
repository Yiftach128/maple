# Configuration

Every environment variable a host sets to run Maple, in one place, with which
of them are secrets. The SDK reads none of these itself: the route takes
options, and a host reads its own environment and passes them in. The MCP
server is the exception, below. This file
names them so that two deployments do not invent two vocabularies.

**Maple's own knobs carry `MAPLE_`. A provider's credential keeps the
provider's name.** `MAPLE_ASSIST_API_KEY` would suggest Maple issues it;
`TYPESAFE_API_KEY` says where to go when it is rejected, and matches what the
key is called everywhere else the provider is used.

## The comment App

Signs a reviewer in, and writes their comment as them.
`docs/github-auth.md` is the design; `setup-maple-org` is the runbook.

| Name                     | Secret | What it is                                                                      |
| ------------------------ | ------ | ------------------------------------------------------------------------------- |
| `MAPLE_GITHUB_CLIENT_ID` | No     | The App's **Client ID**, starting `Iv`. Public: every reviewer sees it.         |
| `MAPLE_COOKIE_KEY`       | Yes    | 32 random bytes. Encrypts the reviewer's cookie at rest. Optional, and take it. |
| `MAPLE_PREVIEW`          | No     | `1` in a preview, unset everywhere else. Gates the tagger and the mount.        |

There is deliberately **no client secret and no private key here**. Device
Flow's token exchange needs neither, and a deployment holding either has worked
around the whole design.

## The gate App

Publishes `maple/visual-review` when a reviewer resolves the last comment, with
no new push. `docs/gate.md` is the design.

| Name                         | Secret | What it is                                     |
| ---------------------------- | ------ | ---------------------------------------------- |
| `MAPLE_GATE_APP_ID`          | No     | The **App ID**, not the client id. A number.   |
| `MAPLE_GATE_INSTALLATION_ID` | No     | Which installation to mint a token for.        |
| `MAPLE_GATE_PRIVATE_KEY`     | Yes    | The App's `.pem`, contents rather than a path. |

**This is a second App, and that is a security decision rather than a
preference.** A user-to-server token carries every permission its App holds, so
putting `Checks` on the comment App would hand every reviewer's cookie the
power to write check runs. `docs/github-auth.md` has the argument.

**None of this is needed to run the gate in CI.** `maple-action` publishes the
check with the workflow's own `GITHUB_TOKEN` and `checks: write`, and needs no
App registered at all. These three variables buy the other half: a resolve
clearing the check live, rather than a reviewer waiting for a commit nobody
needs to make.

**On the route, `requireApproval` is an option, not a variable** (the MCP
server's `MAPLE_REQUIRE_APPROVAL`, below, is the one place it is read from the
environment). It is off by default, and when it is on the action needs
`require-approval: "true"` to match. The two publish the same
check name, so a disagreement lets a push clear a gate a reviewer is holding.
It also needs an identity connector, or anyone with the preview URL can clear a
required check as "Guest".

The installation id is on the installation's settings URL —
`https://github.com/organizations/<org>/settings/installations/<id>` — and
`gh api /app/installations` lists it once the key is in hand.

## The assist tier

Scores a comment as it is typed. Off unless a classifier is configured, so
every variable here is optional. `docs/assist.md` is the design.

| Name               | Secret | What it is                                                                       |
| ------------------ | ------ | -------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY` | Yes    | The System One key `jevClassifier` authenticates with.                           |
| `MAPLE_AI_MODEL`   | No     | An alias or a pinned version. Defaults to `jev-latest`.                          |
| `MAPLE_AI_API`     | No     | The API root, for a request-compatible reimplementation. Defaults to TypeSafe's. |

**The key is read on the server and reaches the browser through nothing.** The
route holds the classifier; `/assist` is same-origin, which is also what keeps
`connect-src` unchanged.

Absent a key, drop the `assist` option and the tier is simply off — or pass
`keywordClassifier()`, which needs no network and is the floor the evals
measure against.

## The agent loop

The MCP server is the one place Maple reads its own environment, because it is
a process rather than a library. `docs/agent-loop.md` covers it.

| Name                     | Secret | What it is                                                                  |
| ------------------------ | ------ | --------------------------------------------------------------------------- |
| `GITHUB_TOKEN`           | Yes    | A token that can read and write pull-request comments. Required.            |
| `MAPLE_GITHUB_OWNER`     | No     | The repository's owner. Required.                                           |
| `MAPLE_GITHUB_REPO`      | No     | The repository. Required.                                                   |
| `MAPLE_GITHUB_API`       | No     | The API root, for Enterprise Server.                                        |
| `MAPLE_STORE`            | No     | `github`, the default and so far the only one.                              |
| `MAPLE_BRANCH`           | No     | The branch under review. Required by the Stop hook; the server ignores it.  |
| `MAPLE_GATE_TOKEN`       | Yes    | The gate App's installation token. Absent, a resolve publishes no verdict.  |
| `MAPLE_GATE_APP_ID`      | No     | The gate App's id, so it updates its own check run rather than another's.   |
| `MAPLE_REQUIRE_APPROVAL` | No     | `true` to hold the gate until somebody approves, matching the route and CI. |

This token is an agent's, not a reviewer's, and it belongs on a developer's
machine or in CI — never in a preview environment.

`MAPLE_GATE_TOKEN` is read once, as a static string, and an installation token
expires an hour after it is minted. A server that outlives it publishes with a
dead token: the resolve is still recorded, and the gate update fails with
nothing logged, because `maple-mcp` configures no logger. Mint a fresh token
for each session until the server can mint its own.

## Where each one goes

A secret goes wherever that deployment keeps secrets, and the rest can sit in
plain configuration checked into a repository. On Kubernetes that is the split
between a `Secret` and a `ConfigMap`; on a platform host it is the "sensitive"
checkbox. The table above is the whole answer to which is which.

Nothing in the non-secret column becomes a secret by being kept private. A
client id is in every authorisation URL and an App ID is on the App's public
page; treating them as secrets costs a rotation procedure and buys nothing.
