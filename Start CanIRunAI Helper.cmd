@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto failed
where node >nul 2>&1
if errorlevel 1 goto neednode
where npm >nul 2>&1
if errorlevel 1 goto neednode
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)"
if errorlevel 1 goto neednode
node -e "process.exit(process.platform==='win32'&&process.arch==='x64'&&!/arm|aarch/i.test(require('node:os').machine())?0:1)"
if errorlevel 1 goto unsupported
node --import tsx --input-type=module -e "await import('zod')" >nul 2>&1
if not errorlevel 1 goto launch
echo First launch installs locked dependencies from npm; no Ollama or model download yet.
call npm ci --include=dev --no-audit --no-fund
if errorlevel 1 goto failed
:launch
call npm run helper
if errorlevel 1 goto failed
exit /b 0
:neednode
echo Please install Node.js 24 for Windows x64 from https://nodejs.org, then reopen this helper.
echo Minimum Node.js version: 22.13. No administrator launch is needed.
goto waitfailure
:unsupported
echo This launcher requires Windows 10 22H2 / Windows 11 and x64 Node.js.
echo Windows ARM and 32-bit Windows are not supported in this release.
goto waitfailure
:failed
echo CanIRunAI could not start. Check the error above and docs/HELPER.md.
:waitfailure
pause
exit /b 1
