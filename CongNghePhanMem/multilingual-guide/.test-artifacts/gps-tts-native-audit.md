# Kiểm toán GPS và bản đồ native — phần bổ sung cho báo cáo chung

Ngày kiểm tra: 20/10/2026. Các kết quả dưới đây phân biệt kiểm thử bằng mock, xuất bundle JavaScript và thiết bị thật. Không thay đổi backend, không thử lại Overpass thật, không thay đổi quyền riêng tư của Windows.

## Lỗi có bằng chứng và cách sửa

1. **GPS native có thể chờ mãi và không hủy ngay.** Mã cũ chỉ kiểm tra AbortSignal sau khi Promise xin quyền/lấy vị trí hoàn tất. Khi provider không phản hồi, Cancel vẫn để Promise chờ. Đã thêm thời hạn riêng: kiểm tra dịch vụ 10 giây, quyền 90 giây, tọa độ 35 giây; hủy ngay khi AbortSignal đổi. Promise hệ điều hành không hỗ trợ hủy vật lý; kết quả đến muộn bị bỏ qua. Dịch vụ tắt và quyền không thể hỏi lại có thông báo riêng.
2. **Thông tin độ chính xác/thời gian GPS bị bỏ mất.** Web/native trước đây chỉ trả vĩ độ/kinh độ. Nay giữ `accuracy` và `timestamp` thật khi provider cung cấp; từ chối timestamp cũ quá 60 giây, không hợp lệ hoặc quá xa tương lai. Không tự tạo timestamp hay tọa độ thay thế. GPS sai số lớn vẫn có thể tìm POI nhưng giao diện nêu sai số; AutoGuide yêu cầu accuracy hợp lệ tối đa 50 m.
3. **Callback Web có position null có thể ném lỗi trước khi kết thúc loading.** Đã kiểm tra `position?.coords`, báo lỗi tọa độ không hợp lệ; native dùng cùng nguyên tắc. Các callback cũ và callback đến sau Cancel không thay thế yêu cầu hiện tại.
4. **Native đổi bán kính chỉ đổi nhãn/vòng tròn.** Mã cũ không tải lại/lọc danh sách. Nay cập nhật bán kính, tải POI chính thức lại khi thích hợp và luôn lọc dữ liệu hiển thị theo khoảng cách. Khi đang lấy GPS mới, thao tác đổi bán kính không hủy yêu cầu đó để dùng vị trí cũ.
5. **Native chưa tích hợp Wikipedia vào bản đồ/chi tiết.** Nay một lần bấm GPS tự kích hoạt Wikipedia, có lựa chọn tắt; dữ liệu PostgreSQL/OSM/Wikipedia hợp nhất theo namespace, loại tọa độ lỗi, loại trùng và sắp xếp theo khoảng cách. Địa điểm cộng đồng được đăng ký vào kho chi tiết riêng trước khi điều hướng; không giả thành ID PostgreSQL. AutoGuide nhận danh sách hiển thị qua `candidates`.
6. **Theo dõi GPS Web của Expo đang cài có rủi ro sai watch ID và mất lỗi.** Kiểm tra trực tiếp `node_modules/expo-location/src/ExpoLocation.web.ts`: `watchPositionImplAsync` ghi đè Expo watchId bằng ID trình duyệt rồi phát event theo ID đó; hàm cũng truyền `undefined` cho error callback của trình duyệt. Wrapper Web mới gọi trực tiếp API trình duyệt, giữ đúng ID để clearWatch, truyền lỗi và dùng đúng tùy chọn DOM `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 30000`. Wrapper native vẫn dùng Expo, có timeout khởi tạo và dọn subscription đến muộn khi hủy.
7. **GPS một lần còn chờ sau khi rời bản đồ.** Native hiện dùng ref cập nhật trong effect để chỉ hủy lúc đang lấy GPS khi blur/vào nền; source request có AbortController và cleanup theo key, blur, nền, unmount. Không hủy catalog chỉ vì render lại. Root đồng bộ cùng sửa lỗi này cho Web.

## Tệp phụ trách

- `src/services/location.ts`, `location.web.ts`, `locationOptions.ts`: thời hạn, hủy, metadata và kiểm tra vị trí.
- `src/services/locationWatch.ts`, `locationWatch.web.ts`: watcher theo nền tảng, ID chính xác, lỗi và dọn tài nguyên.
- `src/services/nearbyMerge.ts`: lọc bán kính, loại trùng, ưu tiên bản ghi chính thức.
- `src/components/MapScreen.tsx`: tích hợp nguồn cộng đồng native, GPS/radius, điều hướng và cleanup.
- `tests/location.test.cjs`, `nearby-merge.test.cjs`, `auto-guide.test.cjs`, `location-watch.test.cjs`: kiểm thử mock xác định, không đọc GPS thiết bị hay gọi provider thật.
- `tests/e2e/gps-race.spec.ts`: ba hồi quy trình duyệt dùng API GPS giả lập rõ ràng; root chạy và tổng hợp kết quả E2E.

## Bằng chứng kiểm thử

Baseline `tests/location.test.cjs` ban đầu: **13/13 PASS**. Thêm hai hồi quy trước khi sửa cho kết quả **13 PASS, 2 FAIL**, chứng minh lỗi Cancel native với provider treo và metadata Web bị mất. Bản gốc cùng log đỏ/xanh lưu tại `.test-artifacts/gps-tts-before/`.

Các nhóm kiểm thử phụ trách đã chạy riêng và PASS:

| Nhóm | Kết quả | Phạm vi |
| --- | --- | --- |
| `node --test tests/location.test.cjs` | 19/19 PASS | Web/native GPS bằng mock; timeout, quyền, cancel, null/NaN, tuổi và sai số vị trí |
| `node --test tests/nearby-merge.test.cjs` | 5/5 PASS | Bán kính, nguồn lỗi độc lập, trùng tên/ID, tọa độ lỗi |
| `node --test tests/auto-guide.test.cjs` | 6/6 PASS | GPS accuracy, chọn gần nhất Wiki/OSM, nội dung hợp lệ, vùng vào/ra |
| `node --test tests/location-watch.test.cjs` | 10/10 PASS | Browser watchId 77, callback lỗi, abort và late subscription native |
| ESLint các tệp GPS/native/watcher phụ trách | PASS | Kiểm tra mã nguồn |
| `npm.cmd run typecheck` | PASS | TypeScript tại thời điểm hoàn tất phần phụ trách |
| Backend pytest với `TEST_POSTGRES=0` và SQLite cách ly | 103/103 PASS trong 14,63 giây | Không ghi PostgreSQL thật; không provider bên ngoài; không cảnh báo được in |
| Android `npm.cmd run build:android` | PASS, exit 0 | Bundle JavaScript/Hermes, 1.409 module, 46 asset, bundle khoảng 3,5 MB |
| iOS `npm.cmd run build:ios` | PASS, exit 0 | Bundle JavaScript/Hermes, 1.285 module, 42 asset, bundle khoảng 3,2 MB |
| GPS, bản đồ và âm thanh trên Android/iOS thật | NOT TESTED | Không có thiết bị/emulator được sử dụng |
| GPS thật của Windows/Chrome trong lượt kiểm toán này | NOT TESTED | Hồi quy dùng mock, không suy diễn quyền hệ điều hành từ tài khoản công cụ |

Hai lệnh export dùng `EXPO_OFFLINE=1` và `EXPO_NO_TELEMETRY=1`. Cả hai chỉ in cảnh báo môi trường NO_COLOR/FORCE_COLOR; không có lỗi bundle. Export JavaScript không tạo APK/IPA, không ký ứng dụng, không kiểm chứng Google Maps SDK key, quyền hệ điều hành, engine giọng đọc, loa, chế độ im lặng hay hành vi thực tế trên thiết bị.

Tài liệu đã đối chiếu: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) và [Expo Location 57](https://docs.expo.dev/versions/v57.0.0/sdk/location/). Nội dung trên là kết luận từ mã hiện tại và kiểm thử xác định; không chứng minh được GPS thiết bị người dùng đang lỗi hay đã hết lỗi.
