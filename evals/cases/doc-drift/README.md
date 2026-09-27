# Doc-drift cases

Paragraphs from Maple's own docs, each paired with the code change that decides
whether it is true. The job in `.github/workflows/doc-drift.yml` asks jev the
same question of a pull request: does this change make this paragraph false?

## Where they came from

An audit of the setup docs at `8093648` found paragraphs the code no longer
backed, and pull request #270 rewrote them. Each rewrite that fixed a claim a
code change had made false is a pair of cases here:

- **`stale`**: the paragraph as it stood at `8093648`, quoted exactly.
- **`current`**: the same paragraph as #270 left it, at `0ede164`, quoted
  exactly.

Both carry the same `change`: the real hunk, from the commit named in it, that
decides the claim. The removed and added lines are as that commit wrote them.

Nothing was written for the set. Paragraphs are quoted as the maintainer wrote
them, so `by` is `maintainer` throughout, and every `change` is a hunk from the
repository's own history.

**Left out, because a reader could argue them:** rewrites that added detail to
a paragraph that was not false (the gate's opt-in sentence in `docs/gate.md`),
fixes whose code decides nothing on its own (the Datadog row in
`docs/connectors.md`), fenced install lines, which the paragraph reader skips,
and the classifier's install sentence, whose peers make the old wording
incomplete rather than false.

## What is scored

`evals/doc-drift.eval.test.ts` scores three tiers over the 26 cases.

| Tier      | Measures                                                             | Measured     | Threshold |
| --------- | -------------------------------------------------------------------- | ------------ | --------- |
| trigger   | Recall: stale paragraphs `findCandidates` picks from their own hunk. | 0.538        | 0.53      |
| word list | Accuracy of "a quoted name is removed and not re-added".             | 0.500        | 0.5       |
| jev       | Accuracy at `FLAG_AT` (0.5) in `tools/doc-drift/run.ts`.             | 0.654, 0.692 | 0.65      |

The trigger misses six of thirteen, and every miss is a paragraph that names
nothing the hunk contains: `cookieKey` never existed in code, and "Maple reads
none of these itself" quotes no name at all. That is the limit of reading
references, not a bug in reading them, and is why jev is scored on every case
rather than only on those the trigger reaches.

The word list scores exactly what saying "current" every time scores. A rename
is the one drift a word list can see, and no stale paragraph here names
something its hunk removes without adding back: most hunks add code where
there was none. It is the floor jev has to clear, not a rival.

jev was measured twice, in the `eval` job of `.github/workflows/doc-drift-eval.yml`, the one
place `TYPESAFE_API_KEY` is set; one case moved between the runs, so that job
scores three samples. Its misses are mostly stale paragraphs scored between
0.26 and 0.49: the ones naming nothing the hunk shows. At 0.45 it would score
0.769, but choosing `FLAG_AT` on the same 26 cases it is scored on would be
tuning to the set, so it stays at 0.5 until the set grows. Until a threshold
here justifies more, the comment the job posts stays advice.

## Adding a case

A new pair comes the same way: a paragraph a code change made false, its fix,
and the hunk that decides it. Keep ids stable (`drift-<nnn>`), never reuse one,
and do not relabel a case after reading jev's answers.
