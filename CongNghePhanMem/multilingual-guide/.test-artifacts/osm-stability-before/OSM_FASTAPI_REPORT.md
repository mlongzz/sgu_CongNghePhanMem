# Overpass qua FastAPI và kiểm tra JWT — 20/10/2026

Đã thực hiện bốn ưu tiên, giữ luồng bấm GPS một lần tự tìm địa điểm và Wikipedia dự phòng.

| Nguồn | Endpoint Web gọi | Xử lý phía server | ID trên bản đồ |
| --- | --- | --- | --- |
| POI chính thức | `GET /places/nearby` | Chỉ đọc PostgreSQL, giữ contract cũ | `db-*` |
| OpenStreetMap | `GET /osm/nearby` | FastAPI gọi các Overpass cố định | `osm-node-*`, `osm-way-*`, `osm-relation-*` |
| Wikipedia dự phòng | GeoSearch hiện có | Giữ luồng nguồn dự phòng đã được chọn | `wiki-vi-*` |

## Endpoint mới

Ví dụ dùng tọa độ địa danh công cộng:

```http
GET /osm/nearby?latitude=10.7764&longitude=106.6993&radius_km=3
```

Trả `source: "openstreetmap"`, `elements`, `requested_radius_km`, `searched_radius_km`, `warning`. `elements` giữ thông tin OSM cần cho adapter, không phải row PostgreSQL. Danh sách rỗng hợp lệ là HTTP 200; lỗi nhà cung cấp là HTTP 502/503/504, không giả thành thành công rỗng. Có `force_refresh=true`; vẫn tôn trọng cooldown khi nhà cung cấp giới hạn truy cập.

- Vĩ độ/kinh độ hữu hạn trong giới hạn hợp lệ; bán kính 1–20 km. Không nhận URL hoặc câu Overpass tùy ý.
- Gửi POST form qua `httpx2.AsyncClient`, User-Agent nhận diện ứng dụng, không chuyển JWT/cookie của người dùng, không theo redirect.
- Bán kính đến 6 km: primary 14 giây, backup 12 giây. Lớn hơn: bán kính yêu cầu 14 giây, dự phòng 5 km 10 giây, backup 5 km 12 giây. Có deadline toàn lượt ngoài timeout mạng.
- Đọc tối đa 4 MiB; kiểm tra tọa độ/ID/tags, loại trùng ID và địa điểm ngoài vùng tìm; tối đa 250 điểm.
- Cache RAM theo GPS/bán kính chính xác: 5 phút cho đủ bán kính, 45 giây khi giảm bán kính; tối đa 32 mục. Gộp yêu cầu trùng, tối đa 8 lượt khác nhau đang chạy. Cache/cooldown áp dụng trong từng worker.
- `/osm/nearby` public, không phụ thuộc phiên đăng nhập hay truy vấn DB. Không ghi POI cộng đồng vào danh mục, Favorites, History hoặc thuyết minh chính thức.

Mã chính: `backend/app/routers/osm.py`, `app/services/osm_service.py`, `app/schemas/osm.py`; đăng ký router trong `app/main.py`. Chuyển `httpx2` từ dependency chỉ dùng phát triển sang `requirements.txt` để image/runtime cũng có thư viện này. Không cần migration.

## Web và JWT

`src/services/nearby.ts` đã bỏ toàn bộ URL/query/retry Overpass trực tiếp. Một GET tới FastAPI chờ tối đa 40 giây, có hủy yêu cầu, kiểm tra contract và báo bán kính thực tế. Thiếu `EXPO_PUBLIC_API_URL` thì báo cấu hình, không âm thầm quay lại gọi Overpass. `fetchNearbyPlaces` chỉ trả POI PostgreSQL cho AppContext; `fetchOsmExploreResult` giữ named export/chữ ký, dùng riêng để hợp nhất dữ liệu trên bản đồ.

`MapScreen.web.tsx` tiếp tục hợp nhất hai namespace, loại trùng tên gần nhau, lọc/sắp xếp theo khoảng cách và gắn marker đúng nguồn. Hiển thị đang truy vấn qua FastAPI; không giả hiển thị backend đang ở lượt dự phòng nào khi chưa nhận kết quả. Wikipedia tự tìm sau thao tác GPS, không phải đợi OSM. Yêu cầu đăng nhập khác giữ timeout 12 giây.

JWT `/users/me` đã có kiểm tra chữ ký HS256, `exp/sub/type`, phân biệt access/refresh và refresh phiên. Không thay SECRET_KEY, định dạng token hoặc storage. Bổ sung `WWW-Authenticate: Bearer` nhất quán cho các lỗi 401. Kiểm thử xác nhận thiếu/sai scheme, hết hạn, sai chữ ký/thuật toán, nhầm refresh token, thiếu claim, subject sai hoặc user không tồn tại đều bị từ chối; refresh hợp lệ vẫn lấy được đúng hồ sơ, kể cả sau lỗi. CORS vẫn hiện trên phản hồi lỗi để Web đọc được status.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Backend, SQLite test riêng | 68/68 đạt |
| Frontend unit | 41/41 đạt |
| Chrome E2E từ Web export mới | 33/33 đạt |
| TypeScript và ESLint | Đạt |
| `npm.cmd run build:web -- --clear` | Đạt, xuất `dist` với 17 route và cấu hình API thực tế |

E2E có ca trình duyệt gọi hai endpoint FastAPI thật, backend mock tầng HTTP Overpass, hiện đúng marker `db-*` và `osm-*`; không có request Overpass trực tiếp hoặc JWT gửi trong request OSM. Các ca dữ liệu/timeout/cooldown nhà cung cấp đã chuyển về kiểm thử service Python. Ca giao diện vẫn bao phủ GPS, đổi bán kính, lỗi từng nguồn, phục hồi, Wikipedia, đăng nhập/refresh và tài khoản. Test server dùng SQLite/thư mục tạm, không sửa dữ liệu PostgreSQL.

Lượt thử mạng thật với landmark 3 km nhận HTTP 504 sau **26.354 giây**: private.coffee hết 14 giây và overpass-api.de hết 12 giây. Phản hồi vẫn có `Access-Control-Allow-Origin: http://localhost:8081`. `/users/me` không token trả 401, `WWW-Authenticate: Bearer` và CORS đúng. Bằng chứng: `.test-artifacts/osm-fastapi-live.json`. Proxy đã loại đường gọi Overpass từ trình duyệt; chưa có bằng chứng các máy chủ Overpass ngoài mạng đã phục hồi. Wikipedia vẫn cung cấp nguồn thay thế khi người dùng bấm GPS.

Một lượt đo và E2E ban đầu bị gián đoạn nhiều giờ; không dùng số đo đó làm kết luận thời gian chờ. Đã chạy lại mạng thật và toàn bộ E2E với kết quả trên. Pytest còn cảnh báo không ghi được cache; không có kiểm thử thất bại.

Backend đang chạy đã có `/osm/nearby` trong OpenAPI. Giữ nguyên `.env`, khóa JWT, database và quyền trình duyệt. Bản trước thay đổi: `.test-artifacts/osm-fastapi-before/`; workspace không có Git repository, đã xem diff với `git diff --no-index`.

Sau khi xuất bundle, đã khởi động lại riêng tiến trình Expo của workspace trên cổng 8081 và kiểm tra `/map` trả HTTP 200. Để Expo tiếp tục chạy. Người dùng mở `http://localhost:8081/map`, Ctrl+Shift+R rồi bấm GPS một lần. Log khởi động: `.test-artifacts/expo-osm-proxy.log` và `.err.log`.
