@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Playwright QA Starter - Setup 1-Click

echo ================================================================
echo   🚀 PLAYWRIGHT QA TESTING & COPILOT STARTER - SETUP 1-CLICK
echo ================================================================
echo.

:: 1. Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] May ban chua cai Node.js!
    echo Vui long tai va cai dat Node.js LTS tu: https://nodejs.org/
    echo Sau khi cai xong, hay chay lai file nay nhe.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [1/3] Node.js da duoc tim thay: !NODE_VER!

:: 2. Cai dat cac thu vien npm
echo.
echo [2/3] Dang cai dat cac thu vien kiem thu (Playwright ^& TypeScript)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Loi khi chay npm install! Vui long kiem tra lai ket noi mang.
    pause
    exit /b 1
)

:: 3. Cai dat trinh duyet Chromium noi bo
echo.
echo [3/3] Dang tai trinh duyet Chromium cho Playwright...
call npx playwright install chromium
if %errorlevel% neq 0 (
    echo [WARN] Khong the tai chromium tu dong. Ban co the chay "npx playwright install" sau.
)

echo.
echo ================================================================
echo   🎉 CAI DAT HOAN TAT 100%!
echo.
echo   Huong dan su dung:
echo   1. Mo thu muc nay bang VSCode.
echo   2. Khi VSCode hoi cai extension khuyen nghi, bam "Install All".
echo   3. Bam phim F5 de chay thu bo test mau!
echo ================================================================
echo.
pause
