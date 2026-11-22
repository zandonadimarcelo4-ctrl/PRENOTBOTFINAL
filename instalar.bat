@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Instalando PrenotaBot ===
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
if not exist .venv (
    %PY% -m venv .venv || (echo Erro ao criar o ambiente virtual. Instale o Python 3.10+ & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt || (echo Erro na instalacao & pause & exit /b 1)
if not exist .env copy .env.example .env >nul
if not exist files mkdir files
echo.
echo Instalacao concluida. Verificando configuracao...
python main.py --verificar
pause
