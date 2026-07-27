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

set "FLAPSTACK_CLI_DIRECTORY=%ABS_DIR%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -EncodedCommand __FLAPSTACK_ENCODED_COMMAND__
set "FLAPSTACK_CLI_EXIT=%ERRORLEVEL%"
set "FLAPSTACK_CLI_DIRECTORY="
exit /b %FLAPSTACK_CLI_EXIT%
