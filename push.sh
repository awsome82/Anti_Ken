#!/bin/bash
# Convenient push script for Anti_Ken project

TOKEN="${1:-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}"

if [ -z "$TOKEN" ]; then
  echo "Usage: bash push.sh <YOUR_GITHUB_TOKEN>"
  exit 1
fi

echo "Setting remote URL with token..."
git remote set-url origin "https://${TOKEN}@github.com/awsome82/Anti_Ken.git"

echo "Pushing code to GitHub (branch main)..."
git push -u origin main
