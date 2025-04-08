@echo off
echo Starting CS2 HUD...
echo =================================

:: Установка пакетов в основной папке
echo Installing packages in main directory...
call npm install
echo Main packages installed!

:: Установка пакетов в папке overlay
echo Installing packages in overlay directory...
cd overlay
call npm install
cd ..
echo Overlay packages installed!

:: Запускаем сервер в фоновом режиме
start /b node server/server.js

:: Ждем 2 секунды, чтобы сервер успел запуститься
timeout /t 2 /nobreak > nul

echo Server is running!
echo Use browser to manage HUDs and teams
echo =================================