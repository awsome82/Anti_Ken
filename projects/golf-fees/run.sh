#!/bin/bash
# Golf green fee scraper runner (local use).
# Snapshots are written to ./data (or $DATA_ROOT). To work on the real history,
# check out the `data` branch there first:
#   git fetch origin data && git worktree add projects/golf-fees/data data

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

export NODE_TLS_REJECT_UNAUTHORIZED=0
node "$SCRIPT_DIR/index.js"
