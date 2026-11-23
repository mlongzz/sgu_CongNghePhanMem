# Dấu Chân · Vietnam Audio Guide

Ứng dụng React Native/Expo đa ngôn ngữ kết nối tới FastAPI. Hỗ trợ khám phá địa điểm, GPS, nội dung thuyết minh, giọng đọc của thiết bị, đánh giá, yêu thích, lịch sử và màn hình quản trị.

## Chạy ứng dụng web

```powershell
cd C:\CongNghePhanMem\multilingual-guide
npm install
Copy-Item .env.example .env
npm run web
```

Đặt `EXPO_PUBLIC_API_URL` trong `.env` trỏ đến backend:

- Web trên cùng máy: `http://127.0.0.1:8000`
- Android emulator: `http://10.0.2.2:8000`
- Điện thoại thật: `http://<IPv4-của-máy-tính>:8000`

## Backend

Backend nằm trong `E:\CongNghePhanMem\CongNghePhanMem\backend` của workspace hiện tại. Tạo `backend/.env` từ `.env.example`, cấu hình database và khóa JWT, sau đó chạy:

```powershell
cd E:\CongNghePhanMem\CongNghePhanMem\backend
uvicorn app.main:app --reload --host 0.0.0.0
```

API docs ở `http://127.0.0.1:8000/docs`. Để tạo dữ liệu trình diễn (3 địa điểm, thuyết minh tiếng Việt/Anh/Trung), chạy một lần:

```powershell
python scripts/seed_demo.py
```

Để bật quyền quản trị, thêm ID tài khoản vào `ADMIN_USER_IDS` trong `backend/.env`, khởi động lại backend và đăng nhập lại trong app. Trang hồ sơ sẽ hiện đường dẫn Bàn quản trị.

## Kiểm tra

```powershell
npx tsc --noEmit
npx expo lint
```

GPS cần quyền vị trí khi ứng dụng đang mở. Tự phát thuyết minh dò điểm gần ở foreground; Google Maps được mở cho chỉ đường. Giọng TTS dùng voice đã cài trên thiết bị và chất lượng/ngôn ngữ tùy hệ điều hành.
