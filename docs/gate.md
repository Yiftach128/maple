# The merge gate

A comment nobody addressed should stop a merge. That is the whole wedge: every
other tool in this space collects visual feedback and then trusts a person to
remember it.

The gate is two pieces, deliberately apart.

| Piece                                | Where                     | Vendor-specific |
| ------------------------------------ | ------------------------- | --------------- |
| Deciding whether a commit is blocked | `decideGate`, `core/gate` | No              |
| Saying so to a forge                 | `GateConnector`           | Yes             |

`maple/visual-review` is a GitHub check run, GitLab has external status checks,
and Bitbucket's enforcement is Premium-only. Three APIs over one decision. The
split is what keeps the check-run API out of core.

## The decision

```ts
import { decideGate } from "@maple-kit/core/gate";

const { comments } = await store.list({ branch });
const verdict = decideGate(comments, { statusTracked: supports(store, "setStatus") });
```

A `GateVerdict` carries a conclusion, a **reason**, a title, a markdown summary,
and the two counts. The reason is there because a summary sentence cannot be
branched on and the two neutrals need different answers from a person.

| Reason               | Conclusion | What happened                                           |
| -------------------- | ---------- | ------------------------------------------------------- |
| `comments-open`      | `blocked`  | Somebody's comment is unaddressed                       |
| `awaiting-approval`  | `blocked`  | Nothing is open and nobody has said they looked         |
| `all-resolved`       | `clear`    | Every comment was resolved                              |
| `no-comments`        | `clear`    | Nobody commented                                        |
| `unreadable`         | `neutral`  | The store could not be read at all                      |
| `status-untracked`   | `neutral`  | The store cannot record that anything was resolved      |
| `approval-untracked` | `neutral`  | An approval was wanted and there is nowhere to find one |
| `no-review`          | `neutral`  | Maple was never reviewing this pull request             |

### Everything but `resolved` blocks

`BLOCKING_STATUSES` is `open`, `needs_reverify` and `orphaned`. The last is the
one worth arguing about: an orphaned comment is one whose anchor no longer
matches the page. Letting it pass would mean **a layout change that orphans a
comment silently clears the gate**, which is the failure mode to design against
rather than the convenience to optimise for. `blockOn` narrows it where a team
decides otherwise.

### Two of those three need something to write them

`open` is written on every append. The other two are a policy the decision
applies, not a state the store keeps, and one of them is not written at all.

**`needs_reverify`** is what `reverifyResolved` produces. A comment resolved
against a commit that is no longer the head was resolved against a page that is
no longer on show, so the decision treats it as needing another look. It is off
by default, because on a branch with many pushes it reopens everything, and how
much re-checking a team wants is a team's decision.

```ts
decideGate(comments, { commit: sha, reverifyResolved: true });
```

**`orphaned` is written by nothing at all, and that is a real hole.** The
overlay works out that an anchor no longer resolves — `resolveAnchor` is called
on every render and the marks depend on it — and never reports it to the store.
So the paragraph above describes a guarantee the code does not yet keep: a
layout change that orphans a comment leaves its status `open`, which still
blocks, but a layout change that orphans a comment somebody had already
resolved clears the gate silently.

The reason it is not simply written from the page is that **the page cannot
tell an orphaned anchor from a reviewer standing on a different route.** A
comment left on `/dashboard` resolves against nothing at all while somebody is
looking at `/settings`, and reporting that as orphaned would unpin half a
review every time anyone navigated. Any fix has to compare
`comment.context.url` against where the reviewer actually is, and decide what
to do about the comments it cannot speak for. That is a design decision rather
than a missing line, and it is the next thing the gate needs.

### Neutral is "I cannot tell", never "fine"

`decideGate(undefined)` is a store that could not be read. A store with no
`setStatus` keeps status client-side, so nothing it reports can be trusted to
mean resolved, and blocking on it would be blocking on a guess. Both are
neutral, and both say which one they are.

`hasReview: false` is the last neutral, and it is not an "I cannot tell" at
all: a fork, a bot's version bump, a branch with no preview deployment. Nothing
is broken and nothing is expected. It is a separate reason rather than a flavour
of `unreadable` because the check would otherwise tell a person that Maple
failed to read comments on a pull request Maple was never installed for — and
because the gate must report on every pull request, so this is the case it
reports most often. The caller decides it, since only the caller knows whether a
preview exists; the sentence a reviewer reads is written once, here.

## Green is not the same as reviewed

`decideGate([])` is `clear`, and that is the right default and a real gap. A
pull request nobody opened the preview for reads exactly like one a designer
looked over and liked: both are green, both for the reason "no comments". The
gate is honest about comments and says nothing at all about whether anybody
looked, because until an approval exists there is nothing for it to say.

`requireApproval` is the opt-in that changes it. It is off unless three things
are set, and they have to agree: the action's `require-approval: "true"`,
`RouteOptions.requireApproval` (or `MAPLE_REQUIRE_APPROVAL` for the MCP
server), and an identity connector on the route. Setting one alone either does
nothing or lets a push clear a gate a reviewer is holding.

```ts
const verdict = decideGate(comments, {
  requireApproval: true,
  approvals: await store.approvals(branch),
  commit: sha,
  statusTracked: supports(store, "setStatus"),
});
```

On, a surface with nothing open blocks with `awaiting-approval` until somebody
presses **Approve** in the overlay. Off — the default — nothing about the
verdict changes, because turning a quiet pull request red is a decision a team
makes rather than one a tool makes for them.

Four rules hold it together.

- **An approval is about a commit**, for the reason a `GateTarget` is. A push
  is a new preview, so an approval of the commit before it is not an approval
  of this one and does not count toward it. `commit` is what an approval is
  matched against, and the route reads it from `store.head`, never from the
  browser — the same argument as [below](#where-the-commit-comes-from).
- **An open comment outranks a missing approval.** `comments-open` is checked
  first: what a reviewer should do about it is read the comment, not sign
  something off on top of it.
- **An approval nobody can be named for is not an approval.** `POST /approvals`
  answers 401 without a resolved reviewer, so `requireApproval` needs an
  identity connector. Otherwise anyone holding the preview URL could clear a
  required check as "Guest", which is worse than no gate at all.
- **Only the reviewer who approved can withdraw it.** Somebody else removing a
  signature is the one thing a sign-off has to be safe from.

A store with no `approvals` method is the fourth neutral rather than a gate
that blocks for ever: an approval that could not be looked for is "I cannot
tell", exactly as an unreadable comment list is. So is a surface whose commit
nothing can name — an approval matched against a guessed commit reads as an
answer.

The clear verdict names the approver in its title, so the check says
`Approved by Dana` rather than `No visual review comments`. That is the whole
point of the tier: the check now distinguishes the two greens.

## Publishing it

```ts
export interface GateConnector extends ConnectorMeta {
  publish(report: GateReport): Promise<void>;
  read?(target: GateTarget): Promise<GateVerdict | undefined>;
}
```

A `GateTarget` is a branch **and a commit**. A gate is never about a branch
alone: a new push is a new decision, and a verdict that outlives the commit it
was about is a verdict that lies.

`read` is optional, because not every forge will hand back what it was told.

### What the contract suite protects

`runGateContract` in `@maple-kit/core/testing` asserts the property that sank
Chromatic: **a gate that blocks must be able to stop blocking, on the same
commit, with no new push.** A reviewer resolving the last comment expects the
merge button to light up; asking them to push an empty commit to unstick CI is
how a required check gets deleted from the ruleset within a week.

## What the GitHub gate does

`githubGate` in `@maple-kit/core/connectors` was built in #56, and
`maple-action` calls it. What follows is why each part is the way it is, so
nobody rediscovers it by breaking it.

- **Only a GitHub App can create a check run**, so the gate authenticates as
  itself and never sees a reviewer's token — which is why it is a _second_ app.
  `docs/github-auth.md` has the reasoning: a user-to-server token is bounded by
  its app's permissions, so an app carrying `Checks` and `Contents` would hand
  every reviewer's token read access to the source. A workflow's own
  `GITHUB_TOKEN` with `checks: write` can create the run at push time; the App
  is what the SDK route needs, where a reviewer resolving a comment flips the
  check with no workflow running at all.
- **Blocked is `in_progress`, not `failure`.** A required check passes only on
  `success`, `skipped` or `neutral`, so `in_progress` blocks exactly as hard as
  a failure and can still be exited. Updating a _completed_ run is unreliable,
  so a completed run is never where the gate parks: a new run supersedes it.
- **The counts ride in `external_id`**, the field the API reserves for exactly
  this. Reading them back out of the markdown summary would be parsing prose.
- **Report on every pull request**, including forks, Dependabot and anything
  with no preview. That last case is `no-review`, and it concludes `neutral`. A
  required check that never reports on some pull requests is a required check
  somebody removes.
- **`merge_group.checks_requested` passes immediately.** A merge queue entry
  has no preview and nobody to comment on it, and its head commit is in the
  event payload rather than in `GITHUB_HEAD_REF`, which it does not have. This
  exact hang is what sank Chromatic.
- **Pin the check's source in the ruleset**, or anyone with push access can
  forge a green status under the same check name. Which App to pin depends on
  who publishes; see [which App to pin](#which-app-to-pin).

## Publishing from the route

The action publishes at push time. That alone leaves the gate one-way: a
reviewer who resolves the last comment waits for a commit nobody needs to make,
which is the exact failure `runGateContract` exists to protect against. So the
route publishes too, after a status changes.

`RouteOptions.gate` takes a `GateConnector` or a resolver, chosen per request
the way `store` and `media` already are. `RouteOptions.requireApproval` rides
with it, and the three `/approvals` endpoints publish a verdict the same way a
resolve does — recording a sign-off that nothing reports would leave the gate
holding on a pull request somebody already approved.

It is built from the gate App's own credentials — `MAPLE_GATE_APP_ID`,
`MAPLE_GATE_INSTALLATION_ID` and `MAPLE_GATE_PRIVATE_KEY`, the last a secret
and the first two not; `docs/configuration.md` has the table. A deployment
running the gate only in CI sets none of them: the action publishes on the
workflow's own `GITHUB_TOKEN`, and `require-approval` is then the input that
has to agree with `requireApproval` here.

The logic lives in `src/route/gate.ts` rather than inside `handler.ts`, because
a dispatch function is not where a second subject belongs.

### Where the commit comes from

The route's `setStatus` arm is handed a comment id and a status. A gate needs a
commit, so one has to be found, and there were three places to find it.

**The store names it**, through an optional `head(branch)`. That was the choice,
and the reason is blast radius rather than elegance. The alternative that costs
nothing is for the browser to send the commit — but the gate App holds
`Checks: write` across every repository it is installed on, and letting a page
choose the target hands a reviewer's session the power to publish a verdict on
any commit it can name. The two Apps exist to keep reviewer-controlled input
away from that credential; taking the sha from the request would give it back
over a different wire.

A resolver on `RouteOptions` was the third option. It keeps the sha server-side
too, but every host then reimplements the same pull-request lookup Maple already
does, each getting the caching subtly wrong in its own way.

The sha is read at publish time and never cached. A pull request's **number**
lasts its whole life, which is why `findPull` caches that; its **head** lasts
until the next push, and a cached one is how a check run lands on the commit
before last.

A store with no `head` publishes nothing, and says so through the logger. So
does a branch with no open pull request. A verdict on a guessed commit reads as
an answer, which is worse than silence.

### A gate publish must never fail a resolve

By the time the gate is published the status change has already happened. The
reviewer did the thing; the check is a report about it. `publishGate` therefore
catches everything and logs it, and the route answers 200 either way — the
failure costs the check update and nothing else.

This is also why the publish is awaited rather than left floating. A serverless
runtime may stop the process the moment the response is written, and a
fire-and-forget publish would be lost exactly where Maple is most often
deployed. Awaiting costs the reviewer a few hundred milliseconds and buys them a
check that has settled by the time they look at it.

### Two publishers, one check name

The action publishes at push time and the route publishes at resolve time, and
they are not the same GitHub identity. A workflow's `GITHUB_TOKEN` acts as the
**GitHub Actions** App; the route acts as **Maple's gate App**. GitHub allows a
check run to be modified only by the App that created it, and answers anything
else with

```
403 Invalid app_id `15368` - check run can only be modified by the GitHub App
that created it.
```

This was found by driving the loop by hand, not by a test, because every test
until then had one publisher. `GitHubGateOptions.appId` is the fix: told which
App it is, the gate ignores runs it does not own and posts a new one, which
supersedes the other under the same name. The foreign run is left untouched
rather than fought over.

Without `appId` the behaviour is what it always was — patch the most recent run
— which is correct when one publisher owns the check, and is why the option is
optional rather than required.

The alternative was to give the action the App's private key so that both
halves publish as the same App. That is worse: it puts a signing key in CI for
a job whose own `GITHUB_TOKEN` is already sufficient at push time, and the key
is the one credential `docs/github-auth.md` argues hardest about.

### Which App to pin

A ruleset's required check can name the App it must come from — the
`integration_id`, shown as the check's source. A run from any other App does
not satisfy it.

| Who publishes     | Pin                     | Why                                                                                  |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| The action only   | GitHub Actions, `15368` | Every run comes from `github.token`.                                                 |
| The gate App only | The gate App's own id   | The route and the MCP server both publish with its installation token.               |
| Both              | See below               | Each pin ignores the other publisher's runs, so it undoes half of what both are for. |

With both publishers, pinning `15368` means a reviewer's resolve publishes a
green run the ruleset does not count; the merge waits for the next workflow
run, which is the one-way gate the route exists to fix. Pinning the gate App
means a push has no run from it until someone changes a status, so the check
is missing rather than pending. The two ways out are to leave the source
unpinned and accept that push access can forge the check, or to have the
action publish as the gate App — its `token` and `app-id` inputs take the
App's installation token and id — at the cost of the App's key in CI, argued
against above. Choose one knowingly; neither is free.
