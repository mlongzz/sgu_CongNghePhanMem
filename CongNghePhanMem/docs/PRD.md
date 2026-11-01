# Yêu cầu sản phẩm và nghiệm thu

## Nguồn và mức xác nhận

Nguồn chính là yêu cầu sửa/bàn giao người dùng gửi ngày 29/10/2026 và báo cáo `Bao_cao_cham_va_sua_loi_do_an.docx` ngày 28/10/2026, kèm `sua-loi-do-an.patch`. Báo cáo mô tả commit main `439ab7f`; không coi số test/điểm trong đó là bằng chứng của workspace hiện tại.

Các tài liệu có sẵn `DISCOVERY_UPGRADE.md`, `HCMC_DEMO_GUIDE.md`, `AUTH_HANDOFF.md` mô tả triển khai hoặc kiểm thử lịch sử. Tài liệu `Huong_dan_do_an_Thuyet_minh_da_ngon_ngu_BE_Microservices.docx` ở ổ E tự ghi là hướng dẫn dựa trên giả định; chưa phải đặc tả nghiệp vụ do giảng viên xác nhận. Bản hiện tại giữ FastAPI theo module; chưa đáp ứng kiến trúc nhiều microservice/queue nếu môn học thực sự bắt buộc phần này. Không hạ yêu cầu microservices thành “đã đạt”.

## Mục tiêu, actor và phạm vi

Khách/người dùng xem hành trình và địa điểm, chọn ngôn ngữ, nghe hướng dẫn theo vị trí hoặc thủ công. Người dùng có tài khoản quản lý hồ sơ, yêu thích, lịch sử và đánh giá của mình. Admin quản lý người dùng/quyền, địa điểm, nội dung, ảnh, hành trình, nguồn nhập và nhật ký. Máy chủ phải thực thi quyền, bất kể màn hình đang hiển thị.

Phạm vi xác nhận gồm Web, Android/iOS, nội dung vi/en/fr/ja, GPS foreground, giọng thiết bị, quy trình nháp/xuất bản, CI và bộ mã có thể cài/build độc lập. Chỉ đường trong ứng dụng dùng đường nối minh họa; tuyến giao thông thực tế được yêu cầu qua ứng dụng bản đồ ngoài.

## Luồng chính

Đăng ký → đăng nhập → khôi phục phiên → chọn hành trình → xem điểm dừng → mở URL bản đồ có ID → bật GPS/AutoGuide → đến gần điểm → phát đúng ngôn ngữ → ghi hoàn thành sau onDone → tiếp tục/kết thúc/thoát → đăng xuất. Từ chối GPS vẫn có danh sách, bản đồ và nút nghe thủ công.

## Yêu cầu và tiêu chí

| ID | Yêu cầu đã xác nhận | Tiêu chí nghiệm thu |
| --- | --- | --- |
| R01 | Cài/build được từ bộ bàn giao | Không dựa `.env` cá nhân/cache/node_modules cũ; đủ auth/export/CSS/Leaflet; typecheck, lint, test, build đạt |
| R02 | Phiên và vai trò | Đăng ký/login/restore/logout; backend từ chối khách/user thường vào Admin; không gửi lặp |
| R03 | Email | Chuẩn hóa trim/lower mọi đường ghi; tài khoản cũ vẫn login; DB chặn hai request email tương đương; migration dừng khi dữ liệu cũ trùng |
| R04 | Nháp và xuất bản | Admin chọn được draft có nhãn, không chọn archived; API công khai không lộ draft/deleted trong stops/place_ids/ảnh |
| R05 | Hành trình bền theo URL | `/map?journey=id` tải lại đúng ngữ cảnh; mã sai/404/rỗng có trạng thái rõ; đổi màn hình/ID hủy request cũ |
| R06 | Bản đồ hành trình | Marker đánh số, lựa chọn, tiến độ; không trộn nguồn khám phá ngoài tuyến; đường nối được mô tả đúng |
| R07 | Phát theo vị trí | Opt-in; GPS mới ≤60 giây, sai số ≤50 m, khoảng cách + sai số ≤80 m; ưu tiên thứ tự Admin khi nhiều điểm cùng gần |
| R08 | Điều phối và tiến độ | Không chồng âm thanh; onDone mới hoàn thành; lỗi/hủy khác hoàn thành; không đọc lặp vì dao động GPS; có quy tắc lưu/reset rõ |
| R09 | Thao tác khi không có GPS | Xem/listen thủ công vẫn hoạt động; có lỗi quyền/timeout và retry/hủy |
| R10 | Hiệu năng/lỗi | Một API trả stops; số query list không tăng theo số hành trình; bỏ stop không hợp lệ mà giữ stop còn lại; không đổi lỗi mạng/quyền thành danh sách rỗng |
| R11 | Ảnh | Upload 90 giây riêng; request thường mặc định 12 giây; thành công/sai định dạng/quá cỡ/timeout/hủy/retry; ghi công và giấy phép đúng |
| R12 | DOM và truy cập | Không button lồng button; retry ảnh không mở chi tiết; bàn phím vẫn sử dụng được |
| R13 | Bảo vệ đăng nhập | Hạn chế thử theo account/IP, cùng lỗi và có hash giả khi account không tồn tại; refresh xoay vòng, logout thu hồi; nêu giới hạn access token |
| R14 | CI/CD và tài liệu | Workflow ở root, kiểm tra backend/frontend/DB/E2E; publish cần tất cả checks; tài liệu liên kết hợp lệ và lệnh dùng được |

## Chính sách tạm thời theo yêu cầu bàn giao

Chưa có yêu cầu bắt buộc đi tuần tự trong tài liệu nghiệp vụ xác nhận. Giữ chế độ linh hoạt của patch: ưu tiên điểm đứng trước trong các điểm cùng gần, không buộc nghe xong điểm 1 trước điểm 2. “Điểm đang đến” là điểm chưa xử lý đầu tiên dùng để gợi ý.

Hành trình chưa có điểm công khai vẫn được xem ở trạng thái rỗng, không có nút AutoGuide/nghe. Thứ tự công khai là thứ tự Admin sau khi loại điểm chưa khả dụng.

Tiến độ đã nghe giữ khi ra xa hoặc đổi ngôn ngữ. Đổi ngôn ngữ dừng bài đang phát; bài bị hủy chưa hoàn thành. Chọn hành trình mới đặt lại; tải lại giữ tiến độ nhưng tạm dừng, kiểm tra lại điểm công khai từ API. Kết thúc/xuất tài khoản xóa tiến độ đang lưu. Tiến độ này lưu trên thiết bị, chưa đồng bộ giữa nhiều thiết bị.

Giới hạn đăng nhập là 12 lượt/account và 120 lượt/IP trong cửa sổ 5 phút, gồm cả lần thành công; cấu hình được ở backend. Không dựa header IP do client tự gửi. Đăng ký trả 409 cho email trùng theo yêu cầu thông báo rõ; không tuyên bố đã ngăn mọi phương pháp dò tài khoản.

## Các điều kiện ngoài bằng chứng tự động

GPS và tiếng phát ra loa trên Android/iPhone phải thử thiết bị thật. Mock GPS/TTS chỉ kiểm tra quyết định, nội dung gọi và cleanup. Giọng, mạng demo, map key native, R2/LibreTranslate live và vận hành nhiều instance cần cấu hình/kiểm chứng riêng. Workflow viết đúng cấu hình không đồng nghĩa đã chạy xanh trên GitHub.
