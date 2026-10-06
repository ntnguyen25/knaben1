@echo off
title Knaben Stremio Addon - Trien Khai Cloudflare Worker
cls
echo =========================================================
echo    Knaben Stremio Addon - Trien Khai Cloudflare Worker
echo =========================================================
echo.

where npx >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Chua cai dat Node.js / npx!
    echo Vui long cai dat Node.js tai: https://nodejs.org
    echo.
    pause
    exit /b
)

echo Dang trien khai len Cloudflare Workers bang Wrangler...
call npx wrangler deploy
echo.
echo =========================================================
echo   Trien khai hoan tat!
echo   Hay lay link Worker va dan /manifest.json vao Stremio.
echo =========================================================
echo.
pause
