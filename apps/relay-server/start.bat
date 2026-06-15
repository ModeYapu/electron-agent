@echo off
set AGENT_TOKEN=agent-...25
set ADMIN_TOKEN=admin-...25
set ADMIN_PASSWORD=***
set JWT_SECRET=jwt-se...25
set ADMIN_USERNAME=admin
set PORT=9300
cd /d D:\O_T_O\test\electron-agent\apps\relay-server
node ..\..\node_modules\tsx\dist\cli.mjs dist\index.js
