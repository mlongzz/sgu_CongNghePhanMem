# Hướng dẫn kiểm thử

Kết quả ngày 02/11 và giới hạn thực tế nằm trong [báo cáo hiện tại](REVIEW_2026-11-02.md). Các lệnh dưới đây phải chạy lại trên phiên bản cần bàn giao.

## Môi trường và cô lập

Dùng Python 3.13 với `backend/requirements-dev.txt`, Node ≥22.13.1 với `npm ci`, Chrome và PostgreSQL local riêng. Không seed hoặc chạy migration trên dữ liệu ứng dụng để thử nghiệm. Xem [README](../README.md) để cài đặt.

Backend mặc định mỗi test dùng SQLite trong bộ nhớ. Biến `DATABASE_URL` vẫn cần trỏ đến database thử khi import cấu hình. `TEST_POSTGRES=1` dùng schema riêng và transaction rollback. Hai test cạnh tranh thật chỉ chạy trên DB `mg_test_*`.

```powershell
cd backend
$env:APP_ENV='test'
$env:TEST_POSTGRES='0'
$env:DATABASE_URL='sqlite:///./unit-test.db'
$env:SECRET_KEY='isolated-test-signing-key-never-use-in-production'
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
```

PostgreSQL đầy đủ, gồm cạnh tranh tạo email/refresh:

```powershell
# Chỉ dùng tài khoản local dành cho kiểm thử, có quyền CREATEDB.
$env:TEST_DATABASE_ADMIN_URL='postgresql://<test-user>:<test-password>@127.0.0.1:5432/postgres'
.\.venv\Scripts\python.exe -m scripts.verify_postgres
.\.venv\Scripts\python.exe -m scripts.verify_postgres --e2e
```

Wrapper không in URL/mật khẩu, tạo database có UUID riêng rồi thu hồi kết nối/xóa đúng DB đó trong finally. Nếu tài khoản ứng dụng thiếu CREATEDB, dùng tài khoản/cluster thử khác; không tăng quyền tài khoản ứng dụng. Trong phiên nghiệm thu đã dùng PostgreSQL 18.6 tạm trên `127.0.0.1:55439` dưới `.verification`, không dùng bảng ứng dụng.

## Frontend và trình duyệt

```powershell
cd multilingual-guide
npm.cmd run typecheck
npm.cmd run lint -- --no-cache
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build:web
npm.cmd run build:android
npm.cmd run build:ios
```

`test:e2e` export Web mới, chạy API đã migrate với SQLite tạm và static SPA server, rồi tắt các tiến trình nó tạo. `verify_postgres --e2e` thay SQLite bằng DB PostgreSQL riêng. Không chạy hai E2E runner đồng thời; cổng 8765/8099 phải trống. Cài Chrome trước hoặc `npx playwright install --with-deps chrome` trong CI Linux. Các provider ảnh/tile/OSM/Wikipedia và GPS/TTS dùng fixture trong E2E; CRUD/Auth là API thật.

Ca hồi quy chính ở `tests/e2e/acceptance.spec.ts`: URL/reload, không gọi nguồn cộng đồng trong hành trình, ID sai/404/rỗng, GPS bị từ chối và nghe thủ công, hoàn thành/hủy, thu hồi refresh khi logout, API Admin, draft → hành trình → published, upload timeout/hủy/retry. Các suite `narration`, `place-image`, `gps-*`, `application` bao phủ điều phối, ngôn ngữ và tương tác còn lại.

Logic thuần ở `tests/*.test.cjs` kiểm tra dữ liệu/điều kiện chọn điểm/timer/hủy; không chứng minh GPS hoặc loa thật. Backend integration kiểm tra JWT/RBAC, dữ liệu, API, migration, rollback, truy vấn và unique index trên cả SQLite/PostgreSQL. Hai bài kiểm tra PostgreSQL đồng thời dùng hai connection/transaction thật.

## Build từ bộ mã bàn giao

```powershell
# Tại root; thư mục đích chưa được tồn tại.
python scripts/prepare_handoff.py .verification/handoff-source
cd .verification/handoff-source/multilingual-guide
$env:EXPO_NO_DOTENV='1'
$env:EXPO_PUBLIC_API_URL='http://127.0.0.1:8000'
npm.cmd ci --no-audit --no-fund
npm.cmd run typecheck
npm.cmd run lint -- --no-cache
npm.cmd test
npm.cmd run build:web
```

Tạo virtualenv mới trong backend của bản sao, cài `requirements-dev.txt`, chạy lại pytest với biến môi trường thử. Manifest liệt kê SHA-256 của toàn bộ tệp nguồn được chép, bao gồm tệp mới. Không chép dependency, cache, `.env`, upload hoặc artifact cũ. Chi tiết lần chạy thực tế ở [báo cáo nghiệm thu](REPAIR_ACCEPTANCE_REPORT.md).

## Checklist thiết bị thật — chưa được thay thế bằng mock

- [ ] Android/iPhone: cài build tương thích, cấu hình API LAN và key Maps nếu cần; login/restore/logout bằng tài khoản thử.
- [ ] Mở URL/deep link hành trình, thấy đúng điểm/tiến độ khi quay lại; từ chối quyền vẫn nghe thủ công.
- [ ] GPS ngoài trời: cấp/từ chối/cấp lại quyền, tắt dịch vụ vị trí, di chuyển qua biên 80 m; không phát lặp khi dao động/ra xa/quay lại.
- [ ] Nghe loa/tai nghe thật tiếng vi/en/fr/ja, thử máy thiếu voice, đổi ngôn ngữ/tốc độ, lỗi giữa bài; không nghe chồng, không tính hoàn thành bài hủy.
- [ ] Rời màn hình, về nền, khóa máy: dừng GPS/âm thanh đúng; khi trở lại không tự bật.
- [ ] Mạng chậm/mất mạng: upload gần 5 MB, hủy/thử lại, giữ nguồn/tác giả/giấy phép; retry ảnh bằng Tab/Enter không mở chi tiết.
- [ ] Kiểm tra kích thước 320/390/768/1440, bàn phím, đọc màn hình; map tiles live và chỉ đường mở ứng dụng ngoài đúng vị trí.

## CI, artifact và giới hạn

[Workflow ở root kho GitHub](https://github.com/mlongzz/sgu_CongNghePhanMem/blob/main/.github/workflows/ci.yml) chạy SQLite/PostgreSQL, frontend, E2E, build Docker rồi mới cho publish tag. Log/ảnh/trace lỗi là CI artifacts 7 ngày, không commit. Không đặt credential production vào fixture. Docker local cần daemon; không coi có CLI là đã build được. Run `41191217605` của commit `ceb59a1` đã đạt; kết quả commit mới nằm trong PR và không thay thế kiểm tra thiết bị thật. Xem [bản demo ngày 01/11](DEMO_RELEASE_2026-11-01.md).
