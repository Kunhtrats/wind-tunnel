@echo off
setlocal
cd /d "%~dp0"
where em++ >nul 2>nul
if errorlevel 1 (
  echo Activate Emscripten first: call path\to\emsdk\emsdk_env.bat
  exit /b 1
)
call em++ solver.cpp -std=c++17 -O3 -flto -fexceptions -lembind -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 -sEXPORT_EXCEPTION_HANDLING_HELPERS=1 -o engine.mjs
exit /b %errorlevel%