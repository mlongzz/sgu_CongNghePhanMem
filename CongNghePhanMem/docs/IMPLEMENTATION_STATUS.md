# Trạng thái triển khai

Cập nhật 01/11/2026. Dữ liệu, kiểm thử và giới hạn mới nằm trong [báo cáo demo](DEMO_RELEASE_2026-11-01.md). [Báo cáo nghiệm thu](REPAIR_ACCEPTANCE_REPORT.md) và các số test ngày 29/10 là lịch sử.

## Đã triển khai

- Giữ nguyên bộ auth hoàn chỉnh; khôi phục phiên, điều hướng user/Admin, backend JWT/RBAC.
- Email chuẩn hóa nhất quán, tìm được tài khoản mixed-case cũ, unique index DB và preflight migration không tự sửa tài khoản.
- Refresh token có phiên DB, xoay vòng nguyên tử, logout thu hồi họ token; giới hạn đăng nhập account/IP dùng DB chia sẻ giữa workers, hash giả cho tài khoản không tồn tại.
- Admin chọn điểm nháp có nhãn; từ chối điểm lưu trữ/không tồn tại. API public lọc draft/deleted; trả stops đúng thứ tự và query list có số lượng cố định.
- Bản đồ `/map?journey=id`, hủy request, trạng thái sai ID/404/rỗng, marker đánh số/lựa chọn, không trộn nguồn cộng đồng.
- AutoGuide opt-in theo tuyến linh hoạt; ưu tiên thứ tự khi nhiều điểm gần. Tiến độ chỉ hoàn thành khi TTS kết thúc; hủy/lỗi có trạng thái riêng.
- Upload timeout 90 giây, request thường 12 giây; có hủy/thử lại. Giữ sửa lỗi ảnh và DOM button từ bản cũ.
- Workflow CI ở root, PostgreSQL và E2E, build/publish phụ thuộc kiểm tra; README/PRD/hướng dẫn và công cụ đóng bộ mã sạch.

## Đã có bằng chứng tự động

Typecheck và logic frontend; backend API/regression; E2E Chrome với backend thật và DB PostgreSQL tạm, GPS/TTS/provider giả lập. Kết quả đầy đủ, lần chạy lại sau sửa và build cô lập được ghi ở báo cáo nghiệm thu, không suy từ số test lịch sử.

## Chưa kiểm chứng hoặc cần cấu hình riêng

- Loa/TTS/GPS Android/iPhone thật, APK/IPA ký và cài đặt trên thiết bị.
- CI commit `ceb59a1` đã đạt backend/frontend/E2E/Docker; commit mới cần lần chạy riêng. Docker build/start local khi daemon chưa chạy vẫn chưa được xác nhận.
- R2, LibreTranslate, MapTiler/native keys và provider live với credential demo thực.
- Dữ liệu local có 10 ảnh đã đối chiếu giấy phép, 10 cặp bài Việt–Anh công khai. Tám cặp bài cũ vẫn thiếu đối chiếu nguồn đầy đủ; ảnh của các địa điểm khác chưa hoàn thiện.
- Workspace đang chạy không có `.git`; đồng bộ có kiểm soát qua clone riêng và PR #3. Trạng thái commit/CI/main cuối cùng nằm trong PR. Chưa tag/publish/deploy production.
- Microservices/queue/media audio server theo tài liệu hướng dẫn giả định chưa triển khai. Nếu đó là tiêu chí bắt buộc của giảng viên, cần phạm vi riêng; bản FastAPI hiện tại chưa được tính là đáp ứng.

## Giới hạn thiết kế còn lại

Access JWT đã cấp còn dùng được đến hết hạn; logout ngăn refresh mới. Offline logout xóa phiên thiết bị và thông báo nếu không thu hồi được trên server. Tiến độ hành trình lưu trên thiết bị, giữ khi đổi ngôn ngữ/ra xa, đặt lại khi chọn mới/kết thúc/logout. Không theo dõi GPS nền; polyline chỉ minh họa; chỉ đường mở Google Maps ngoài.
