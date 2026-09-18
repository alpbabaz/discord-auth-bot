@echo off
title Novex Auth - FULL
cd /d "%~dp0"
echo.
echo   ================================
echo     NOVEX AUTH - TUMU BASLATILIYOR
echo   ================================
echo.
start "Novex Server" cmd /c "cd /d %~dp0 && node server.js"
start "Novex Bot" cmd /c "cd /d %~dp0 && node bot.js"
echo   Server ve Bot baslatildi.
echo.
pause
