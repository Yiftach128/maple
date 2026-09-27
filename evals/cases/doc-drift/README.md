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

`drift-027` onwards come from the history rather than the audit: commits where
a doc was corrected after, or alongside, the code that made it false. Each is
one of three kinds:

- **A pair**, as above: the paragraph at the fixing commit's parent, labelled
  `stale`, and as that commit left it, labelled `current`, with the same hunk.
  Renamed scopes and subpaths, a changed default, a moved fallback, a list
  that gained a member, a status line the build overtook, a version pin.
- **A hard negative**: a paragraph the commit left alone that names what the
  hunk touches and is still true, such as the `--json` sentence beside a flag
  parser rewrite, or the banner's controls beside a change to where it docks.
  These are what a judge that flags every name it recognises gets wrong.
- **One paragraph, two hunks**: the comment-id sentence is `current` against
  #51, which left ids alone, and `stale` against #100, which changed them.

`drift-069` is drift that is still in the tree: the setup skill says flags take
`--flag=value` only, and #292 made the CLI accept `--flag value` too.

A hunk is quoted with three lines of context, or one where three merged the
deciding lines into a hunk longer than the 60 lines the judge reads.

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

`evals/doc-drift.eval.test.ts` scores three tiers over the 71 cases.

| Tier            | Measures                                                             | Measured    | Threshold |
| --------------- | -------------------------------------------------------------------- | ----------- | --------- |
| trigger (audit) | Recall: stale paragraphs `findCandidates` picks from their own hunk. | 0.538       | 0.53      |
| trigger (all)   | The same, over every stale paragraph.                                | 0.265       | 0.26      |
| word list       | Accuracy of "a quoted name is removed and not re-added".             | 0.521       | 0.52      |
| jev             | Accuracy at `FLAG_AT` (0.4) in `tools/doc-drift/run.ts`.             | 0.765–0.798 | 0.75      |

The trigger misses six of the audit's thirteen, and every miss is a paragraph
that names nothing the hunk contains: `cookieKey` never existed in code, and
"Maple reads none of these itself" quotes no name at all. That is the limit of
reading references, not a bug in reading them, and is why jev is scored on
every case rather than only on those the trigger reaches.

Over the whole set it reaches 9 of 34. The history's stale paragraphs mostly
state a count, a version or a status ("eight times", "Node 22.13", "not built
yet") that no reference carries. The audit's 0.53 is still gated on the audit's cases,
where it was measured; the whole set's recall has a threshold of its own
rather than lowering that one.

The word list scores exactly what saying "current" every time scores. A rename
is the one drift a word list can see, and no stale paragraph here names
something its hunk removes without adding back: most hunks add code where
there was none. It is the floor jev has to clear, not a rival.

jev is measured in the `eval` job of `.github/workflows/doc-drift-eval.yml`,
the one place `TYPESAFE_API_KEY` is set, over three samples, because a case
can move between runs. On the audit's 26 it scored 0.654 and 0.692 at 0.5; the
set was too small to choose `FLAG_AT` on without tuning to it.

On 71 cases, two runs of three samples (426 answers), cut at each point:

| `FLAG_AT` | All 71 | Audit (26) | History (45) |
| --------- | ------ | ---------- | ------------ |
| 0.30      | 0.772  | 0.731      | 0.796        |
| 0.35      | 0.784  | 0.744      | 0.807        |
| **0.40**  | 0.782  | 0.782      | 0.781        |
| 0.45      | 0.779  | 0.750      | 0.796        |
| 0.50      | 0.756  | 0.692      | 0.793        |
| 0.55      | 0.742  | 0.667      | 0.785        |

Every cut from 0.35 to 0.45 beats 0.5, on each half of the set as well as on
the whole. 0.35 leads the whole by one answer in 426, which is noise, and
drops to 0.744 on the audit's half; 0.40 is the only cut at 0.78 or more on
both halves. Five runs at 0.4 scored 0.765 to 0.798, so `FLAG_AT` is 0.4 and
the threshold is 0.75, under the lowest run rather than inside the spread.

What it still misses is mostly stale paragraphs scored under 0.4 that state
something no hunk line spells out: "eight times" against a cap that became
"in a row" (`drift-027`), a fallback that moved from the route into the store
(`drift-070`), a kinds table short of three methods (`drift-041`). The
current paragraphs it flags quote the very lines the hunk changes, such as the
comment-id sentence against #51 (`drift-045`, 0.68). Until a threshold here
justifies more, the comment the job posts stays advice.

## Adding a case

A new pair comes the same way: a paragraph a code change made false, its fix,
and the hunk that decides it. Keep ids stable (`drift-<nnn>`), never reuse one,
and do not relabel a case after reading jev's answers.
