@echo off
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
    py -3 run_funkspur.py
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3.10 or later is required. See README.md.
        pause
        exit /b 1
    )
    python run_funkspur.py
)
if errorlevel 1 pause
