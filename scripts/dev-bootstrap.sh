#!/usr/bin/env bash
set -euo pipefail

if command -v npm >/dev/null 2>&1; then
  exit 0
fi

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  if [ -f ".nvmrc" ]; then
    nvm use >/dev/null
  fi
fi

if command -v npm >/dev/null 2>&1; then
  exit 0
fi

echo "npm not found. Ensure nvm is installed and open a new terminal, or run: nvm install && nvm use"
exit 1
