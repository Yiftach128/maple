# Evals

Every AI path in Maple ships with an eval set and a pass-rate threshold that CI
enforces. A prompt without an eval is a prompt nobody can change safely.

**Status:** three sets, each scoring its keyword baseline on every CI run and
the model tier whenever a credential is in the environment.

- `assist`: thirty review comments written against a real running application.
- `mock-plan`: 94 sentences for the mock box against seven pages' calls, two
  recorded from the examples and five written at production scale, three of
  them with flags and roles; 29 of the sentences are a set of their own for
  those, scored and gated apart. Every sentence so far is `by: agent`;
  `cases/mock-plan/README.md` says why that matters and what the set needs
  next.
- `doc-drift`: 26 paragraphs from Maple's own docs, thirteen a code change had
  made false and their rewrites, each paired with the hunk that decides it.

## Harness

Plain vitest, in the repository's own `node` project. An eval is a file named
`<area>.eval.test.ts`, so `pnpm test` runs it, CI runs it, and a threshold is
enforced by an `expect` like every other assertion.

### Why not evalite

evalite was tried first and is what this file used to name. It works — it ran
this set and reported 50% — and then **aborts the process on exit**: its result
store is `better-sqlite3`, whose statement finaliser calls
`RemoveEnvironmentCleanupHook` after the environment is gone, which on Node 24
is a native assertion failure and a non-zero exit. A harness that always exits
non-zero cannot enforce a threshold, which is the one thing it was here for.

Porting to vitest is what this file already said to do if the harness fought the
code, and it turned out to be smaller rather than a compromise:

- No `better-sqlite3`, so no native build at install time, and
  `onlyBuiltDependencies` goes back to empty.
- No `@fastify/static` pin, so the four advisories that override existed to
  answer left with the dependency that carried them.
- An eval runs in the same command as the tests, against source rather than a
  built `dist`, with the same reporters and the same watch mode.

What is lost is evalite's result UI and its stored history. Neither was in use,
and the report CI uploads is vitest's own.

## Conventions

### Case ids

Every case has a stable id, and ids are never reused:

```
<area>-<nnn>    e.g. classify-014, dedupe-003, trail-021
```

The id is what a regression is reported against, so renaming one loses the
history.

### Environment

| Variable          | Meaning                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `EVAL_SAMPLES=n`  | Run every case `n` times. Models are non-deterministic; a case that passes once may pass 60% of the time, and that is what this exposes. |
| `EVAL_IDS=a,b,c`  | Run only these case ids, for iterating on one failure.                                                                                   |
| `MAPLE_AI_MODEL=` | Which model to run against, so comparing providers is a flag rather than a rewrite.                                                      |

### Thresholds

Each eval file declares a minimum pass rate. CI fails below it. A threshold is
raised when the implementation improves and **never lowered to make a build
green** — a lowered threshold is a silent regression with a commit message.

With `EVAL_SAMPLES > 1`, the pass rate is over all runs, not over cases. A case
that passes 3 of 5 contributes 0.6.

### Cases

Real, anonymised comments and trails collected during dogfooding. No
synthetic-only sets: synthetic cases encode what the author expected people to
write, which is exactly the thing being tested.

Anonymising means replacing identifiers and host names, not rewriting the
English. A comment's phrasing is the input.

Each case records `by`, so a reader can tell a comment posted to a real pull
request from one written against the same screens in the same session.

**Label what is not arguable, and leave the rest out.** A case labels the pillar
rungs a reader would not argue about and omits the others; a scorer scores what
is there. Filling a field with a guess scores the guess.

**Labels are not revised after seeing a tier's answers.** Some `kind` labels in
the assist set are genuinely debatable — a comment that reports a fault _and_
asks for a change is both a `bug` and a `request` — and they are left as
written. Both tiers are scored against the same labels, so the comparison holds
wherever one is arguable; only the absolute numbers move.

### Reports

CI uploads the report as a build artifact on every run, so a drop can be read
without reproducing it locally.

## Layout

```
evals/
  README.md             this file
  package.json          a workspace package, so an eval imports @maple-kit/* by name
  cases/                one directory per area, its own README and JSON case files
  <area>.eval.test.ts   the eval definition and its scorers
```
