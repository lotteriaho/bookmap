@echo off
chcp 65001 >nul
cd /d "%~dp0"
python bn_relay.py
pause
