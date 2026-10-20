# Multilingual Guide

Ứng dụng thuyết minh du lịch đa ngôn ngữ: Expo SDK 57, React Native, TypeScript, Expo Router và FastAPI/PostgreSQL.

Báo cáo mới nhất: [COMPLETION_REPORT.md](../COMPLETION_REPORT.md). Chi tiết Auth cũ: [AUTH_HANDOFF.md](AUTH_HANDOFF.md); kiến trúc Admin: [ADMIN_DASHBOARD.md](../ADMIN_DASHBOARD.md).

## Chạy backend

```powershell
cd C:\CongNghePhanMem\backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Nếu chưa có virtualenv, tạo bằng `python -m venv .venv`. Giữ nguyên file `.env` đang có; chỉ sao chép `.env.example` khi chưa có cấu hình. Khóa JWT và thông tin database chỉ nằm ở backend.

Database mới cần `python -m alembic upgrade head`. Với database cũ, xem báo cáo trước khi chạy migration; không reset/seed database đang dùng.

## Chạy ứng dụng

```powershell
cd C:\CongNghePhanMem\multilingual-ide
npm.cmd install
npm.cmd run web
```

Trong `.env`, đặt `EXPO_PUBLIC_API_URL` phù hợp với thiết bị:

- Web cùng máy: `http://127.0.0.1:8000`.
- Android emulator: `http://10.0.2.2:8000`.
- Điện thoại thật: `http://<IP-LAN-máy-tính>:8000`.

Đổi URL cần restart Expo với `npx.cmd expo start --clear`. Xuất Web sau khi đổi env nên dùng `npm.cmd run build:web -- --clear` để tránh giữ URL trong cache Metro.

Android/iPhone dùng `npm.cmd start` với thiết bị hoặc development build tương thích SDK 57. Khi thay config native/ImagePicker/Maps keys phải tạo lại development bguuild.

## Sử dụng

- `/register`, `/login`: tạo tài khoản và đăng nhập. User vào Home; Admin vào `/admin`. Admin được backend cấp role hoặc cấu hình `ADMIN_USER_IDS`.
- `/admin`: quản lý POI, ảnh, người dùng, thuyết minh, hành trình, thống kê, hoạt động và cấu hình.
- Tải ảnh: tạo POI trước, mở Sửa, chọn ảnh và lưu ngay. Ảnh JPEG/PNG/WebP tối đa 5 MB và 16 megapixel. Có xem trước/gỡ ảnh; tệp nằm trong `backend/uploads` hoặc `UPLOAD_DIR`.
- `/map`: tìm GPS, chọn điểm trên bản đồ và mở chỉ đường. Thuyết minh tự động chỉ hoạt động khi bật và màn hình bản đồ đang mở; không theo dõi nền.
- `/saved`: khách lưu trên thiết bị; tài khoản đồng bộ với backend. Hai danh sách độc lập.
- `/history`, `/account`: lịch sử tài khoản và chỉnh sửa hồ sơ. Chi tiết POI có nội dung theo ngôn ngữ, phát giọng thiết bị và viết/sửa/xóa đánh giá của mình.
- TTS dùng giọng thiết bị/trình duyệt, không cần khóa cloud. Bản đồ Web dùng Google Embed nếu có key, nếu chưa có thì dùng OpenStreetMap. Dịch tự động cần cấu hình LibreTranslate ở backend.

## Kiểm tra

```powershell
cd C:\CongNghePhanMem\backend
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
```

```powershell
cd C:\CongNghePhanMem\multilingual-guide
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build:web -- --clear
npm.cmd run build:android
npm.cmd run build:ios
```

E2E cần Chrome đã cài, dùng cổng 8765/8099 và backend virtualenv. Runner tạo database SQLite riêng trong thư mục tạm; không dùng database ứng dụng. `E2E_PYTHON` có thể trỏ đến Python khác đã cài requirements. Ảnh kiểm thử nằm trong `test-results/`.

Các lệnh `build:android` và `build:ios` xuất JavaScript/Hermes bundle; chưa tạo APK/IPA và không thay thế việc kiểm thử thiết bị thật.
