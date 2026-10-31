# Báo cáo sửa chữa và nghiệm thu Multilingual Guide

Ngày nghiệm thu: **29/10/2026**, múi giờ Asia/Bangkok. Kết quả trong tài liệu này là lần chạy thực tế của đợt sửa hiện tại; không cộng số test hoặc điểm từ báo cáo lịch sử.

## 1. Nền mã, tài liệu và giới hạn Git

Workspace sửa: `C:\CongNghePhanMem`, backend và frontend cùng cấp. Thư mục này không có `.git`; `git rev-parse/status` không nhận diện repository, vì vậy không thể gán HEAD/nhánh hoặc tuyên bố đây là diff chưa commit so với `439ab7f`.

Đã đọc báo cáo `E:\Bao_cao_cham_va_sua_loi_do_an.docx`, toàn bộ các phần của `E:\sua-loi-do-an.patch`, yêu cầu bàn giao người dùng gửi và hướng dẫn `multilingual-guide/AGENTS.md`. Đã xem hướng dẫn microservices ở E: tài liệu đó ghi rõ dựa trên giả định, chưa phải đặc tả nghiệp vụ được giảng viên xác nhận. Kiến trúc FastAPI theo module được giữ nguyên.

Bản Git tham chiếu khác ở `E:\sgu_CongNghePhanMem`: nhánh `feat/sync-buihao-windows`, HEAD `3ebb50dd1d5ec9e18655873ed6f1e58b360e3247`. Đây không phải main lịch sử `439ab7f` và không phải thư mục C đang sửa. Chỉ dùng `git -c safe.directory=...` theo lệnh đọc, không đổi cấu hình Git toàn cục hay ghi vào repo E.

`git apply --check E:\sua-loi-do-an.patch` đã chạy và thất bại: tiền tố `CongNghePhanMem/` trong patch khác bố cục của bản Git E. Phép check tại C cũng không khớp; check bản sao đã chuẩn hóa tiền tố cho thấy nhiều phần khác phiên bản và tệp mới đã tồn tại. Không apply patch, reset, quay về commit cũ, commit, push, tạo tag, publish hoặc deploy.

Trước sửa đã lưu **316 tệp nguồn** vào `.checkpoints/2026-10-29-before-acceptance/`, kèm manifest SHA-256 và không có `.env` cá nhân. Mọi mô tả trước/sau dưới đây đối chiếu checkpoint này. Bộ auth C có đủ 7 tệp; **6/7 giữ nguyên byte**, AuthScreen chỉ thêm thông báo khi logout chưa thu hồi được phiên máy chủ. Bản Git E không có thư mục auth và không track các tệp này; phép `git check-ignore` không tìm thấy quy tắc áp dụng. Không đủ bằng chứng xác định nguyên nhân bỏ sót tại main lịch sử.

## 2. Trạng thái L1–L9

| ID | Trước sửa trên C | Thay đổi và bằng chứng sau sửa | Trạng thái |
| --- | --- | --- | --- |
| L1 — Auth/build | Đủ component tại máy; chưa có bằng chứng bản giao cài/build độc lập. | Giữ bộ auth, thêm kiểu CSS rõ ràng. Cài mới 825 package từ lockfile trong bản sao không có node_modules/.env/cache; typecheck/lint/221 test/Web export đạt. Import AuthLayout/AuthScreen/AuthTextField/LanguageSelector/PasswordStrength/PrimaryButton và barrel được kiểm tra qua compiler/build. | Đã sửa/kiểm chứng bản nguồn; tracking C chưa kiểm chứng vì thiếu Git. |
| L2 — Hành trình → bản đồ → GPS/TTS | Có context/progress nhưng `/map` không có ID, trộn POI khám phá, chỉ khóa điểm kế tiếp. | `/map?journey=id`; nạp lại đúng tuyến, marker đánh số/lựa chọn, danh sách đúng tuyến, chặn OSM/Wikipedia. Thứ tự linh hoạt đúng yêu cầu; hoàn thành chỉ khi onDone. E2E thực kiểm tra GPS giả lập, denied/manual, replay, reload, lỗi/hủy và request cũ. | Đã kiểm chứng logic/API/Chrome; thiết bị thật chưa xác minh. |
| L3 — CI/CD | Workflow trong frontend, thiếu backend/DB/E2E và publish gate ở root. | Workflow root 5 job: backend SQLite/PostgreSQL, frontend, E2E, Docker build, publish tag. YAML đã parse và kiểm tra working-directory, dependency, điều kiện tag. Workflow cũ chuyển vào checkpoint, giữ bản trên đĩa. | Đã viết/kiểm tra cấu hình; chưa chạy Actions/publish. |
| L4 — Tài liệu | Thiếu README root/PRD; liên kết tới báo cáo không có. | README root với lệnh tương đối; PRD, TESTING_GUIDE, IMPLEMENTATION_STATUS, báo cáo và inventory thật. Sửa README frontend/Auth handoff/deployment. Script kiểm tra liên kết local đạt. | Đã hoàn thiện tài liệu trong phạm vi có bằng chứng. |
| L5 — Email | So sánh email nguyên dạng; API pre-check và unique nguyên dạng không chống race hoa/thường. | Chuẩn hóa trim/lower đăng ký/login/profile/Admin; query hỗ trợ legacy mixed-case. Unique index lower(trim) trên SQLite và lower(btrim) trên PostgreSQL. Migration dừng nếu dữ liệu cũ trùng, không xóa/gộp. Hai request đồng thời: một 201, một 409 và session rollback vẫn dùng được. | Đã kiểm chứng trên DB thử; chưa migrate DB ứng dụng. |
| L6 — Điểm nháp | Editor và backend cùng chỉ cho published. | Editor dùng Admin API không lọc published, gắn nhãn draft, bỏ deleted. Backend nhận draft chưa xóa; API public lọc draft/deleted khỏi stops/place_ids/cover và giữ thứ tự còn lại. E2E tạo draft → thêm tuyến → publish đạt. | Đã sửa và kiểm chứng. |
| L7 — N+1 | Frontend đã nhận stops một lần; backend list vẫn count/query theo từng tuyến. | Query theo cả trang; test 20 tuyến đo đúng **2 SELECT**. Parse bỏ riêng stop sai/duplicate/draft, giữ stop hợp lệ; lỗi mạng/quyền vẫn là lỗi. | Đã sửa và kiểm chứng. |
| L8 — Upload timeout | Mặc định toàn bộ request 90 giây; upload không có điều khiển hủy riêng. | Request thường mặc định 12 giây; riêng upload 90 giây và AbortController/nút Hủy. Hủy khi unmount, giữ phần chưa tải trong hàng chờ, retry không tạo ảnh trùng. Unit/API/E2E kiểm tra success/413/415/timeout/hủy/retry. | Đã sửa; mạng di động chậm thật chưa thử. |
| L9 — Artifact/Git | `.test-artifacts`/tgz có trên đĩa, ignore chưa đủ. | Bổ sung ignore và bộ đóng gói loại dependency/cache/env/artifact. Giữ `.test-artifacts` và `expo-57.0.24.tgz` trên đĩa. | Đã xử lý gói nguồn/ignore; không untrack vì C không có Git. |

Lỗi React button lồng button và retry ảnh đã được sửa trong nền mã trước phiên này. Không viết lại phần đó: bộ `place-image`/SSR/Chrome vẫn được chạy lại, gồm retry không mở chi tiết và giữ Tab/Enter/nguồn/tác giả/giấy phép. Không coi đây là bản sửa mới của phiên này.

## 3. Lỗi mới và bằng chứng trước/sau

| ID | Trước / tái hiện | Sau / cách xác minh |
| --- | --- | --- |
| N1 — Refresh sau logout | JWT refresh stateless, logout chỉ xóa local; token cũ vẫn đổi access. | Phiên DB lưu hash token, xoay vòng CAS nguyên tử; logout xóa họ refresh kể cả token đang xoay. Replay/refresh sau logout trả 401; hai request refresh đồng thời chỉ một 200. Access JWT đã cấp vẫn có hiệu lực đến hết hạn, mặc định tối đa 60 phút. |
| N2 — Thử login/dò tài khoản | Không throttle; account không tồn tại bỏ qua password verify. | Cửa sổ 5 phút trong DB: 12 lượt/account, 120/IP (cấu hình được). Cùng lỗi 401 và một lần Argon2 verify cả tài khoản có/không có; vượt giới hạn trả 429/Retry-After; cửa sổ mới cho thử lại. Không tuyên bố mọi kênh dò email đã bị loại bỏ; đăng ký vẫn trả 409 theo yêu cầu UX. |
| N3 — Stop lỗi phá cả màn hình | parseJourney ném lỗi nếu một stop sai payload. | Bỏ từng stop không hợp lệ, đếm unavailable và giữ thứ tự hợp lệ; vẫn từ chối hành trình sai cấu trúc/ID/tên/stops. Không dùng any hoặc nới quyền. |
| N4 — Drift schema index PostgreSQL | Lần đầu thêm trim index: 260 pass/1 fail do Alembic reflection viết lại TRIM và báo index khác metadata. | Biểu thức canonical theo dialect dùng btrim trên PostgreSQL; fresh upgrade/idempotence/compare_metadata và toàn suite PostgreSQL đạt 261/261. SQLite thiếu reflection expression được ghi là warning; hành vi unique được test trực tiếp. |
| N5 — Fixture ảnh hưởng suite sau | Lần E2E đầy đủ đầu có 76 pass/7 fail: draft thử được publish gần GPS mặc định, chưa cleanup, làm các ca sau nhận dư một POI. | afterEach xóa/soft-delete đúng journey/place do ca đó tạo. Giữ nguyên kỳ vọng số marker của suite cũ; lần chạy lại đạt 83/83. |
| N6 — Dependency/build context | Cài mới theo range kéo một số phiên bản chưa được kiểm chứng; Docker context đụng thư mục temp local. | Thêm constraints khóa phiên bản đã kiểm chứng và cài lại trong virtualenv mới. Docker context dùng allowlist app/alembic/scripts/manifest; bản context sạch đi tới bước kết nối Docker và dừng vì daemon không có. |

**Bằng chứng hồi quy trước sửa:** chép backend từ checkpoint sang `.verification/acceptance-20261029/baseline-replay/`, thêm đúng 9 ca `test_acceptance_repairs.py` mới. Kết quả **9 fail**: email/legacy/index, refresh/logout, throttle/hash giả, draft route, N+1 và thiếu preflight. Sau sửa cùng 9 ca đạt; có thêm hai ca cạnh tranh PostgreSQL thật. Fail do thiếu module chức năng mới cũng được ghi rõ trong log, không giả là lỗi runtime của luồng cũ.

Trong đợt xác minh sạch cũng phát hiện khai báo trùng tên test E2E và nhãn tiếng Việt bị hỏng khi chuyển qua pipeline PowerShell; đã sửa tệp test, kiểm tra tên duy nhất và chạy lại. Ca chuyển màn hình kiểm tra màn hình đang hiển thị vì Expo giữ màn hình trước ở navigation stack; vẫn kiểm tra request cũ bị hủy và không xuất hiện dữ liệu trả muộn. Không bỏ các ca này hoặc tăng timeout để che lỗi.

## 4. Quy tắc hành trình và phát âm thanh

- Điểm gần trong tuyến được ưu tiên theo thứ tự Admin; không bắt buộc đi tuần tự. “Điểm đang đến” gợi ý điểm chưa xử lý đầu tiên; vẫn nghe được điểm khác.
- GPS mới ≤60 giây, lệch tương lai tối đa 5 giây; sai số ≤50 m; khoảng cách cộng sai số ≤80 m. Không dùng tọa độ mô phỏng nhập tay để tự phát.
- Chỉ onDone mới thêm completed. Đang tải/đang phát/tạm dừng/đã nghe xong/lỗi/hủy được phân biệt; skip có bộ đếm riêng. Một player điều phối phát, không phát chồng.
- Completed giữ khi ra xa, đổi ngôn ngữ và quay lại; không tự phát lại khi GPS dao động. Thử tự phát thất bại có cooldown 120 giây, nghe thủ công vẫn sẵn có. Đổi tuyến đặt lại cooldown/tiến độ tuyến mới; tải lại kiểm tra API và phục hồi tạm dừng. Kết thúc/logout xóa tiến độ phiên trên thiết bị.
- Blur/background hủy request/watch/âm thanh thuộc hành trình. Đổi ID không để phản hồi cũ ghi đè. Từ chối GPS vẫn có route/manual.
- Polyline nét đứt là đường nối minh họa. Nút chỉ đường mở Google Maps ngoài với đích cụ thể; chưa có routing engine đường phố bên trong ứng dụng.

## 5. Kiểm thử thực tế

Các lệnh frontend chạy trong `multilingual-guide`; lệnh backend trong `backend`, trừ khi ghi “bản sao”. Mọi lần chạy DB dùng schema/DB thử riêng; không migrate/seed/ghi dữ liệu ứng dụng.

| Lệnh / phạm vi | Kết quả đã ghi nhận | Bằng chứng |
| --- | --- | --- |
| `python -m pytest ... tests/test_acceptance_repairs.py` trên checkpoint | 9 fail dự kiến | `before-regressions.log` |
| `python -m scripts.verify_postgres` trên nguồn sửa | **261 pass, 0 fail, 0 skip**; 257,48 giây | `backend-postgres-final.log` |
| PostgreSQL tập trung migration/race/acceptance | 14 pass | `postgres-focused.log` |
| `npm run test:e2e` qua wrapper PostgreSQL, toàn bộ trước ca race bổ sung | **83 pass, 0 fail**; 4,6 phút | `e2e-final-postgres.log` |
| `npm ci --offline --no-audit --no-fund` trong bản sao | 825 package cài mới; exit 0 | `clean-npm-install.log` |
| Virtualenv mới + `pip install -r requirements-dev.txt` với constraints | Cài thành công, đúng phiên bản đã khóa | `clean-pip-pinned.log` |
| `npm run typecheck` trong bản sao | exit 0 | `clean-typecheck.log`, kiểm tra lại `clean-typecheck-final.log` |
| `npm run lint -- --no-cache` trong bản sao | exit 0, không warning/error | `clean-lint.log`, kiểm tra lại `clean-lint-final.log` |
| `npm test` trong bản sao | **221 pass, 0 fail, 0 skip** | `clean-unit.log` |
| `python -m pytest -q -p no:cacheprovider` trong bản sao | **259 pass, 2 skip** (hai ca race chỉ chạy PostgreSQL), 0 fail | `clean-backend-sqlite.log` |
| Web export trong bản sao | exit 0, SPA `dist` | `clean-web-build.log` |
| Android/iOS export trong bản sao | exit 0 cả hai; JS/Hermes, chưa APK/IPA | `clean-android.log`, `clean-ios.log` |
| E2E cuối trên bản sao, PostgreSQL thật, có ca race/voice error/mobile | Đang cập nhật lần chạy cuối | `clean-e2e-postgres-final.log` |
| `python scripts/check_docs.py` | 0 liên kết local hỏng | Chạy lại sau khi chốt báo cáo/inventory |
| Parse workflow YAML, kiểm tra 5 jobs/path/needs/tag gate | Đạt kiểm tra cấu hình local | Không phải Actions run |
| `docker ... build ...` với context sạch | Không build được: Docker daemon pipe không tồn tại | `docker-build-clean.log` |

Log đầy đủ nằm tại `.verification/acceptance-20261029/`. Bản sao cài/build tại `.verification/handoff-source-20261029/`. Không cộng các lần chạy tập trung vào tổng suite. Screenshot/trace là fixture trong `multilingual-guide/test-results/` của bản sao, gồm ảnh route 320 px; không phải GPS/âm thanh thật.

PostgreSQL 18.6 tạm chạy trên `127.0.0.1:55439`, data nằm trong thư mục kiểm chứng. Tài khoản ứng dụng hiện có không có CREATEDB; đã giữ nguyên quyền đó. Wrapper tạo `mg_test_<uuid>` cho từng lần chạy và xóa đúng database đã tạo. Dữ liệu ứng dụng không được dùng. Cài đặt Python cần truy cập package registry; sau khi sandbox từ chối kết nối, lần cài có quyền mạng đã hoàn tất trong virtualenv bản sao, không đổi `.venv`/`.env` ứng dụng.

Warnings không bị che: SQLite/Alembic không reflection được expression index, PyJWT cảnh báo trong ca cố ý ký sai thuật toán, Metro cảnh báo tài nguyên CSS Leaflet, npm báo ESLint 9 đã hết hỗ trợ và ba install script chưa được allowScripts cho tool build tùy chọn. Typecheck/lint/test/Web/native export vẫn đạt. Nâng major ESLint/toolchain không được đưa vào đợt sửa chức năng này.

## 6. Ma trận yêu cầu → triển khai → kiểm thử

| Yêu cầu | Phần triển khai | Kiểm chứng / giới hạn |
| --- | --- | --- |
| R01 — Bản giao đủ nguồn | Auth hiện có, css.d.ts, source manifest, constraints/lockfile | Cài mới, typecheck/lint/221 test/Web/native export trong bản sao |
| R02 — Auth/RBAC | AppContext, AuthScreen, dependencies, routers | API + Chrome register/login/restore/logout; user nhận 403 Admin |
| R03 — Email/race | schemas/service/email_policy/migration 0006 | API legacy/profile/Admin; DB unique; hai connection cạnh tranh; duplicate preflight giữ nguyên dữ liệu |
| R04 — Draft/public | Admin editor/save_journey, journey_values | API list/detail không lộ; Chrome draft → publish → route |
| R05 — URL/hủy | JourneyContext, useMapDiscovery, parseJourneyId | reload, ID sai/404/rỗng, điều hướng trong SPA và phản hồi cũ |
| R06 — Bản đồ | MapScreen web/native, JourneyPanel | Chrome marker số/lựa chọn, không query OSM/Wikipedia; native chỉ export |
| R07–R09 — GPS/TTS/tiến độ | journeyAutoDecision, player, progress card | Logic + Chrome fixture: near/far/return/denial, đúng ngôn ngữ, done/error/cancel, không replay; chưa loa/GPS thật |
| R10 — N+1/lỗi | journey_values theo trang, parseJourney | 20 tuyến đúng 2 SELECT; bỏ stop lỗi giữ phần còn lại; mạng/quyền vẫn báo lỗi |
| R11–R12 — Ảnh/DOM | api timeout, ImageEditor, PlaceImage/UI đã có | 413/415/success/timeout/cancel/retry, duplicate ảnh, keyboard và không button lồng button |
| R13 — Session | login_throttle, RefreshSession, migration 0007 | 401/429/expiry, dummy hash, rotation CAS, logout/replay/race; access JWT còn hạn được ghi rõ |
| R14 — CI/tài liệu | Root workflow, README/docs, check_docs | Cấu hình local và links đạt; chưa GitHub Actions/Docker daemon/deploy |

## 7. Tệp thay đổi và bộ mã giao

[Inventory chi tiết](REPAIR_CHANGED_FILES.md) phân biệt tệp mới, tệp sửa, bộ auth bắt buộc và workflow cũ được giữ trong checkpoint. Nhóm thay đổi chính:

- Backend: email/schema/index/preflight; phiên refresh/throttle và migration 0006–0007; Admin draft và bulk journey serialization; kiểm thử race/API/migration; runner PostgreSQL/E2E, constraints và Docker context.
- Frontend: URL/context/progress, lọc route khỏi discovery, marker/lựa chọn và nội dung UI; timeout/hủy upload/logout server; regression logic/Chrome. Giữ toàn bộ thiết kế bộ auth và các sửa ảnh/GPS/TTS trước đó.
- Bàn giao: workflow root, README, PRD, testing/status/acceptance/inventory, công cụ tạo bộ mã và kiểm tra liên kết.

Không đưa vào gói nguồn: node_modules, virtualenv, cache, `.env` cá nhân, upload/backup, output build/test hoặc gói expo `.tgz`. Tệp fixture được lưu trong `tests/` và dữ liệu catalog thuộc app vẫn được giữ. Không có untrack hàng loạt hay viết lại lịch sử.

## 8. Chấm tham khảo và điều kiện bàn giao

Chỉ tính bằng chứng đã chạy, không tính mã CI chưa chạy thành một Actions run hoặc mock thành cảm biến/loa thật.

| Tiêu chí | Tối đa | Tham khảo | Căn cứ / điểm chưa có |
| --- | ---: | ---: | --- |
| Chức năng | 30 | 24 | Luồng API/hành trình/ngôn ngữ/GPS-TTS fixture đạt; thiếu thiết bị/provider live |
| Luồng sử dụng | 20 | 17 | Chrome register → route → manual/auto → progress → exit/logout; thiết bị thật chưa nghiệm thu |
| Phân quyền | 15 | 14 | RBAC thật, session/race/throttle được test; chưa audit bảo mật đầy đủ |
| Dữ liệu | 15 | 14 | Unique/rollback/draft/order/migration đạt trên DB thử; dữ liệu cũ/ảnh thật chưa duyệt |
| Ổn định | 10 | 8 | Cài/build sạch và suite đạt; Docker daemon/thiết bị chưa thử |
| Tài liệu và CI/CD | 10 | 6 | Tài liệu/links/cấu hình CI đã kiểm tra; không cộng điểm cho Actions/publish chưa chạy |
| **Tổng** | **100** | **83 — 8,3/10** | Không phải cam kết điểm giảng viên |

Sẵn sàng bàn giao mã nguồn và demo Web trên DB thử theo README, sau khi lần chạy cuối trong bản sao đạt. Chưa đủ bằng chứng tuyên bố hoàn tất nghiệm thu đa nền tảng. Trước nộp/demo thực cần: (1) sao lưu, kiểm tra email trùng và áp dụng migration vào DB được chủ sở hữu duyệt; (2) kiểm tra GPS/loa Android/iPhone theo checklist; (3) chạy Actions/Docker khi có runner/daemon; (4) Admin duyệt nội dung/ảnh và credential dịch vụ demo; (5) đưa đầy đủ mã vào đúng Git root và tự review/commit/push.

Nếu giảng viên bắt buộc phương án microservices với broker, database riêng/service và pipeline tạo file audio server, phần đó còn thiếu; điểm tham khảo trên chỉ áp dụng phạm vi sản phẩm/yêu cầu bàn giao đã xác nhận trong PRD, không coi monolith đã đạt microservices.

Nguồn kỹ thuật đã đối chiếu: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [Actions setup-node](https://github.com/actions/setup-node), [setup-python](https://github.com/actions/setup-python), [Playwright CI](https://playwright.dev/docs/ci-intro). Các nguồn này hỗ trợ cấu hình; không phải bằng chứng test dự án đã chạy.
