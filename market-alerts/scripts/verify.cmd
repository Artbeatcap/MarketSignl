@echo off
REM Chain on success — PowerShell ";" continues after failure; this does not.
cd /d "%~dp0.."
node scripts/fetch-fixture.mjs && node --test && node scripts/backtest-lower-high.mjs
