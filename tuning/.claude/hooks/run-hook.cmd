: << 'CMDEOF'
@echo off
setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "HOOK_NAME=%~1"
set "BASH_CMD="
for %%P in (
    "%ProgramFiles%\Git\bin\bash.exe"
    "%ProgramFiles(x86)%\Git\bin\bash.exe"
    "%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
    "%ProgramFiles%\Git\usr\bin\bash.exe"
) do (
    if exist %%P if not defined BASH_CMD set "BASH_CMD=%%~P"
)
if defined BASH_CMD (
    "%BASH_CMD%" "%SCRIPT_DIR%%HOOK_NAME%" 2>&1
    exit /b %ERRORLEVEL%
)
echo {"decision": "approve", "reason": "bash not found"} >&2
exit /b 0
CMDEOF
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_NAME="$1"
exec bash "${SCRIPT_DIR}/${HOOK_NAME}" 2>&1
