@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   업비트 스캐너 대시보드
echo   http://localhost:8787 (자동으로 열립니다)
echo   이 창을 닫으면 대시보드도 꺼집니다.
echo ============================================
echo.
REM 서버가 뜬 뒤(2초 후) 브라우저 자동 오픈
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
node server\server.mjs
pause
