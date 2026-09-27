# Mock plan cases

Each case pairs a sentence a reviewer types into the mock box with the calls a
page made, the way `POST /mock/plan` hands them to a planner.

## Inventories

`inventories.json` holds seven pages' calls, each as `{ key, summary }` in the
form the route sends: the names in the call's last answer, and its schema in
one line. Three written pages, the dashboard, the order queue and the roast
detail, also carry the page's `flags` (`{ key, type, variants? }`, as the box
lists them) and the host's `roles`: 6 to 12 flags each, in the naming styles
real flags come in (kebab, camel, a ticket prefix such as `ROAST-2210-`),
booleans with a few string and number flags among them, and six roles, two of
them hyphenated.

- **`recorded`** (two): captured from the Vite and Next examples running in
  Chromium, with the box's own summaries, then passed through the route with
  each example's own schema. Nothing edited.
- **`written`** (five): pages of a coffee roaster's back office, written to
  the size a real application's pages reach rather than the examples' two to
  four calls. Typical pages make 7 to 12 calls across several namespaces and a
  heavy detail page 28; calls come as `list` / `get` / `count` siblings, stats
  and their `*Sparkline` twins, cursor envelopes (`nextCursor`, `totalCount`,
  `hasMore`), batched `listByXIds` lookups, a current-user call, and mutations
  among the reads. Every name is invented.

A mutation's summary says nothing about its being one, because neither the
page nor the route says so; a planner has to tell a write by its name.

## Cases

`cases.json`. **`by` is `agent` for every case so far**: the sentences were
written by the agent that also wrote the keyword planner. That is the bias
`../../README.md` warns about, and the keyword planner's state score is
inflated by it: it was written by someone who knew which words it matches.
Cases typed by a maintainer or a reviewer, against these inventories or a real
page, are what this set most needs, and they get their own `by`.

**Sets.** A case with `set: "layers"` (38, `mockplan-066` to `094` and `131`
to `139`) was written for flags and roles; one with `set: "values"` (36,
`mockplan-095` to `130`)
for `long`, `sparse` and `mixed`, with a few `many` and `empty` sentences that
read like them ("a long list of orders", "no invites at all"). Every other case
is the data set. The three are scored and gated apart. The layer sentences
mostly name no data state, which a word list gets right by matching nothing.
`mockplan-131` to `139` are one shape: a role, a flag and a state on one call
in one sentence ("as a barista with the new roast planner on, and the orders
list empty"), which used to put the state on every call.
The keyword planner's flag and role reading was tuned after the layer cases
were written, and its `long`, `sparse` and `mixed` patterns after the values
cases were, by the same agent, so those two sets flatter it most of all: on
the values set jev has to beat it only on calls.

**Labels.** `state` is always labelled. `calls` lists the calls the sentence
must concern, and is left out where that is arguable. `maybe` lists calls a
reader could argue either way; they count neither for nor against a plan. A
`none` case has no `calls`.

## Scores

Per set, as state accuracy / call F1 / layer accuracy. Layers are scored on
the three pages with flags and roles: exactly the flags, at exactly the
values, and the role meant, nothing more.

| Tier    | Data set (65)      | Layers set (38)    | Values set (36)    | When                                       |
| ------- | ------------------ | ------------------ | ------------------ | ------------------------------------------ |
| keyword | 92.3 / 69.0 / 97.0 | 100 / 73.5 / 84.2  | 94.4 / 61.8 / 100  | every CI run                               |
| jev     | 93.3 / 88.2 / 100  | 92.1 / 96.1 / 92.1 | 92.6 / 92.4 / 92.2 | `jev-latest`, `EVAL_SAMPLES=3`, with a key |

Thresholds, data; layers; values: keyword 0.90 / 0.68 / 0.95; 0.97 / 0.72 /
0.83; 0.94 / 0.61 / 0.99. jev 0.92 / 0.86 / 0.97; 0.88 / 0.93 / 0.90; 0.87 /
0.90 / 0.90.

The calls are judged on the sentence less the listed roles and flags it
names (`withoutLayers`). Before that, on these 139 cases, jev's call F1 was
76 on the data set, 44 on the layers set and 80 on the values set, and the
keyword planner's on the layers set 61: a role or a flag read as the whole
page.

On the data set jev has to beat the keyword planner outright on state and
calls; on the layers set, on the layers; on the values set, on calls. Its
data misses were mostly sentences a word list gets right by construction: "roast with no comments"
and "no comm" (read as something other than `empty` in some samples), and
"what does a cafe see when it can't see its orders". Its layers-set state
misses are sentences that mix a flag or a role with the data, such as
"queue sorted by priority" (read as `many`) and "a roaster who can't see the
cupping scores" (read as `none`). Its layer misses include "as a roaster in the
dark theme, and the low stock beans list empty", where the theme is not set.

Its values-set state misses, each in at least one of three samples: "supplier
name and contact email as long as they get", "lots from different harvest
years", "labels in every colour", "no attachments on this roast" and "no
cuppings yet". Its two values-set layer misses set a flag on a page with
flags where the sentence named none.
