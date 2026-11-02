# Dấu Chân · Thuyết minh tự động đa ngôn ngữ

Ứng dụng Expo/React Native/TypeScript cho Web, Android và iOS, kết nối backend FastAPI/PostgreSQL. Hỗ trợ địa điểm, bản đồ, hành trình, GPS foreground, nghe thủ công/AutoGuide, tài khoản và Admin; nội dung Việt, Anh, Pháp, Nhật.

Mã ứng dụng nằm trong **CongNghePhanMem/**. Từ thư mục mới sau khi clone:

```powershell
git clone https://github.com/mlongzz/sgu_CongNghePhanMem.git
cd sgu_CongNghePhanMem/CongNghePhanMem
```

Làm theo [hướng dẫn cài đặt đầy đủ](CongNghePhanMem/README.md) để tạo môi trường Python 3.13, cài Node ≥22.13.1, tạo PostgreSQL phát triển riêng, cấu hình từ `.env.example`, chạy migration và Expo. Giữ nguyên `.env` đang dùng nếu tiếp tục dự án; không commit credential hoặc database thật.

Bộ demo tái tạo bằng CLI trên database local trống: 10 địa điểm, 40 bài vi/en/fr/ja có nguồn, một hành trình bốn điểm; 10 ảnh JPEG Commons kèm checksum và giấy phép có trong mã nguồn. Không tạo sẵn tài khoản. Đăng ký rồi cấp Admin theo hướng dẫn backend; script từ chối seed vào database đã có dữ liệu.

- [Báo cáo sửa và kiểm chứng ngày 02/11/2026](CongNghePhanMem/docs/REVIEW_2026-11-02.md)
- [PRD và tiêu chí nghiệm thu](CongNghePhanMem/docs/PRD.md)
- [Hướng dẫn kiểm thử](CongNghePhanMem/docs/TESTING_GUIDE.md)
- [Ghi công ảnh](CongNghePhanMem/docs/DEMO_IMAGE_CREDITS.md)
- [GitHub Actions](https://github.com/mlongzz/sgu_CongNghePhanMem/actions)

Admin lưu nội dung mới dưới dạng nháp; sửa bản công khai cần xác nhận gỡ xuất bản. Lưu không đổi và quản lý ảnh giữ trạng thái. AutoGuide cần GPS mới ≤60 giây, sai số ≤50 m và khoảng cách cộng sai số ≤80 m; từ chối GPS vẫn nghe thủ công được. Đường nối trong app là minh họa; chỉ đường thực tế mở Google Maps ngoài. Dịch tự động cần LibreTranslate riêng.

Android/iOS export hiện tạo bundle JS/Hermes, chưa phải APK/IPA đã cài. Cần cấu hình Maps native và thử quyền GPS, lifecycle, giọng/loa trên điện thoại thật trước nghiệm thu đa nền tảng. Xem báo cáo để phân biệt kiểm thử tự động, web live và các giới hạn provider.
