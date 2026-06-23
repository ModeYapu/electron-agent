@echo off
cd /d D:\O_T_O\test\electron-agent\apps\relay-server
for /f "tokens=2 delims==" %%a in ('findstr /b "AGENT_TOKEN=" .env') do set TOKEN=%%a
echo TOKEN=%TOKEN%
