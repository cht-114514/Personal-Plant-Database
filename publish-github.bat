@echo off
setlocal
cd /d "%~dp0"
title Botanical Publish

where py >nul 2>nul && (set PY=py& goto :run)
where python >nul 2>nul && (set PY=python& goto :run)
where python3 >nul 2>nul && (set PY=python3& goto :run)

echo Python not found. Please install Python from python.org first.
pause
goto :done

:run
%PY% tools\publish_release.py %*
echo.
pause

:done
endlocal
