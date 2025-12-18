@echo off
chcp 65001 >nul
echo ==========================================
echo      RPG GAME DEPLOYMENT SCRIPT
echo ==========================================

echo [1/4] Checking Git repository...
if not exist .git (
    echo Git not found. Initializing...
    git init
)

:: Check for Git Identity
git config user.email >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [!] ОШИБКА: Git не знает, кто вы.
    echo Введите эти две команды в терминал:
    echo git config --global user.email "deploy@bohemia.ai"
    echo git config --global user.name "Bohemia Admin"
    pause
    exit /b
)

echo.
echo [2/4] Adding files to Git...
git add .

echo.
set /p COMMIT_MSG="Enter commit message (press Enter for 'Auto-update'): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=Auto-update

echo.
echo [3/4] Committing changes...
git commit -m "%COMMIT_MSG%"

echo.
echo [4/4] Pushing to GitHub...
:: Check if remote exists
git remote get-url origin >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [!] ОШИБКА: Не привязан удаленный репозиторий.
    echo Введите в терминал команду для привязки:
    echo git branch -M main
    echo git remote add origin https://github.com/BohemiaAIRPG/0.1.git
    echo git push -u origin main
    pause
    exit /b
)

:: Ensure we are on main branch
git branch -M main
git push origin main

echo.
echo ==========================================
echo      DEPLOYMENT COMPLETED SUCCESSFULLY
echo ==========================================
pause
