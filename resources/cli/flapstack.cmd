@echo off
REM flapstack CLI launcher
REM Opens Flapstack app with the specified directory

set "DIR=%~1"
if "%DIR%"=="" set "DIR=%CD%"

for %%I in ("%DIR%") do set "ABS_DIR=%%~fI"

if not exist "%ABS_DIR%\" (
  echo Error: Invalid directory
  exit /b 1
)

start "" "Flapstack" "%ABS_DIR%"
