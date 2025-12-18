@echo off
chcp 65001 >nul 2>&1
cls

REM Get current directory
set "GAME_DIR=%~dp0"
set "GAME_DIR=%GAME_DIR:~0,-1%"

echo ========================================
echo   BOHEMIA AIRPG - PORTABLE VERSION
echo ========================================
echo.
echo Game directory: %GAME_DIR%
echo.

REM Define Node.js version
set NODE_VERSION=22.12.0
set NODE_DIR=%GAME_DIR%\node-portable
set NODE_ZIP=%GAME_DIR%\node-v%NODE_VERSION%-win-x64.zip
set NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip

REM Check if portable Node.js exists
if exist "%NODE_DIR%\node.exe" (
    echo [OK] Portable Node.js found: %NODE_DIR%
    echo.
    goto :check_dependencies
)

echo [STEP 1/4] Downloading portable Node.js...
echo This is a one-time download (~30 MB)
echo Please wait, this may take 1-2 minutes...
echo.

REM Download Node.js using PowerShell
echo Downloading from: %NODE_URL%
echo.
powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%'}"

if not exist "%NODE_ZIP%" (
    echo.
    echo ========================================
    echo ERROR: Failed to download Node.js!
    echo ========================================
    echo Please check your internet connection.
    echo.
    pause
    exit /b 1
)

echo [OK] Downloaded: %NODE_ZIP%
echo.

echo [STEP 2/4] Extracting Node.js...
echo.
powershell -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%GAME_DIR%' -Force"

REM Rename extracted folder
for /d %%i in (%GAME_DIR%\node-v%NODE_VERSION%-win-x64) do (
    if exist "%%i" (
        echo Renaming: %%i
        move "%%i" "%NODE_DIR%" >nul 2>&1
    )
)

REM Delete zip file
if exist "%NODE_ZIP%" (
    del "%NODE_ZIP%"
    echo [OK] Deleted temporary zip file
)

if not exist "%NODE_DIR%\node.exe" (
    echo.
    echo ========================================
    echo ERROR: Node.exe not found!
    echo ========================================
    echo Expected location: %NODE_DIR%\node.exe
    echo.
    dir "%GAME_DIR%" /b
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js extracted successfully!
echo Node.exe: %NODE_DIR%\node.exe
echo.

:check_dependencies
REM Check if dependencies are installed
if exist "%GAME_DIR%\node_modules\ws\package.json" (
    echo [OK] Dependencies already installed
    echo Location: %GAME_DIR%\node_modules
    echo.
    goto :start_server
)

echo [STEP 3/4] Installing dependencies...
echo This will take 1-2 minutes, please wait...
echo DO NOT CLOSE THIS WINDOW!
echo.

REM Change to game directory (CRITICAL!)
echo Changing directory to: %GAME_DIR%
cd /d "%GAME_DIR%"
echo Current directory: %CD%
echo.

REM Verify package.json exists
if not exist "%GAME_DIR%\package.json" (
    echo.
    echo ========================================
    echo ERROR: package.json not found!
    echo ========================================
    echo Expected location: %GAME_DIR%\package.json
    echo.
    echo Files in game directory:
    dir "%GAME_DIR%" /b
    echo.
    pause
    exit /b 1
)

echo [OK] package.json found
echo.

REM Install dependencies using portable npm
echo Running: "%NODE_DIR%\npm.cmd" install
echo.
"%NODE_DIR%\npm.cmd" install

if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo ERROR: npm install failed!
    echo ========================================
    echo Error code: %errorlevel%
    echo.
    echo Possible solutions:
    echo 1. Check your internet connection
    echo 2. Run as Administrator
    echo 3. Disable antivirus temporarily
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

REM Verify ws module is installed
if not exist "%GAME_DIR%\node_modules\ws\package.json" (
    echo.
    echo ========================================
    echo WARNING: ws module not found!
    echo ========================================
    echo Trying to install ws manually...
    echo.
    "%NODE_DIR%\npm.cmd" install ws
    
    if not exist "%GAME_DIR%\node_modules\ws\package.json" (
        echo.
        echo ========================================
        echo ERROR: Failed to install ws module!
        echo ========================================
        echo.
        echo Checking node_modules directory:
        if exist "%GAME_DIR%\node_modules\" (
            dir "%GAME_DIR%\node_modules" /b
        ) else (
            echo node_modules directory NOT FOUND!
        )
        echo.
        pause
        exit /b 1
    )
)

echo.
echo [OK] Dependencies installed successfully!
echo ws module: %GAME_DIR%\node_modules\ws
echo.

:start_server
echo [STEP 4/4] Starting server...
echo.

REM Check and free port 3000
echo Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3000 ^| findstr LISTENING') do (
    echo Closing process on port 3000 (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)
echo.

echo ========================================
echo   SERVER STARTING
echo ========================================
echo.
echo URL: http://localhost:3000
echo Browser will open in 2 seconds
echo.
echo Server directory: %GAME_DIR%
echo Node modules: %GAME_DIR%\node_modules
echo Node.exe: %NODE_DIR%\node.exe
echo Server.js: %GAME_DIR%\server.js
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

REM Verify server.js exists
if not exist "%GAME_DIR%\server.js" (
    echo.
    echo ========================================
    echo ERROR: server.js not found!
    echo ========================================
    echo Expected: %GAME_DIR%\server.js
    echo.
    pause
    exit /b 1
)

REM Change to game directory (CRITICAL!)
cd /d "%GAME_DIR%"

REM Set NODE_PATH to point to our node_modules
set "NODE_PATH=%GAME_DIR%\node_modules"
echo NODE_PATH: %NODE_PATH%
echo.

REM Open browser after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

REM Start server using portable Node.js
echo Starting Node.js...
echo.
"%NODE_DIR%\node.exe" "%GAME_DIR%\server.js"

echo.
echo ========================================
echo Server stopped
echo ========================================
echo.
pause




