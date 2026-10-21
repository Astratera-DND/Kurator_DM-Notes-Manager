@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo First run - installing dependencies, this can take a minute...
    call npm install
    if errorlevel 1 (
        echo.
        echo Something went wrong during npm install. See the error above.
        pause
        exit /b 1
    )
)

call npm start
if errorlevel 1 (
    echo.
    echo Something went wrong starting the app. See the error above.
    pause
)
