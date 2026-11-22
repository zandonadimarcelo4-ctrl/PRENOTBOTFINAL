@echo off
rem Cria o atalho "PrenotaBot Livre" na Area de Trabalho
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\PrenotaBot Livre.lnk'); $s.TargetPath='%~dp0INICIAR.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.IconLocation='%SystemRoot%\System32\shell32.dll,13'; $s.Save()" >nul 2>nul
if /i not "%~1"=="silencioso" (
    echo Atalho "PrenotaBot Livre" criado na Area de Trabalho.
    pause
)
