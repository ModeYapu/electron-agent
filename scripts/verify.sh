#!/bin/bash

# Electron Agent 验证脚本
# 验证所有 TypeScript 代码是否正确编译

set -e

echo "🔍 Verifying Electron Agent codebase..."
echo ""

# 检查每个包
echo "📦 Verifying packages..."

echo "  → @electron-agent/shared"
cd packages/shared
npm run verify
cd ../..

echo "  → @electron-agent/agent-core"
cd packages/agent-core
npm run verify
cd ../..

echo "  → @electron-agent/relay-server"
cd apps/relay-server
npm run verify
cd ../..

echo "  → @electron-agent/web-console"
cd apps/web-console
npm run verify
cd ../..

echo "  → @electron-agent/electron-client"
cd apps/electron-client
npm run verify
cd ../..

echo ""
echo "✅ All packages verified successfully!"
echo ""
echo "📊 Build Summary:"
echo "  • packages/shared: ✓"
echo "  • packages/agent-core: ✓"
echo "  • apps/relay-server: ✓"
echo "  • apps/web-console: ✓"
echo "  • apps/electron-client: ✓"
echo ""
echo "🎉 P0 milestone is ready!"
