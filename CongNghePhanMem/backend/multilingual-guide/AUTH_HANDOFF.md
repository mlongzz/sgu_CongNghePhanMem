# Bàn giao phần Authentication

> Báo cáo cập nhật: [COMPLETION_REPORT.md](../COMPLETION_REPORT.md), gồm kiểm thử Chrome và môi trường backend thống nhất.

Đã tiếp tục từ bộ component auth và API có sẵn. Backend giữ nguyên hợp đồng và logic phân quyền.

## Mã nguồn

- `app/login.tsx`, `app/register.tsx`: hai route dùng chung `src/components/auth/AuthScreen.tsx`.
- `src/components/auth/AuthLayout.tsx`: bố cục gradient du lịch hai cột trên desktop; một cột cuộn trên mobile; cập nhật khi đổi chiều rộng, hỗ trợ bàn phím và Safe Area.
- Tái sử dụng `AuthTextField`, `PrimaryButton`, `LanguageSelector`, `PasswordStrength`: lỗi dưới input, hiện/ẩn mật khẩu, autofill, Enter, trạng thái gửi, bốn ngôn ngữ.
- `src/services/authValidation.ts`: kiểm tra dữ liệu theo giới hạn backend (mật khẩu 8–128 ký tự, tên tối đa 100 ký tự).
- `src/services/api.ts`: lỗi HTTP có status, thông báo tiếng Việt, xử lý mất mạng/timeout, thử lại request một lần sau refresh.
- `src/context/AppContext.tsx`: khôi phục và kiểm tra phiên, tải hồ sơ/quyền, refresh có điều phối request đồng thời, đăng xuất xóa cả hai token.
- `app/admin.tsx`: chờ kiểm tra phiên; chuyển khách sang Login và người dùng thường về Home. Backend vẫn kiểm soát từng API Admin.
- `app/(tabs)/profile.tsx`: hiển thị tên/email; đăng xuất trở về Login.
- `app/place/[id].tsx`, `app/journeys.tsx`: quay lại an toàn khi mở URL trực tiếp.
- `tests/auth.test.cjs`: kiểm tra validation, schema đăng ký, lỗi đăng nhập/trùng email, retry token, mất mạng và timeout.

## API và lưu phiên

- `POST /users`: gửi `full_name`, `email`, `password`, `language`; thành công chuyển về Login kèm thông báo và email. Không tự cấp quyền Admin.
- `POST /auth/login`, `POST /auth/refresh`: nhận access/refresh token.
- `GET /users/me`, `GET /admin/me`: xác minh hồ sơ và quyền trước khi mở ứng dụng/Admin.
- Native dùng SecureStore; Web dùng sessionStorage, giữ phiên khi refresh cùng tab và xóa khi đóng tab. Không lưu mật khẩu.
- Token hết hạn được refresh. Refresh không hợp lệ sẽ xóa phiên. Khi mất mạng lúc mở ứng dụng, giao diện trở về trạng thái chưa đăng nhập và giữ token đã lưu để có thể khôi phục ở lần tải sau.
- Chưa thêm quên mật khẩu vì backend chưa có luồng đặt lại mật khẩu đầy đủ. Chưa thêm ghi nhớ đăng nhập dài hạn hoặc dark mode vì giao diện hiện dùng bảng màu sáng tĩnh.

## Kết quả tự động

- `npm.cmd run typecheck`: đạt.
- `npm.cmd run lint`: đạt, không warning/error.
- `npm.cmd run build:web`: đạt, xuất đủ 15 route gồm Login/Register/Admin.
- `node --test tests/auth.test.cjs`: 6/6 đạt. API frontend dùng mock, chưa phải test E2E trình duyệt.
- Backend: 31/31 đạt trên database SQLite test cô lập. Có một cảnh báo thư viện TestClient/httpx cũ. Chưa chạy bộ test với PostgreSQL thật.
- Python hệ thống có pytest nhưng thiếu Alembic; Python `.venv` có Alembic nhưng thiếu pytest. Đã chạy đầy đủ bằng lệnh sau, không cài thêm dependency:

```powershell
cd C:\CongNghePhanMem\backend
python -c "import sys; sys.path.append(r'C:\CongNghePhanMem\backend\.venv\Lib\site-packages'); import pytest; raise SystemExit(pytest.main(['-q', '-p', 'no:cacheprovider']))"
```

## Chạy và kiểm thử thủ công

1. Chạy backend với cấu hình database hiện tại, theo `backend/DEPLOYMENT.md`. Nếu dùng `.venv`: `cd backend`, rồi `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000`.
2. Trong `multilingual-guide/.env`, cấu hình `EXPO_PUBLIC_API_URL` đến backend. Điện thoại dùng IP LAN của máy tính; kiểm tra CORS backend cho origin Web. Khởi động lại Expo sau khi đổi env.
3. Chạy `cd multilingual-guide`, `npm.cmd run web`; mobile dùng `npm.cmd start` rồi mở bằng thiết bị/dev build tương thích SDK dự án.
4. Mở `/register`. Thử để trống, email sai, mật khẩu ngắn/dài, xác nhận khác; rồi tạo tài khoản thử bằng thông tin tự nhập. Chọn lần lượt vi/en/fr/ja và xác nhận backend lưu đúng ngôn ngữ.
5. Thử đăng ký lại email đã dùng, đăng nhập sai mật khẩu; kiểm tra dữ liệu không bị xóa. Đăng nhập đúng: user về Home, Admin vào Admin. Tài khoản Admin phải được backend cấu hình sẵn.
6. Nhập trực tiếp `/admin` với khách, user thường và Admin. Refresh Web cùng tab để kiểm tra khôi phục. Đăng xuất rồi refresh: không khôi phục phiên cũ.
7. Thử access token hết hạn, refresh token không hợp lệ, tắt backend/mất mạng. Kiểm tra thông báo dễ hiểu và request không lặp vô hạn.
8. Mở trực tiếp Login, hành trình, chi tiết địa điểm rồi bấm quay lại: không có lỗi GO_BACK.
9. Kiểm tra Chrome ở chiều rộng 320/390/768/1440, xoay màn hình, phóng to chữ, Tab/Enter, password manager; kiểm tra iPhone/Android khi mở bàn phím, cuộn và chạm nút.

Chưa có ảnh chụp trước/sau hoặc kiểm thử tương tác trình duyệt/thiết bị thật trong môi trường này. Cần thực hiện checklist thủ công trước khi coi toàn bộ trải nghiệm đa nền tảng đã được xác nhận. Chưa push, merge hay deploy.
