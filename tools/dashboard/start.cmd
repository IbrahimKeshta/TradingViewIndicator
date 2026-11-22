@echo off
rem EGX Daily dashboard: starts the local server and opens it in the browser.
rem Leave this window open while you use the page; close it to stop the server.
set "PATH=%APPDATA%\fnm\aliases\default;%PATH%"
cd /d "%~dp0..\.."
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8787"
node --experimental-websocket tools\dashboard\server.mjs %*
pause
