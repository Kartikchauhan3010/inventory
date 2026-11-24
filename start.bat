@echo off
cd /d "%~dp0"
title Stockyard - Inventory App
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing packages, please wait...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
call node setup.js
if errorlevel 1 (
  pause
  exit /b 1
)
echo Starting the app. Your browser will open in a few seconds. Keep this window open.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
node server.js
pause
