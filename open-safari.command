#!/bin/zsh
set -e
LOG_FILE="/Users/arkadiuszlupierz/Documents/Web_AI_Projects/makemyideawork/vite.log"
if [[ -f "$LOG_FILE" ]]; then
  URL=$(grep -E "Local:" "$LOG_FILE" | tail -n 1 | awk '{print $3}')
fi
if [[ -z "${URL}" ]]; then
  URL="http://127.0.0.1:5173/"
fi
open -a Safari "$URL"
