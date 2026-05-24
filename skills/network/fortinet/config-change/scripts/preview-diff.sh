#!/usr/bin/env bash
# preview-diff.sh — render a side-by-side diff of two FortiManager config exports.
#
# Usage: preview-diff.sh <before.conf> <after.conf>
#
# This helper is BUNDLED + HASHED with the scogo:fortinet-config-change skill and
# reviewed like any other file, but sia NEVER executes it automatically
# (skills.disableShellExecution is on; binding contract §2.1). It is here for an
# OPERATOR to run by hand when a policy table is too large to eyeball inline.
#
# It is intentionally committed NON-EXECUTABLE (mode 0644). Run it explicitly via
# `bash preview-diff.sh before.conf after.conf` — do not rely on the +x bit.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: preview-diff.sh <before.conf> <after.conf>" >&2
  exit 2
fi

before="$1"
after="$2"

for f in "$before" "$after"; do
  if [[ ! -r "$f" ]]; then
    echo "error: cannot read '$f'" >&2
    exit 1
  fi
done

# Side-by-side, suppressing identical lines so only the change stands out.
# `|| true` keeps a non-zero diff exit (files differ) from tripping `set -e`.
diff --side-by-side --suppress-common-lines "$before" "$after" || true
