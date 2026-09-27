#!/bin/sh
# Runs before every other hook. On a Node older than .nvmrc, pnpm dies with
# ERR_UNKNOWN_BUILTIN_MODULE for node:sqlite, naming neither Node nor a version.
# Plain POSIX sh on purpose: it has to run on exactly the Node it rejects.
# Majors only, downwards only: `engines` is >=24.0.0, so any 24.x or newer runs.
set -eu

want="$(tr -d ' \r\nv' < "$(git rev-parse --show-toplevel)/.nvmrc")"
have="$(node -v 2>/dev/null || echo not)"
have="${have#v}"

if [ "$have" != not ] && [ "${have%%.*}" -ge "${want%%.*}" ]; then
  exit 0
fi

echo "Node $have found, this repo needs $want — run \`nvm use\`" >&2
exit 1
