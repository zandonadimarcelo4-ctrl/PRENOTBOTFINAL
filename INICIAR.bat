@echo off
chcp 65001 >nul
title PrenotaBot Livre
cd /d "%~dp0"

rem ==== 1) Procura um Python que funcione (3.10 ou mais novo) ====
set "PY="
py -3 -c "import sys; assert sys.version_info>=(3,10)" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys; assert sys.version_info>=(3,10)" >nul 2>nul && set "PY=python"
if not defined PY (
    echo.
    echo  Python nao encontrado. Vou instalar o Python 3.12 automaticamente...
    echo  ^(se o Windows perguntar, clique em SIM^)
    winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo  Nao consegui instalar sozinho. Abra https://www.python.org/downloads/
        echo  baixe o Python, marque "Add python.exe to PATH" e rode este arquivo de novo.
        start https://www.python.org/downloads/
        pause
        exit /b 1
    )
    echo.
    echo  Python instalado! Feche esta janela e de dois cliques em INICIAR.bat de novo.
    pause
    exit /b 0
)

rem ==== 2) Primeira vez: cria o ambiente e instala as bibliotecas ====
if not exist ".venv\Scripts\pythonw.exe" (
    echo.
    echo  Primeira execucao: preparando o PrenotaBot ^(leva 1-2 minutos, so desta vez^)...
    %PY% -m venv .venv || (echo Erro ao criar o ambiente. & pause & exit /b 1)
)
if not exist ".venv\.instalado" (
    ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q --upgrade pip
    ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || (echo Erro ao instalar. Verifique a internet. & pause & exit /b 1)
    echo ok> ".venv\.instalado"
    if not exist files mkdir files
    if not exist .env copy .env.example .env >nul
    call "%~dp0criar_atalho.bat" silencioso
)

rem ==== 3) Abre o painel sem janela preta ====
start "" ".venv\Scripts\pythonw.exe" painel.pyw
exit /b 0
