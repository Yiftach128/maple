---
"@maple-kit/cli": minor
---

Every command now accepts `--flag value` as well as `--flag=value`, so `maple setup app --owner acme` works as typed. Arguments are parsed by `node:util`'s `parseArgs` against a flag list each command declares, strictly.

What broke:

- An unknown flag, a string flag with no value, or a value given to a boolean flag is now an error, exit 1, that names the command's valid flags. Before, a typo was silently ignored.
- `--json=false` and the like no longer switch a boolean flag off; leave the flag out instead.
- `parseArgs(argv)` is now `parseArgs(argv, spec, { strict })`, taking the flags to accept, and throws `ArgsError` when strict. `isSet` is true only for a boolean flag that was given. `ArgsError`, `describeFlags`, `GLOBAL_FLAGS` and the `FlagSpec` and `FlagType` types are new exports.
