@echo off
chcp 65001 >nul
REM Khởi động backend FastAPI + frontend Expo Web trong 2 cửa sổ riêng.
REM Mở trên máy tính:  http://localhost:8081
REM Mở trên điện thoại (cùng Wi-Fi): http://<IP-máy-tính>:8081  (IP hiện ở dòng "Wi-Fi" bên dưới)

cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo [!] Chua co backend\.venv. Xem README.md muc "Cai va chay backend".
  pause
  exit /b 1
)
if not exist "multilingual-guide\node_modules" (
  echo [i] Cai dependency frontend lan dau...
  pushd multilingual-guide
  call npm.cmd ci
  popd
)

start "Backend - FastAPI :8000" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m alembic upgrade head && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
start "Frontend - Expo Web :8081" cmd /k "cd /d %~dp0multilingual-guide && npm.cmd run web -- --port 8081"

echo.
echo Dang khoi dong... doi khoang 20-40 giay roi mo:
echo   May tinh : http://localhost:8081
echo   Dien thoai (cung Wi-Fi), thu lan luot cac dia chi:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo     http://%%b:8081
echo.
echo Dong 2 cua so Backend/Frontend de dung ung dung.
timeout /t 25 >nul
start "" http://localhost:8081
