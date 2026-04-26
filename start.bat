@echo off
setlocal
cd /d "%~dp0"
title Botanical Database
set PORT=8080

echo.
echo   Botanical Database
echo   =====================
echo.

:: ---- Try Python ----
where python >nul 2>nul && (set PY=python& goto :start_python)
where python3 >nul 2>nul && (set PY=python3& goto :start_python)
where py >nul 2>nul && (set PY=py& goto :start_python)

:: ---- No Python: PowerShell fallback (read-only, no API) ----
echo   Python not found. Using PowerShell (read-only mode)...
echo   NOTE: Photo upload requires Python. Install from python.org
echo   URL: http://localhost:%PORT%
echo   Close this window to stop.
echo.

start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORT%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$root='%~dp0';" ^
 "$port=%PORT%;" ^
 "$mime=@{'.html'='text/html;charset=utf-8';'.js'='application/javascript;charset=utf-8';'.css'='text/css;charset=utf-8';'.json'='application/json;charset=utf-8';'.wasm'='application/wasm';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.gif'='image/gif';'.svg'='image/svg+xml';'.ico'='image/x-icon';'.pdf'='application/pdf';'.db'='application/octet-stream'};" ^
 "$listener=New-Object System.Net.HttpListener;" ^
 "$listener.Prefixes.Add('http://localhost:'+$port+'/');" ^
 "$listener.Start();" ^
 "Write-Host 'Server started' -ForegroundColor Green;" ^
 "while($listener.IsListening){" ^
 "  $ctx=$listener.GetContext();" ^
 "  $url=$ctx.Request.Url.LocalPath;" ^
 "  if($url -eq '/'){$url='/index.html'}" ^
 "  $fp=Join-Path $root ($url.TrimStart('/') -replace '/','\\');" ^
 "  $res=$ctx.Response;" ^
 "  if(Test-Path $fp -PathType Leaf){" ^
 "    $ext=[IO.Path]::GetExtension($fp).ToLower();" ^
 "    $res.ContentType=if($mime[$ext]){$mime[$ext]}else{'application/octet-stream'};" ^
 "    $bytes=[IO.File]::ReadAllBytes($fp);" ^
 "    $res.ContentLength64=$bytes.Length;" ^
 "    $res.OutputStream.Write($bytes,0,$bytes.Length)" ^
 "  }else{" ^
 "    $res.StatusCode=404;" ^
 "    $b=[Text.Encoding]::UTF8.GetBytes('404');" ^
 "    $res.OutputStream.Write($b,0,$b.Length)" ^
 "  }" ^
 "  $res.OutputStream.Close()" ^
 "}"

echo.
echo   Server stopped.
pause
goto :done

:start_python
echo   Using %PY%
echo   URL: http://localhost:%PORT%
echo   Press Ctrl+C to stop.
echo.

start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORT%"
%PY% tools/server.py %PORT%

echo.
echo   Server stopped.
pause

:done
endlocal
