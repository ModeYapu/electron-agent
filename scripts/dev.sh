#!/bin/bash

# Electron Agent 开发启动脚本
# 按顺序启动所有服务

set -e

echo "🚀 Starting Electron Agent development environment..."

# 检查依赖
echo "📦 Checking dependencies..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 22+"
    exit 1
fi

# 安装依赖
echo "📥 Installing dependencies..."
npm install

# 编译 shared 包
echo "🔨 Building @electron-agent/shared..."
cd packages/shared
npm run build
cd ../..

# 启动中继服务器
echo "🌐 Starting relay server..."
cd apps/relay-server
npm run dev &
RELAY_PID=$!
cd ../..

# 等待服务器启动
echo "⏳ Waiting for relay server to start..."
sleep 3

# 启动 Web Console
echo "🖥️  Starting web console..."
cd apps/web-console
npm run dev &
WEB_PID=$!
cd ../..

# 等待 Web Console 启动
echo "⏳ Waiting for web console to start..."
sleep 3

# 启动 Electron 客户端
echo "⚡ Starting electron client..."
cd apps/electron-client
npm run dev &
ELECTRON_PID=$!
cd ../..

echo ""
echo "✅ All services started!"
echo ""
echo "📱 Relay Server: http://localhost:9300"
echo "🌐 Web Console: http://localhost:5173"
echo "⚡ Electron Client: Running in background"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# 处理退出信号
trap "echo '🛑 Stopping all services...'; kill $RELAY_PID $WEB_PID $ELECTRON_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# 等待所有后台进程
wait
