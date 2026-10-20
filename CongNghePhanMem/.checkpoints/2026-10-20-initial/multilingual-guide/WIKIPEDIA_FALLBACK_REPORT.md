# Nguồn địa điểm thay thế Wikipedia — 20/10/2026

## Kết quả

Đã tích hợp Wikipedia tiếng Việt thành một nguồn khám phá có thể bật/tắt trên bản đồ Web. Nguồn này hoạt động độc lập với Overpass và chỉ bắt đầu gửi truy vấn khi người dùng chọn **Tìm bằng Wikipedia** sau khi đã có GPS.

Kiểm tra mạng thật tại tọa độ địa danh công cộng `10.7764, 106.6993`:

- Chrome gọi Wikipedia GeoSearch nhận HTTP 200, 50 kết quả trong khoảng 925 ms.
- Module `src/services/wikipedia.ts` thật gọi qua Chrome nhận 50 địa điểm đã chuyển đổi trong khoảng 970 ms.
- Bản Expo Web đã export hiển thị **50 marker Wikipedia**, HTTP 200 và không có pageerror. Trong phép thử giao diện này, FastAPI/Overpass/tile được kiểm soát để kiểm tra trường hợp nguồn cũ không có kết quả; riêng Wikipedia gọi mạng thật, không mock.
- Một số kết quả: Công viên Bách Tùng Diệp, Bảo tàng Thành phố Hồ Chí Minh, Thư viện Khoa học Tổng hợp Thành phố Hồ Chí Minh. Đây là kết quả của địa danh công cộng thử nghiệm; kết quả GPS Quận 6 được xác minh riêng sau khi người dùng cho phép ở phần dưới.

Bằng chứng: `.test-artifacts/wikipedia-live-public-landmark.json`, ảnh `test-results/wikipedia-live-public-landmark.png`. Ảnh `test-results/wikipedia-alternative-source.png` thuộc E2E với dữ liệu kiểm soát, không phải ảnh nghiệm thu mạng thật.

## Kiểm tra GPS Quận 6 sau khi được đồng ý

Người dùng đã trả lời **“Đồng ý kiểm tra Wikipedia”** cho phép gửi tọa độ GPS đã cung cấp đến `vi.wikipedia.org`, bán kính 5 km. Đã thực hiện đúng phạm vi này:

- Module Wikipedia thật chạy trong Chrome nhận **50 kết quả**, khoảng **1.244 ms** (1,244 giây), bán kính yêu cầu và bán kính tìm thực tế đều 5 km, không có cảnh báo thu hẹp bán kính.
- Kết quả gồm Chợ Minh Phụng, Công viên Phú Lâm, Kênh Hàng Bàng, Kênh Ruột Ngựa, Kênh Lò Gốm, cùng các bài viết có tọa độ khác trong khu vực. GeoSearch có thể trả cả bài về quận/phường, không chỉ điểm tham quan.
- Bản Expo Web hiển thị **50 marker Wikipedia**, HTTP 200, không có pageerror, với cùng GPS đã được đồng ý và bán kính 5 km. GPS được đưa vào Chrome để kiểm tra đúng tọa độ, không đo lại cảm biến thiết bị của người dùng. Trong phép thử này, FastAPI, Overpass và tile được kiểm soát; chỉ Wikipedia gọi mạng thật, không mock dữ liệu Wikipedia và không gửi GPS này tới nguồn khác.
- Bằng chứng riêng: `.test-artifacts/wikipedia-live-approved-location.json` và `test-results/wikipedia-live-approved-location.png`. Không ghi tọa độ riêng vào giá trị mặc định của script; tọa độ chỉ được truyền cho phép thử đã được chấp thuận.

Nguồn Wikipedia đã được xác minh hoạt động với vị trí người dùng cung cấp. Điều này không có nghĩa Overpass đã phục hồi hoặc FastAPI đã có POI chính thức mới.

## Mã nguồn

- `src/services/wikipedia.ts`: truy vấn đọc `vi.wikipedia.org/w/api.php`, `origin=*`, không gửi cookie hoặc token tài khoản; timeout 8 giây, hủy theo caller, cache thành công 5 phút/tối đa 25 khóa. Kiểm tra JSON/API error và từng bài viết, chỉ nhận namespace bài viết, ID/tên/tọa độ hợp lệ; lọc khoảng cách thật, loại trùng, sắp xếp gần nhất. Lỗi mạng không bị đổi thành danh sách rỗng thành công.
- `src/data/places.ts`: thêm nguồn `wikipedia` và trường `sourceUrl`. ID Wikipedia có dạng `wiki-vi-<pageid>`; URL bài gốc được tạo từ ID hợp lệ, không tin URL tùy ý trong phản hồi.
- `src/components/MapScreen.web.tsx`: nút tìm/làm mới/tắt Wikipedia; thông báo rõ việc gửi GPS và bán kính đến Wikipedia khi bật nguồn. Có marker màu cam, nhãn nguồn, liên kết bài viết gốc. Ưu tiên POI FastAPI rồi OSM khi trùng tên và gần nhau. Giữ riêng dữ liệu Wikipedia trong MapScreen; không đưa vào AppContext, trang chi tiết DB, Favorites, History hoặc AutoGuide. Giữ GPS/Leaflet và luồng FastAPI/OSM.
- `tests/wikipedia.test.cjs`: 7 test dịch vụ.
- `tests/e2e/wikipedia.spec.ts`: 4 test trình duyệt.
- `package.json`: `npm.cmd test` chạy đủ cả ba nhóm auth, nearby và Wikipedia. Không thêm dependency.

Script kiểm tra mạng được thêm trong `.test-artifacts/probe-wikipedia.cjs`, `.test-artifacts/live-wikipedia-service.cjs`, `.test-artifacts/live-wikipedia-ui.cjs`. Các script mặc định chỉ dùng tọa độ địa danh công cộng nêu trên. Bản nguồn trước sửa nằm trong `.test-artifacts/wiki-before/`. Workspace không có Git repository; đã kiểm tra bằng bản lưu và `git diff --no-index`.

## Kiểm thử

| Lệnh | Kết quả |
| --- | --- |
| `npm.cmd run typecheck` | Đạt |
| `npm.cmd run lint` | Đạt |
| `npm.cmd test` | 28/28 đạt |
| `npm.cmd run test:e2e` | 22/22 Chrome E2E đạt |
| `npm.cmd run build:web -- --clear` | Đạt, 17 route, xuất `dist` với `.env` hiện có |
| `npm.cmd run build:android` | Đạt, xuất `build-android` |

Các E2E mới xác nhận không có truy vấn Wikipedia trước khi bật, có kết quả khi Overpass lỗi, marker/list tương ứng, loại trùng với POI chính thức, không gửi thao tác tài khoản cho ID Wikipedia, lỗi và làm mới, hủy request cũ khi đổi bán kính, tắt nguồn ngăn truy vấn tiếp, và thông báo giới hạn 10 km. Các E2E Home, Saved, Login/Register, Admin và hành trình vẫn đạt. GPS trong các kiểm thử là vị trí giả lập công cộng; chưa đo GPS thiết bị thật.

## Giới hạn và quyền dùng vị trí

Wikipedia GeoSearch tìm **bài viết có tọa độ**, không phải danh bạ mọi cửa hàng/địa điểm và không thay cho dữ liệu thuyết minh đã kiểm duyệt. Tối đa 50 kết quả mỗi truy vấn. Với bán kính 20 km, nguồn này tìm trong 10 km và thông báo rõ chưa phủ hết 20 km; không gán nhãn sai kết quả là OSM hoặc FastAPI. Không sao chép nội dung bài Wikipedia vào thuyết minh chính thức.

Thiết kế dựa trên tài liệu [MediaWiki GeoSearch](https://www.mediawiki.org/wiki/API:Geosearch) và [CORS cho truy vấn không đăng nhập](https://www.mediawiki.org/wiki/API:Cross-site_requests#Unauthenticated_CORS_Requests).

Phép thử định gửi GPS chính xác người dùng tới Wikipedia ban đầu bị auto-review từ chối vì đây là bên nhận dữ liệu vị trí mới chưa được chấp thuận. Đã dùng tọa độ địa danh công cộng để hoàn thiện phần độc lập. Sau khi người dùng trả lời “Đồng ý kiểm tra Wikipedia”, phép thử GPS trong phạm vi 5 km đã được thực hiện và thành công như phần kết quả bổ sung. Không còn chờ sự đồng ý cho phép thử này. Trong ứng dụng, Wikipedia mặc định tắt khi màn hình được khởi tạo; người dùng chủ động chọn nút đã ghi rõ bên nhận vị trí, có thể tắt bất cứ lúc nào.

Không sửa backend, PostgreSQL, `.env`, JWT, dữ liệu người dùng hoặc MapScreen native. Không push, merge hoặc deploy. Overpass công cộng vẫn có thể timeout; Wikipedia cũng là dịch vụ ngoài, không có cam kết luôn sẵn sàng. Các cảnh báo ảnh CSS Leaflet có sẵn trong build vẫn còn, ứng dụng dùng CircleMarker.

## Chạy trên Windows

```powershell
cd C:\CongNghePhanMem\multilingual-guide
npx.cmd expo start --clear --web
```

Mở Bản đồ → lấy GPS → chọn **Tìm bằng Wikipedia**. Có thể chọn nút này ngay khi đã có GPS, trong lúc Overpass còn chờ. Kiểm tra các marker màu cam, nhãn nguồn Wikipedia và liên kết bài gốc. **Làm mới Wikipedia** tải lại chủ động; **Tắt Wikipedia** dừng nguồn này và hủy truy vấn đang chạy. Các địa điểm Wikipedia chưa có bài thuyết minh chính thức.
