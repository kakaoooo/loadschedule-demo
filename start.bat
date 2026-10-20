@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js - ติดตั้งได้จาก https://nodejs.org แล้วเปิดไฟล์นี้อีกครั้ง
  pause
  exit /b 1
)
node server.js
pause
