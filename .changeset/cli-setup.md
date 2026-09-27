---
"@maple-kit/cli": minor
---

`maple setup` registers and wires Maple's GitHub Apps from the command line.
`setup app --owner=<org>` prints the prefilled New GitHub App URL — the comment
App with `pull_requests: write` alone, or the gate App with `checks: write`
alone under `--gate` — followed by the steps a URL cannot set. `setup verify
--client-id=<Iv…>` checks that Device Flow is on. `setup ci` prints, or with
`--write` writes, the `maple-action` gate workflow and the `gh api` ruleset
command that requires `maple/visual-review`. Both permission sets are exported
as `GITHUB_APP_PERMISSIONS`.
