@echo off
title Knaben Stremio Addon - Local PC Launcher
cls
echo =========================================================
echo    Knaben Stremio Addon - Engine Khởi Chạy Local PC
echo =========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] May tinh chua cai dat Node.js!
    echo Vui long tai va cai dat Node.js tai: https://nodejs.org
    echo.
    pause
    exit /b
)

echo [1/2] Dang kiem tra va cai dat thu vien (npm install)...
call npm install --legacy-peer-deps
echo.

echo [2/2] Dang khoi chay Knaben Stremio Addon Server...
echo =========================================================
echo  Server dang chay tai: http://127.0.0.1:3000
echo.
echo  Mo Stremio -^> Add-ons -^> Dan link nay de cai dat:
echo  http://127.0.0.1:3000/manifest.json
echo =========================================================
echo.

call npm start
pause
