@echo off
rem GOTO Poker - diagnostics report
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0system\scripts\diagnose.ps1"
