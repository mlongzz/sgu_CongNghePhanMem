# Kết quả hoàn thiện demo ngày 01/11/2026

Đây là kết quả kiểm tra hiện tại. Các báo cáo ngày 29–31/10 mô tả trạng thái lịch sử trước khi bổ sung dữ liệu.

## Dữ liệu đang dùng trên máy

CSDL phát triển được xác nhận là PostgreSQL local `127.0.0.1:5432`, database `multilingual_guide`, migration `0007`. Đã sao lưu mới và khôi phục đầy đủ vào cluster riêng trước khi sửa bài; sau sửa bài lại sao lưu và khôi phục thử trước khi sửa ảnh. Hai dump và báo cáo đối chiếu fingerprint nằm trong `.verification`, không đưa vào Git. Không thay tài khoản, đánh giá, lịch sử hoặc địa điểm ngoài phạm vi.

Đã thêm hai bài Việt–Anh cho Củ Chi, xuất bản bản nháp Việt Bến Thành sau đối chiếu, giữ nội dung Bến Thành và gắn nguồn trực tiếp. Nguồn: [Bảo tàng Lịch sử Quốc gia](https://baotanglichsu.vn/vi/Articles/2001/66910/djia-djao-cu-chi-djiem-hen-tim-ve-lich-su.html) và [Trung tâm Xúc tiến Du lịch TP.HCM](https://visithcmc.vn/vi/kham-pha-cho-ben-thanh-tphcm-tu-a-z-5-phut-doc/). Tám cặp bài còn lại được giữ nguyên; chúng là các đoạn giới thiệu ngắn và chưa được đối chiếu nguồn đầy đủ. Không coi trạng thái công khai là bằng chứng chất lượng hoặc tính chính xác của mọi chi tiết.

| Địa điểm | Ảnh gốc + thu nhỏ | Nguồn/giấy phép ảnh | Bài Việt | Bài Anh |
| --- | --- | --- | --- | --- |
| Địa đạo Củ Chi | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Chợ Bình Tây | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Chùa Giác Lâm | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Chùa Giác Viên | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Công viên Văn hóa Đầm Sen | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Hội quán Nghĩa An | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Dinh Độc Lập | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Bảo tàng Chứng tích Chiến tranh | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Bưu điện Trung tâm Sài Gòn | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |
| Chợ Bến Thành | HTTP 200, tệp có trên máy | Đã đối chiếu | Công khai | Công khai |

Mười ảnh khác nhau được lưu vào `backend/uploads`, có nguồn tệp Commons, tác giả, giấy phép và ghi chú thu nhỏ/chuyển JPEG. Ảnh dùng để tái tạo demo được đóng gói riêng tại `backend/app/data/demo_images` (3.925.582 byte), có SHA-256 trong manifest và [ghi công từng ảnh](DEMO_IMAGE_CREDITS.md). Không dùng URL `example.com` làm ảnh Củ Chi nữa. Dữ liệu ảnh cũ và pending không bị xuất bản hàng loạt hoặc xóa. Chưa hoàn thiện ảnh của tất cả 38 địa điểm chưa lưu trữ.

## Thay đổi chức năng

- Đặt, thay, sửa ghi công hoặc gỡ ảnh giữ nguyên trạng thái công khai/nháp của địa điểm; bài thuyết minh có quy trình xuất bản riêng. Admin quản lý ảnh trong cùng thư viện, không chuyển qua một hàng chờ duyệt khác. Các trạng thái kỹ thuật cũ được giữ để tương thích dữ liệu.
- Trang chủ dùng ảnh có ghi công từ danh mục đang tải; bỏ phụ thuộc vào ảnh nền ngoài bị lỗi. Thư viện ảnh khách dùng chung phần ghi công và liên kết giấy phép, không cắt mất nội dung ghi công dài.
- Bài đã xuất bản giữ và hiển thị URL nguồn hợp lệ từ API. Trạng thái nghe phản ánh thiếu bài, lỗi hoặc đang phát; không tuyên bố đã nghe loa thật.
- Hồ sơ phân biệt vai trò trong CSDL với quyền Admin đã xác nhận khi đăng nhập. Radio ngôn ngữ/giọng/sao có trạng thái checked cho web và trình đọc màn hình.
- Chỉ đường dùng hàm chung, kiểm tra tọa độ đích, không thêm tọa độ người dùng vào URL và báo lỗi mở ứng dụng/popup. Bến Thành được đối chiếu ở `10.772521,106.698019`; chưa xác minh được nhãn và tuyến Google live vì trình duyệt thử không tải được trang Google.

## Dọn dẹp và bảo toàn

Đã xóa `scripts/__pycache__/prepare_handoff.cpython-313.pyc` (3.718 byte), cache có thể tạo lại. Một số cache backend bị Windows từ chối truy cập và có tiến trình đang sử dụng môi trường nên được giữ. `.npm-cache`, `.venv`, `node_modules`, `.checkpoints`, `.verification` được giữ; các bản sao/log duy nhất không bị xóa hoặc di chuyển.

Gói `expo-57.0.24.tgz` không được manifest, lockfile hoặc script của SDK 58 tham chiếu; bỏ theo dõi gói trong Git và giữ bản local. Môi trường và cache tiếp tục nằm trong `.gitignore`.

## Kiểm chứng và giới hạn

- Chrome headless đã mở trang chủ và 10 trang chi tiết trên Expo 8081 với backend 8000 và CSDL phát triển thật. Ảnh chi tiết tải được, bài Việt hiển thị; đổi sang Anh ở cả 10 điểm trả đúng nội dung API. Không có pageerror; trang chi tiết rộng 390 px không tràn ngang. Không tiêm ảnh/provider/GPS giả trong phép kiểm tra này. Bản ghi nằm trong `.verification/live-public-review-20261031.json`; kiểm tra trang chủ sau sửa được chạy lại riêng.
- Bộ kiểm thử tự động dùng CSDL riêng, không chạy CRUD thử trên dữ liệu phát triển. Kết quả lệnh cuối và CI được cập nhật trong PR; không lấy CI của `ceb59a1` thay cho commit mới.
- Đã dựng PostgreSQL trống riêng, chạy migration, CLI bootstrap 10 điểm/38 bài, sao lưu và khôi phục thử, CLI gắn 10 ảnh, kiểm tra 20 JPEG và chạy lại không trùng; không có tài khoản/đánh giá trong bộ bootstrap.
- Kiểm thử ngày 01/11: toàn bộ backend PostgreSQL thử riêng **276/276 đạt**; backend SQLite trong bản clone **274 đạt, 2 bỏ qua** vì cần PostgreSQL. Nhóm Chrome E2E `application`, `presence-images`, `place-image`, `narration`, `profile-access` **25/25 đạt** với SQLite tạm. Các ca GPS/TTS/popup/provider trong E2E là mô phỏng, các ca CRUD/Auth dùng API thử thật. Frontend unit trong bản clone **226/226 đạt**; typecheck/lint đạt. Bộ E2E bao gồm đặt và gỡ ảnh mà địa điểm vẫn công khai.
- Commons phân giải được DNS. Trong sandbox kết nối bị chặn; ngoài sandbox client backend nhận HTTP 403 về robot policy. Công cụ tìm ảnh vẫn có thể báo lỗi nguồn ngoài; không nới bảo vệ SSRF hoặc giả thành công. Bộ ảnh đóng gói cho phép demo không phụ thuộc lời gọi đó. `--download` là tùy chọn và chưa tải lại thành công qua client backend trong môi trường này.
- Android/iOS mới có kiểm tra mã và xuất bundle; chưa tạo/cài APK/IPA, chưa nghe loa, thử GPS thực địa, key bản đồ native hoặc dịch tự động live. Củ Chi chỉ có bài Việt–Anh; các điểm khác có bài Pháp/Nhật cũ, chưa đối chiếu đầy đủ bản dịch.
