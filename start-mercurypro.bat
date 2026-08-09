@echo off
setlocal
title MercuryPro Development Server

cd /d "%~dp0"

echo ========================================
echo   MercuryPro Launcher
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Install Node.js 20 or newer, then run this file again.
    echo Download: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Please reinstall Node.js.
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo [INFO] Created .env from .env.example.
        echo [INFO] Set GEMINI_API_KEY in .env to enable Gemini AI.
        echo.
    )
)

if not exist "node_modules\" (
    echo [1/3] Installing dependencies for the first run...
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo [ERROR] Dependency installation failed.
        echo Check your network connection and the error above.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies found. Skipping installation.
)

if not exist "grok-engine\runtime\.venv\Scripts\python.exe" (
    echo [2/3] Installing the built-in Grok fingerprint browser engine...
    call npm.cmd run setup:grok
    if errorlevel 1 (
        echo.
        echo [ERROR] Grok engine installation failed.
        echo You can retry later with: npm.cmd run setup:grok
        pause
        exit /b 1
    )
) else (
    echo [2/3] Built-in Grok engine found. Skipping installation.
)

echo [3/3] Starting MercuryPro FastAPI and Vite...
echo URL: http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3000'"
call npm.cmd run dev

echo.
echo MercuryPro has stopped.
pause
endlocal
