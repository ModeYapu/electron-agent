#!/bin/bash
# Build Electron Agent Client from WSL
# Fixes Chinese output encoding from Windows cmd.exe
set -euo pipefail
cd "$(dirname "$0")/.."

echo "🔨 Building @electron-agent/electron-client..."
npx.exe -w @electron-agent/electron-client npm run build 2>&1 | iconv -f GBK -t UTF-8 2>/dev/null
echo "✅ Build complete: apps/electron-client/build/Electron Agent Client Setup 0.1.0.exe"
