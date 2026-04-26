@echo off
setlocal
cd /d "%~dp0"
title Botanical Data Check

echo.
echo   Botanical Data Compatibility Check
echo   ==================================
echo.

where py >nul 2>nul && (set PY=py& goto :run)
where python >nul 2>nul && (set PY=python& goto :run)
where python3 >nul 2>nul && (set PY=python3& goto :run)

echo   Python not found. Please install Python from python.org first.
echo.
pause
goto :done

:run
%PY% tools\check_data_compat.py
echo.
pause

:done
endlocal
