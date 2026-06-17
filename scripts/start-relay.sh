#!/bin/bash
# Start relay-server from WSL with proper encoding
set -euo pipefail
cd "$(dirname "$0")/.."

# Kill existing on port 9300
PID=$(cmd.exe /c "netstat -ano | findstr :9300 | findstr LISTENING" 2>/dev/null | awk '{print $NF}' | head -1)
if [ -n "$PID" ]; then
  cmd.exe /c "taskkill /F /PID $PID" 2>/dev/null
  sleep 1
fi

# Clean stale log
rm -f apps/relay-server/server.log

echo "🚀 Starting relay-server on :9300..."
export ADMIN_USERNAME=admin
export PORT=9300

# Start in background, capture tokens
cmd.exe /c "set ADMIN_USERNAME=admin&& set PORT=9300&& cd /d D:\\O_T_O\\test\\electron-agent && node node_modules/tsx/dist/cli.mjs apps/relay-server/src/index.ts" 2>&1 \
  | iconv -f GBK -t UTF-8 2>/dev/null \
  | tee apps/relay-server/server.log &
