# Báo cáo kiểm tra và sửa lỗi Multilingual Guide

Ngày kiểm tra: **29/10/2026**, múi giờ Asia/Bangkok (UTC+7). Đây là kết quả của phiên hiện tại, tách biệt với báo cáo ngày 28/10/2026 trong `DISCOVERY_UPGRADE.md`. Các con số kiểm thử lịch sử không được tính vào kết quả dưới đây.

## 1. Kết luận dựa trên bằng chứng

Đã xác nhận và sửa sáu nhóm lỗi: nút lồng nhau; trạng thái tải/retry ảnh; thời gian GPS không thống nhất; bỏ sót địa điểm đúng biên bán kính; bộ chuyển đổi OSM không chịu được dữ liệu sai cấu trúc; trạng thái TTS bị tác vụ cũ ghi đè sau khi kết thúc.

Thư mục dự án thực tế là `C:\CongNghePhanMem`. Frontend ở `multilingual-guide`, backend ở `backend`. Đã đọc `AGENTS.md`, README frontend, cấu hình ứng dụng, runner kiểm thử, `DISCOVERY_UPGRADE.md`, `DISCOVERY_CHANGED_FILES.md` và `HCMC_DEMO_GUIDE.md`. Một số liên kết tài liệu gốc trong README không có tệp tương ứng tại workspace hiện tại. Đã đọc [tài liệu Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/) trước khi sửa mã.

Phiên bản đã cài: Expo 58.0.19; React 19.3.0; React Native 0.88.0; React Native Web 0.21.4; TypeScript 6.0.3; Playwright 1.64.1; Node 26.10.0. Backend: FastAPI 0.146.0, SQLAlchemy 2.1.5, Pydantic 2.14.1, psycopg2 2.9.13, httpx2 2.14.0, Uvicorn 0.54.0, pytest 8.4.2; PostgreSQL local 18.6.

Không có metadata Git trong thư mục gốc, frontend hoặc backend: `git status` trả “not a git repository”, nên không thể tạo `git diff` đối với HEAD. Đã lưu 228 tệp mã/kiểm thử frontend và backend cùng package manifest vào `.checkpoints/2026-10-29-before-qa/` để đối chiếu. Không reset/ghi đè toàn bộ dự án, không sửa `.env`, không thêm thư viện hoặc thay phiên bản dependency.

Frontend hiện cấu hình API `http://127.0.0.1:8000`. Home lấy `/places?limit=100&offset=...`, kiểm tra dữ liệu bằng `validateBackendPlace`, ánh xạ `image_url` và `image_thumbnail_url` sang component ảnh. `/media/...` được nối với API; nguồn Wikipedia/Commons chỉ bổ sung ảnh cộng đồng khi xác minh đúng định danh và có ghi công/giấy phép. Ảnh chính thức không tự bỏ qua duyệt Admin.

### Dữ liệu thật và tình trạng ảnh

Kiểm kê PostgreSQL bằng transaction `READ ONLY` và HTTP smoke trên Uvicorn tạm với `default_transaction_read_only=on` xác nhận:

| Nhóm | Trạng thái thực tế |
| --- | --- |
| Danh mục chính thức | 10 địa điểm `manual/published`, chưa xóa; API công khai trả đúng 10 |
| Ảnh chính thức | 9 địa điểm không có URL; 1 địa điểm có URL `https://example.com/cu-chi.jpg`, GET trả **404** |
| Banner Dinh Độc Lập | URL Wikimedia trong `travelHero.ts` trả **403** từ môi trường kiểm tra; không đủ bằng chứng kết luận ảnh hết hạn hoặc bị xóa |
| Wikipedia trong DB | 28 bản nháp chưa xóa và 1 bản nháp đã lưu trữ |
| Bộ demo 15 mục | 15 đề xuất cần duyệt; 9 source ID đã có bản nháp tương ứng, cả 9 vẫn chưa xuất bản |
| Bảo vệ bản nháp | Hai ID draft hiện có trả 404 qua API công khai; list/search/nearby chỉ trả ID published |

Không nhập, duyệt, thay ảnh hoặc xuất bản dữ liệu ứng dụng. Lỗi 404 và dữ liệu ảnh thiếu cần được Admin xử lý qua quy trình đang có. Đợt dò HTTP ban đầu bị sandbox chặn kết nối; phép dò chỉ đọc sau đó đã thu được 403/404 thực, được ghi riêng trong bằng chứng.

Cổng API 8000 ban đầu chưa chạy. Server tạm chỉ dùng cho smoke chỉ đọc đã được dừng sau kiểm tra; không để lại tiến trình ứng dụng của phiên này.

## 2. Bảng lỗi và kiểm chứng

| ID / mức độ | Bằng chứng, cách tái hiện và nguyên nhân | Bản sửa | Trạng thái |
| --- | --- | --- | --- |
| F01 / Cao | Khi mọi nguồn ảnh lỗi, `PlaceImage` sinh nút retry bên trong Pressable có role button. Có tại PlaceCard, danh sách hành trình và tile thư viện ảnh Admin. `stopPropagation` không sửa HTML. SSR bằng RN Web thật tái hiện 1 button lồng button ở thẻ địa điểm và hành trình trước sửa. | Dùng View làm thẻ; ảnh/retry và vùng mở chi tiết là phần tử ngang cấp. Giữ role, nhãn, focus và kích hoạt bằng Enter. Ảnh trong native Callout và hàng chọn điểm dừng đặt `retryEnabled=false`; thử lại tại màn hình chi tiết/editor độc lập. | Đã sửa, kiểm chứng cấu trúc SSR và Chrome; thao tác native cần máy thật. |
| F02 / Trung bình | Danh sách URL đã lỗi sống qua lần đổi nguồn: A lỗi → đổi B → quay A không tải lại. Placeholder cũng dùng cùng lời nhắn cho thiếu URL và tải lỗi. | Khóa vòng đời theo cặp full/thumbnail; mỗi retry tạo request mới; bỏ callback cũ, giới hạn timeout 12 giây, thumbnail chỉ chuyển sang full một lần. Không retry tự động vô hạn. Phân biệt thiếu ảnh và tải ảnh thất bại; giữ ghi công. | Đã sửa và kiểm chứng unit + Chrome. |
| F03 / Trung bình | Acquisition chấp nhận GPS lệch tới 60 giây về tương lai, trong khi freshness/map/AutoGuide chỉ chấp nhận 5 giây. Fix tương lai 20 giây được nhận rồi lập tức bị coi không hợp lệ. | Thống nhất dung sai thời gian tương lai 5 giây ở web và native. | Đã sửa, unit và Chrome mô phỏng GPS đạt; GPS máy thật chưa kiểm chứng. |
| F04 / Trung bình | Với tọa độ cố định, điểm đúng biên 3/10/20 km bị loại vì so sánh số thực quá chặt trong Haversine/bounding box. | Dung sai `1e-7 km` (0,1 mm) áp dụng cả SQL prefilter và khoảng cách. Kiểm thử cả 1/3/5/10/20 km, điểm trong biên và ngoài 1 m. | Đã sửa và kiểm chứng trên SQLite và PostgreSQL cô lập. |
| F05 / Trung bình | Converter OSM offline crash khi properties/tags/geometry/center sai kiểu; chuỗi tọa độ `"106,10"` bị đọc như hai ký tự đầu `[1,0]`. | Kiểm tra cấu trúc trước truy cập; từ chối dòng lỗi và giữ các dòng hợp lệ còn lại. | Đã sửa; 6 ca cấu trúc sai đạt trên cả hai DB test. |
| F06 / Trung bình | Pause/resume native đang chờ có thể hoàn tất sau onDone/onStopped và đưa UI trở về playing dù phiên đọc đã kết thúc. 3 regression thất bại trước sửa. | Vô hiệu hóa sequence ngay khi kết thúc hoặc bị dừng, chặn tác vụ cũ ghi trạng thái. | Đã sửa, kiểm chứng service/unit; không khẳng định đã nghe trên điện thoại thật. |
| D01 / Trung bình | 9/10 bản ghi chính thức thiếu URL và 1 URL trả 404; banner trả 403 trong phép dò hiện tại. Không phải tất cả đều do state/cache frontend. | Placeholder và trạng thái lỗi hoạt động đúng; không thay dữ liệu thật hay gán ảnh không liên quan. | Đã xác minh nguyên nhân dữ liệu/HTTP; cần Admin duyệt ảnh thật. |
| H01 / Theo dõi | Các lỗi “unknown module 855” và “Unexpected text node” là đầu mối từ lịch sử. | Không có bản sửa che cảnh báo hoặc xóa cache mặc định. | Không tái hiện trong các luồng Chrome đã chạy. |

### Bằng chứng riêng về nút lồng nhau

`node .verification/2026-10-29-qa/reproduce-nested-buttons.cjs` chạy 12 assertion trên component checkpoint và component hiện tại, dùng `ReactDOMServer` và `react-native-web` đã cài. Context/router/icons được stub và state ảnh lỗi được tiêm có kiểm soát. Trước sửa, thẻ địa điểm và hành trình có một button nằm trong button; sau sửa cùng số lượng nút nhưng không lồng. Đây là kiểm chứng SSR cấu trúc, không phải chạy browser.

Kiểm thử Chrome `tests/e2e/place-image.spec.ts` kiểm tra DOM thực với selector button/role button lồng nhau, console/pageerror, bàn phím, URL điều hướng và request ảnh. Bao phủ ảnh thành công, không URL, HTTP 503 rồi retry thành công, thumbnail 404 chuyển sang full, thẻ hành trình và thư viện ảnh Admin. Retry không mở chi tiết/editor; vùng điều hướng vẫn mở đúng mục. Đồng hồ mô phỏng đi qua nhiều deadline không sinh vòng lặp request.

## 3. File thay đổi và mục đích

| File | Mục đích |
| --- | --- |
| `multilingual-guide/src/components/UI.tsx` | Tách ảnh/retry khỏi nút mở địa điểm |
| `multilingual-guide/src/components/PlaceImage.tsx` | Reset theo nguồn, remount retry, timeout/callback cũ và placeholder rõ nghĩa |
| `multilingual-guide/src/admin/ImageManagerPanel.tsx` | Tách ảnh/retry khỏi nút mở editor |
| `multilingual-guide/app/journeys.tsx` | Tách ảnh/retry khỏi nút mở hành trình |
| `multilingual-guide/src/components/MapScreen.tsx` | Tránh nút retry trong native Callout có hành vi điều hướng |
| `multilingual-guide/src/admin/JourneyStopsEditor.tsx` | Khai báo ảnh không có retry trong hàng chọn tương tác |
| `multilingual-guide/src/services/i18n.ts` | Dịch thông báo tải ảnh lỗi sang en/fr/ja |
| `multilingual-guide/src/services/location.ts`, `location.web.ts` | Thống nhất kiểm tra timestamp GPS |
| `multilingual-guide/src/services/speechPlayer.ts` | Chặn pause/resume cũ sau kết thúc |
| `multilingual-guide/tests/place-image.test.cjs` | 8 regression ảnh/state/timer, không thay thế browser |
| `multilingual-guide/tests/location.test.cjs` | 2 regression lệch timestamp GPS |
| `multilingual-guide/tests/speech-player.test.cjs` | 3 regression tác vụ TTS đến muộn |
| `multilingual-guide/tests/e2e/place-image.spec.ts` | 5 ca Chrome về DOM/ảnh/keyboard/điều hướng |
| `multilingual-guide/tests/e2e/gps-entry.spec.ts` | 1 ca GPS tương lai, không gửi request và khôi phục khi thử lại |
| `multilingual-guide/package.json` | Thêm regression ảnh vào lệnh npm test hiện có |
| `backend/app/services/place_service.py` | Bao gồm đúng điểm ở biên bán kính |
| `backend/scripts/prepare_osm_import.py` | Từ chối OSM/GeoJSON sai cấu trúc |
| `backend/tests/test_qa_repair.py` | 11 regression bán kính/converter |
| `docs/QA_REPAIR_REPORT.md` | Bàn giao kết quả phiên 29/10/2026 |

Log, script xác minh, bản export và ảnh kiểm thử nằm trong `.verification/`, `.checkpoints/` hoặc thư mục artifact của runner; không phải thay đổi dữ liệu thật. Không push, merge, deploy hay chạy migration.

## 4. Kiểm tra đã chạy

Không cộng các lần chạy tập trung vào tổng suite; đây là các lần chạy riêng.

| Lệnh / phạm vi | Pass | Fail | Skip | Ghi chú |
| --- | ---: | ---: | ---: | --- |
| `npm.cmd run typecheck` | 1 lệnh | 0 | 0 | TypeScript exit 0 |
| `npm.cmd run lint` | 1 lệnh | 0 | 0 | ESLint exit 0 |
| `npm.cmd test` | **219** | **0** | **0** | Suite frontend hiện tại |
| `node --test tests/speech-player.test.cjs tests/narration.test.cjs tests/journey.test.cjs tests/auto-guide.test.cjs` | 54 | 0 | 0 | Nhóm tập trung TTS/hành trình |
| `node --test tests/location.test.cjs tests/location-watch.test.cjs tests/nearby.test.cjs tests/nearby-merge.test.cjs tests/map-logic.test.cjs tests/discovery-consistency.test.cjs` | 73 | 0 | 0 | Nhóm tập trung GPS/bản đồ |
| `node --test tests/place-image.test.cjs` | 8 | 0 | 0 | Với component checkpoint: 5 pass / 3 fail dự kiến |
| `npm.cmd run test:e2e -- place-image.spec.ts gps-entry.spec.ts` | **16** | **0** | **0** | Chrome, backend SQLite tạm, ảnh/GPS fixture |
| `npm.cmd run test:e2e` | **77** | **0** | **0** | Toàn bộ Chrome E2E, 3,4 phút; runner tạo DB/servers riêng |
| Backend pytest SQLite, toàn bộ | **250** | **0** | **0** | 12,44 giây; test DB riêng |
| Backend pytest PostgreSQL local, toàn bộ | **250** | **0** | **0** | 66,60 giây; schema riêng, transaction rollback |
| Backend regression tập trung sau sửa | 42 | 0 | 0 | 11 ca mới trước sửa: 2 pass / 9 fail |
| Script tái hiện SSR nút lồng nhau | 12 assertions | 0 | 0 | Đối chiếu checkpoint/current |
| HTTP API local với DB ứng dụng chỉ đọc | **8** | **0** | **0** | Health/list/search/nearby, 2 draft trả 404 |
| Android export Hermes | 1 lệnh | 0 | 0 | Thành công; chưa phải APK |
| iOS export Hermes | 1 lệnh | 0 | 0 | Thành công; chưa phải IPA |
| `npm.cmd run build:web` | 1 lệnh | 0 | 0 | Export SPA vào dist với cấu hình API local hiện tại |
| `npm.cmd run test:release` | **8 bố cục + 4 ngôn ngữ** | **0** | **0** | Chrome trên dist; 320/390/768/1440 px; assertion tooltip chống HTML injection cũng đạt |

Các lệnh frontend chạy trong `multilingual-guide`. Lệnh export native giữ artifact cũ bằng cách ghi vào thư mục xác minh riêng:

```powershell
node node_modules/expo/bin/cli export --platform android --output-dir ../.verification/2026-10-29-qa/android
node node_modules/expo/bin/cli export --platform ios --output-dir ../.verification/2026-10-29-qa/ios
```

SQLite chạy trong `backend` với `APP_ENV=test`, `TEST_POSTGRES=0`, khóa kiểm thử riêng và `DATABASE_URL` trỏ đến tệp SQLite trong `.verification/qa-20261029-backend/`, không dùng DB ứng dụng:

```powershell
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp ../.verification/qa-20261029-backend/full-run
```

PostgreSQL chạy từ thư mục gốc bằng wrapper kiểm tra host phải là localhost trước khi bật `TEST_POSTGRES=1`. Conftest tạo schema riêng cho mỗi ca và rollback; kiểm tra sau suite không có schema test còn sót:

```powershell
backend/.venv/Scripts/python.exe .verification/qa-20261029-backend/verify-postgres.py
backend/.venv/Scripts/python.exe .verification/qa-20261029-backend/live-smoke.py
backend/.venv/Scripts/python.exe .verification/qa-20261029-backend/image-http-probe.py
```

Lần baseline backend đầu có 210 pass và 29 lỗi setup do Windows từ chối tạo temp tại `backend/.test-artifacts`; chuyển **đường dẫn temp kiểm thử** sang `.verification` rồi chạy lại toàn bộ đạt 250/250. Không bỏ test hay đổi kỳ vọng. Một cảnh báo PyJWT xuất hiện trong ca cố ý dùng thuật toán sai. Export có cảnh báo Metro về tài nguyên CSS Leaflet và NO_COLOR/FORCE_COLOR; không che cảnh báo.

Log chính: `.verification/2026-10-29-qa-frontend-unit.log`, `2026-10-29-qa-images-e2e.log`, `2026-10-29-qa-e2e-full.log`, `2026-10-29-qa-android.log`, `2026-10-29-qa-ios.log`, `2026-10-29-qa-web.log`, `2026-10-29-qa-release.log`, `2026-10-29-qa-lint.log`; PostgreSQL tại `.verification/qa-20261029-backend/postgres.log`. Kiểm kê và HTTP thực tại `local-inventory.json` và `live-smoke.json` trong cùng thư mục backend evidence. Screenshot E2E ở `multilingual-guide/test-results/`; báo cáo/screenshot release ở `multilingual-guide/.test-artifacts/release-smoke/`.

## 5. Bản đồ, OSM, TTS và giới hạn kiểm chứng

- `/map` dùng chung `useMapDiscovery` cho Leaflet web và native map. Luồng GPS có deadline quyền/dịch vụ/lấy vị trí, kiểm tra tọa độ, hủy khi blur/background và nhãn tọa độ nhập tay. Tọa độ mặc định TP.HCM chỉ đặt camera; không tự sinh marker GPS người dùng.
- Bán kính 1/3/5/10/20 km truyền API bằng km, vòng tròn bản đồ dùng m. Source key, AbortController và catalog sequence ngăn request cũ ghi đè. Marker và danh sách lấy cùng `filteredPlaces`. Danh sách ban đầu 18 mục có “Xem thêm”; backend nearby tối đa 100, OSM 250 và Wikipedia tối đa 10 km có thông báo độ phủ/giới hạn.
- OSM: job đồng bộ có opt-in gọi Overpass → chuẩn hóa → snapshot/cache (có thể lưu PostgreSQL AdminSetting). API khám phá đọc snapshot, không tự xuất bản Place. Danh mục chính thức qua Admin preview/token → transaction → draft. Unique `(source, source_id)` chống nhập lặp. Các test timeout, lỗi provider, stale snapshot, draft visibility, duplicate và rollback đã chạy trên hai loại DB. Chưa chạy job Overpass live vào DB hiện tại.
- TTS: chọn ngôn ngữ/giọng/tốc độ, chia đoạn tuần tự, stop khi đổi ngôn ngữ/rời chi tiết, cleanup watcher khi rời bản đồ hoặc về nền. AutoGuide có opt-in, chỉ điểm dừng kế tiếp, kiểm tra độ mới/độ chính xác và chống lặp. Kiểm thử dịch vụ và browser dùng driver/GPS fixture; không phải bằng chứng âm thanh/GPS trên điện thoại.
- Chưa có Android/iPhone thật, chưa tạo/cài APK hoặc IPA. Chưa xác minh R2 upload live, MapTiler có credential thật hoặc độ ổn định Overpass live. HTTP Wikimedia 403 tại môi trường này vẫn cần kiểm tra từ trình duyệt/mạng demo thực.
- Bản web dùng `web.output=single` (SPA), không có SSR/hydration ứng dụng để khẳng định một luồng hydration server đã được thử. Chrome vẫn kiểm tra DOM thực, lỗi runtime và console liên quan; SSR riêng dùng để đối chiếu cấu trúc trước/sau sửa.

## 6. Checklist Chrome, Android và iPhone

### Chrome

- [ ] Chạy backend local và frontend web; mở Home. Đối chiếu 10 mục công khai, không xuất hiện bản nháp/demo chưa duyệt.
- [ ] Dùng DevTools chặn URL ảnh: thẻ giữ bố cục, báo tải ảnh lỗi. Dùng Tab/Enter vào “Thử tải ảnh”: chỉ tải lại; “Xem chi tiết” mở đúng địa điểm; lưu yêu thích vẫn độc lập. Kiểm tra Console không có nested button/text node/runtime error.
- [ ] Ảnh có dữ liệu hiển thị đúng nguồn/tác giả/giấy phép. Không URL chỉ có placeholder. Kiểm tra lại banner Wikimedia trên mạng thực.
- [ ] Ở Bản đồ, thử cấp quyền, từ chối rồi cấp lại, timeout/hủy; đổi nhanh 3 → 5 → 1 km; kiểm tra marker/danh sách/đơn vị và thông báo rỗng/lỗi. Thử tọa độ thủ công và xác nhận nhãn không nhận là GPS thật.
- [ ] Phát/dừng/chuyển ngôn ngữ/giọng, sang màn hình khác; không nghe chồng, không tự bật lại sau khi bài kết thúc.

### Android thật

- [ ] Thiết bị cùng mạng với backend; dùng `npm.cmd run check:device` rồi `npm.cmd run dev:device` theo README. API phải là IP LAN phù hợp, không phải localhost điện thoại. Chuẩn bị build/key bản đồ native theo cấu hình của môi trường demo.
- [ ] Thử quyền vị trí bị từ chối/cấp lại, GPS tắt, GPS ngoài trời và di chuyển thật; xác nhận khoảng cách, bán kính và marker.
- [ ] Chạm thẻ, yêu thích và Callout; retry ở màn hình chi tiết/editor. Kiểm tra bố cục khi ảnh không tải.
- [ ] Cài giọng vi/en/fr/ja cần dùng, nghe lần lượt, đổi nội dung khi đang phát; về Home/background phải dừng đúng. Android dùng dừng/phát lại theo khả năng driver, không mặc định có pause.
- [ ] Bật AutoGuide có chủ ý, đi vào/ra điểm dừng kế tiếp; không phát lặp liên tục, không phát điểm đã hoàn tất, không theo dõi nền.

### iPhone thật

- [ ] Thực hiện các bước mạng/quyền/GPS/ảnh/AutoGuide tương tự Android, kiểm tra Expo Go/development build phù hợp SDK 58.
- [ ] Tắt chế độ im lặng và tăng âm lượng; kiểm tra giọng đã cài. Thử play/pause/resume/stop, chuyển ngôn ngữ khi đang đọc và khi đoạn cuối kết thúc.
- [ ] Khóa màn hình hoặc đưa ứng dụng xuống nền rồi quay lại; không có âm thanh chồng hoặc watcher cũ tiếp tục kích hoạt.

## 7. Sẵn sàng demo và điều kiện deploy

**Demo local trên Chrome: sẵn sàng có điều kiện.** Toàn bộ 77 E2E, 219 unit frontend, hai suite backend 250 ca, Web export và release smoke đều đạt; có thể chạy demo chức năng sau khi khởi động backend/frontend. Cần trình bày đúng giới hạn: danh mục thật hiện thiếu ảnh, URL ảnh chính thức còn lỗi 404 và banner cần kiểm tra lại trên mạng demo. Nếu demo Android/iPhone, phải hoàn tất checklist thiết bị trước; export bundle chưa chứng minh GPS/TTS máy thật hoạt động. Chưa phù hợp để hứa một demo đầy đủ ảnh hoặc native đã được nghiệm thu.

**Trước deploy:** Admin duyệt/bổ sung ảnh và giấy phép đúng địa điểm; kiểm tra ảnh thực tải được; hoàn tất checklist Android/iPhone; xác minh HTTPS, API URL/CORS, key/domain bản đồ, kho ảnh và nhà cung cấp live trong môi trường đích. Kiểm tra migration/backup theo quy trình riêng trước thao tác database production. Phiên này không deploy và không thay đổi quy trình duyệt để tăng số địa điểm.
