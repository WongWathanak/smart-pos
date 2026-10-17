@echo off
REM Starts the SMART bridge and opens the app in your browser.
REM Edit the two paths below if your folders are named differently.
cd /d "%~dp0"
set BACKEND=..\SMART_backend\smart_backend.exe
set FRONTEND=..\SMART_Frontend

where python >nul 2>nul
if %errorlevel%==0 (set PY=python) else (set PY=py -3)

start "" http://localhost:8080
%PY% smart_bridge.py --backend "%BACKEND%" --frontend "%FRONTEND%"
pause
