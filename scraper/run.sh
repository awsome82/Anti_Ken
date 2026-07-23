#!/bin/bash
export NVM_DIR="/home/kp/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

export NODE_TLS_REJECT_UNAUTHORIZED=0

if [ -f /home/kp/Anti_Ken/scraper/.env ]; then
  set -a
  source /home/kp/Anti_Ken/scraper/.env
  set +a
fi

node /home/kp/Anti_Ken/scraper/index.js

# Sync latest snapshot data to docs for GitHub Pages / local dashboard
mkdir -p /home/kp/Anti_Ken/docs/data/montvert
cp /home/kp/Anti_Ken/data/index.json /home/kp/Anti_Ken/docs/data/index.json
cp /home/kp/Anti_Ken/data/montvert/*.json /home/kp/Anti_Ken/docs/data/montvert/

