@echo off
title DataKarkhana Desktop App
echo ========================================================
echo          DATAKARKHANA DESKTOP AUTOMATION ENGINE         
echo ========================================================

:: Check python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not detected in PATH. Please install Python 3.10+ from python.org
    pause
    exit /b 1
)

:: Check node/npm
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not detected in PATH. Please install Node.js from nodejs.org
    pause
    exit /b 1
)

:: Check and auto-install Electron dependencies if missing
if not exist "%~dp0node_modules\electron" (
    echo [First-time Setup] Installing Desktop Electron dependencies...
    cd /d "%~dp0"
    call npm install
)

:: Check and auto-install Frontend dependencies if missing
if not exist "%~dp0\..\datakarkhana-frontend\node_modules" (
    echo [First-time Setup] Installing Frontend dependencies...
    cd /d "%~dp0\..\datakarkhana-frontend"
    call npm install
)

:: Electron's main.js now handles starting both backend and frontend automatically.
:: Just launch Electron — it will spawn Python backend + Next.js frontend dev server,
:: show a splash screen while they initialize, and open the main window when ready.

echo Launching DataKarkhana Desktop (auto-starts backend + frontend)...
cd /d "%~dp0"
npm start

pause
