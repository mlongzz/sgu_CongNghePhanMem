# Multilingual Guide · Frontend

Expo SDK 58, React Native, TypeScript và Expo Router cho Web/Android/iOS.

Tài liệu chính: [README gốc](../README.md), [PRD](../docs/PRD.md), [hướng dẫn kiểm thử](../docs/TESTING_GUIDE.md), [trạng thái](../docs/IMPLEMENTATION_STATUS.md), [báo cáo nghiệm thu](../docs/REPAIR_ACCEPTANCE_REPORT.md).

Từ thư mục gốc dự án:

```powershell
cd multilingual-guide
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run web
```

Cấu hình `EXPO_PUBLIC_API_URL` theo Web/Android emulator/IP LAN điện thoại; xem README gốc để chạy backend, migration và cấp Admin. Khởi động lại Expo khi đổi biến môi trường. Mobile cần Expo Go/development build tương thích SDK 58 và cấu hình Maps phù hợp.

```powershell
npm.cmd run typecheck
npm.cmd run lint -- --no-cache
npm.cmd test
npm.cmd run build:web
npm.cmd run test:e2e
npm.cmd run build:android
npm.cmd run build:ios
```

E2E dùng Chrome, backend riêng đã migrate và SQLite tạm, cần cổng 8765/8099 trống. Có thể chạy E2E bằng PostgreSQL cô lập qua `python -m scripts.verify_postgres --e2e` tại backend. `build:android`/`build:ios` chỉ xuất JS/Hermes bundle, chưa tạo APK/IPA.

Hành trình mở bằng `/map?journey=<id>`; tải lại giữ tiến độ nhưng tạm dừng GPS/thuyết minh. AutoGuide ưu tiên thứ tự trong các điểm cùng gần, cho phép nghe linh hoạt; điểm đã nghe xong không tự đọc lại. Đường nét đứt chỉ minh họa; chỉ đường mở bản đồ ngoài. Từ chối GPS vẫn xem và nghe thủ công.
