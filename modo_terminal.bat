@echo off
chcp 65001 >nul
rem Roda o bot sem o painel (texto). Ex.: modo_terminal.bat --perfil meu_perfil
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Rode primeiro o INICIAR.bat
    pause
    exit /b 1
)
".venv\Scripts\python.exe" main.py %*
pause
