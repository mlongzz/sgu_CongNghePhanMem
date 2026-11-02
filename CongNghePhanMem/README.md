# Dấu Chân · Multilingual Guide

Ứng dụng hướng dẫn du lịch Việt/Anh/Pháp/Nhật: chọn hành trình, xem các điểm dừng trên bản đồ, nghe thủ công hoặc tự phát theo GPS. Frontend dùng Expo SDK 58/React Native/TypeScript; backend dùng FastAPI/SQLAlchemy/Alembic và PostgreSQL.

```text
backend/                     API, migration, kiểm thử và công cụ quản trị
multilingual-guide/           Expo Web, Android, iOS và Playwright
docs/                        Yêu cầu, hướng dẫn kiểm thử, báo cáo nghiệm thu
scripts/prepare_handoff.py    Tạo bộ mã bàn giao sạch kèm manifest SHA-256
.github/workflows/ci.yml      Kiểm tra backend/frontend/E2E, build Docker, publish khi gắn tag
```

Các lệnh dưới đây bắt đầu từ thư mục chứa README này. PowerShell dùng `npm.cmd`; macOS/Linux dùng `npm`, `.venv/bin/python` thay cho `.venv/Scripts/python.exe`.

## Cài và chạy backend

Cần Python 3.13, Node từ 22.13.1 và PostgreSQL. Tạo một database phát triển riêng, rồi cấu hình bằng mẫu; giữ nguyên `.env` đã có nếu đang tiếp tục dự án.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Sửa `DATABASE_URL`, `SECRET_KEY` (khóa ngẫu nhiên riêng, tối thiểu 32 ký tự), `ALLOWED_ORIGINS` trong `backend/.env`. Database mới chạy:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Database cũ: sao lưu và kiểm tra baseline trước; chạy `python -m scripts.check_email_duplicates` để phát hiện email trùng sau chuẩn hóa. Migration 0006 dừng nếu có trùng; cần xem lại các ID tài khoản, không tự xóa/gộp. Migration 0007 thêm trạng thái phiên và giới hạn đăng nhập. Refresh token cũ không có phiên lưu trong DB cần đăng nhập lại một lần. Xem [triển khai](backend/DEPLOYMENT.md).

API tương tác: `http://127.0.0.1:8000/docs`; readiness: `/health/ready`. Không chạy seed/import lên dữ liệu thật để thử ứng dụng.

## Cấp Admin

Đăng ký tài khoản, xem ID trong DB phát triển. Thêm ID tin cậy vào `ADMIN_USER_IDS` trong cấu hình backend, khởi động lại và đăng nhập lại. Backend chấp nhận `role=admin` hoặc ID trong `ADMIN_USER_IDS`; người đăng ký không tự cấp quyền qua payload. Bảng người dùng phân biệt vai trò CSDL, quyền Admin thực tế và nguồn cấp quyền. Tài khoản trong `ADMIN_USER_IDS` không thể bị đổi vai trò/xóa qua API; cần quản lý cấu hình máy chủ.

## Chạy frontend

Mở terminal khác từ thư mục gốc:

```powershell
cd multilingual-guide
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run web
```

Đặt `EXPO_PUBLIC_API_URL` theo nền tảng và khởi động lại Expo sau khi đổi:

| Nền tảng | API URL | Cách chạy |
| --- | --- | --- |
| Web cùng máy | `http://127.0.0.1:8000` | `npm.cmd run web` |
| Android emulator | `http://10.0.2.2:8000` | `npm.cmd run android` |
| Android/iPhone thật | `http://<IPv4-LAN-máy-tính>:8000` | `npm.cmd run check:device`, rồi `npm.cmd run dev:device` |

Điện thoại và máy chủ cần cùng mạng; kiểm tra quyền tường lửa và bản Expo Go/development build tương thích SDK 58. Cấu hình Maps native/key ở `app.config.js`; khi đổi plugin hoặc key native cần build lại. GPS Web cần localhost/HTTPS và quyền vị trí. `build:android`/`build:ios` xuất JS/Hermes bundle; chưa tạo APK/IPA.

## Luồng demo

1. Admin tạo địa điểm/thuyết minh, duyệt nguồn/giấy phép ảnh, sắp xếp hành trình. Admin chọn được cả điểm nháp, có nhãn rõ; API công khai chỉ trả điểm đã xuất bản, chưa lưu trữ.
2. Người dùng đăng ký → đăng nhập → Hành trình → chọn → Bắt đầu. URL bản đồ là `/map?journey=<id>`; mở trực tiếp/tải lại sẽ nạp lại đúng hành trình.
3. Bản đồ hiển thị số thứ tự và danh sách điểm trong tuyến. Đường nét đứt chỉ nối minh họa; nút chỉ đường mở Google Maps ngoài để tìm tuyến đi bộ thực tế.
4. Bật AutoGuide khi sẵn sàng. GPS phải mới không quá 60 giây, sai số ≤50 m, và khoảng cách cộng sai số ≤80 m. Khi nhiều điểm cùng gần, ưu tiên điểm đứng trước; vẫn cho nghe theo thứ tự linh hoạt.
5. Từ chối GPS vẫn xem và nghe từng điểm. Chỉ ghi hoàn thành khi TTS báo kết thúc; lỗi/hủy chưa được tính. Ra xa và đổi ngôn ngữ giữ tiến độ đã hoàn thành, không tự đọc lại; chọn hành trình mới đặt lại. Tải lại khôi phục ở trạng thái tạm dừng, GPS/âm thanh phải bật lại.
6. Kết thúc/thoát để về khám phá. Đăng xuất dừng âm thanh, xóa tiến độ phiên trên thiết bị và thu hồi họ refresh token hiện tại. Access token đã cấp vẫn có thể hoạt động đến hết hạn (mặc định tối đa 60 phút).

Thuyết minh dùng giọng có trên thiết bị. Nội dung chính thức ưu tiên bài đã duyệt đúng ngôn ngữ; thiếu giọng/nội dung có thông báo. Dịch tự động cần provider LibreTranslate được cấu hình riêng.

## Dữ liệu demo sau khi clone

Mười địa điểm có 40 bài Việt–Anh–Pháp–Nhật kèm nguồn và 10 ảnh Commons được cấp phép. Bộ dựng mới còn tạo một hành trình bốn điểm trung tâm; không tạo tài khoản hoặc lịch sử cá nhân. Xem [rà soát ngày 02/11](docs/REVIEW_2026-11-02.md) cùng [ghi công ảnh](docs/DEMO_IMAGE_CREDITS.md). Các script sửa dữ liệu phát triển chỉ nhận đúng baseline đã kiểm tra và yêu cầu backup đã khôi phục thử; không chạy chúng trên database khác để thử.

Để dựng mới, dùng **database PostgreSQL local trống riêng** có tên `mg_demo_*`, cấu hình `DATABASE_URL` cho terminal đó, rồi từ `backend` chạy:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.bootstrap_reviewed_demo
.\.venv\Scripts\python.exe -m scripts.bootstrap_reviewed_demo --apply
```

Bootstrap từ chối database có bất kỳ dữ liệu nghiệp vụ nào, không tạo tài khoản, đánh giá hay lịch sử. Tạo Admin theo hướng dẫn phía trên sau khi hoàn tất dựng dữ liệu và ảnh. Sau bootstrap, tạo thư mục `..\.verification` nếu chưa có, dùng `pg_dump` đã cài để sao lưu database demo mới, nhập mật khẩu qua terminal hoặc cơ chế đăng nhập PostgreSQL sẵn có:

```powershell
pg_dump --format=custom --host=127.0.0.1 --port=5432 --username=<tai-khoan-local> --file=../.verification/demo-before-images.dump mg_demo_giangvien
.\.venv\Scripts\python.exe -m scripts.verify_database_backup --backup ../.verification/demo-before-images.dump --isolated-cluster
.\.venv\Scripts\python.exe -m scripts.prepare_verified_demo_images --allow-demo-db
.\.venv\Scripts\python.exe -m scripts.prepare_verified_demo_images --allow-demo-db --apply --verified-backup ../.verification/demo-before-images.dump
```

Thay tên database và tài khoản bằng cấu hình local vừa tạo. Bộ 10 JPEG đã đi kèm mã nguồn, được kiểm SHA-256 trước khi chép vào `backend/uploads`; không cần tải ảnh từ mạng để dựng demo. Upload local cần giữ trên ổ đĩa/persistent volume. Dịch vụ production cần cấu hình kho ảnh bền vững riêng. Tùy chọn `--download` có thể bị Commons từ chối HTTP 403; không dùng kết quả tải lỗi để thay dữ liệu đã kiểm tra.

## Kiểm tra và bàn giao

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
.\.venv\Scripts\python.exe -m scripts.verify_postgres
.\.venv\Scripts\python.exe -m scripts.verify_postgres --e2e
cd ..\multilingual-guide
npm.cmd run typecheck
npm.cmd run lint -- --no-cache
npm.cmd test
npm.cmd run build:web
```

`verify_postgres` chỉ chấp nhận PostgreSQL local; cần tài khoản có quyền tạo database thử. Có thể cấu hình `TEST_DATABASE_ADMIN_URL` riêng. Runner tạo database `mg_test_<uuid>`, chạy migration/kiểm thử và xóa đúng database của lần chạy. Nếu không có PostgreSQL thử, `npm.cmd run test:e2e` dùng SQLite tạm. E2E cần Chrome và cổng 8765/8099 trống.

Từ root, tạo bản sao sạch bằng `python scripts/prepare_handoff.py .verification/handoff-source`. Script yêu cầu thư mục đích mới, không chép `.env`, dependency, cache, upload, gói `.tgz` hoặc kết quả test. Cài và build lại trong bản sao đó theo [hướng dẫn kiểm thử](docs/TESTING_GUIDE.md).

Nếu bản làm việc không có `.git`, không khởi tạo lịch sử để đẩy đè kho nhóm: đối chiếu với bản clone hoặc cây GitHub trước khi đồng bộ. Các output đã bị Git theo dõi cần được xem xét riêng; `.gitignore` không tự bỏ theo dõi chúng. Các báo cáo nghiệm thu ghi rõ phạm vi và giới hạn của từng lần kiểm tra.

- [PRD và tiêu chí nghiệm thu](docs/PRD.md)
- [Hướng dẫn kiểm thử và thiết bị thật](docs/TESTING_GUIDE.md)
- [Trạng thái triển khai](docs/IMPLEMENTATION_STATUS.md)
- [Rà soát dữ liệu và giới hạn ngày 31/10/2026](docs/REVIEW_2026-10-31.md)
- [Demo đã cập nhật ngày 01/11/2026](docs/DEMO_RELEASE_2026-11-01.md)
- [Báo cáo sửa chữa, bằng chứng và điểm tham khảo](docs/REPAIR_ACCEPTANCE_REPORT.md)

Workflow kiểm tra SQLite/PostgreSQL, frontend, E2E và Docker. [Lần chạy của commit `ceb59a1`](https://github.com/mlongzz/sgu_CongNghePhanMem/actions/runs/41191217605) đã đạt; commit mới phải có kết quả riêng trong PR. Chỉ tag `v*` sau khi tất cả job đạt mới publish image lên GHCR; chưa publish hoặc deploy production.
