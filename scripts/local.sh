#!/bin/sh
# Use installed Node, or the ignored local runtime prepared for this clone.
set -eu
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$PWD"/.tools/node-*/bin; do
    if [ -x "$candidate/node" ]; then PATH="$candidate:$PATH"; export PATH; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 or newer from https://nodejs.org/en/download, then try again.' >&2
  exit 1
fi
exec npm run "${1:-start}"
