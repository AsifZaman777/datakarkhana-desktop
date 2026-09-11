@echo off
title Installing DataKarkhana App Icon...
powershell -ExecutionPolicy Bypass -File "%~dp0create_shortcut.ps1"
echo.
echo [OK] App icon created on your Desktop! You can now start DataKarkhana by double-clicking the Desktop icon.
timeout /t 3 >nul
