# Tệp thay đổi và đưa vào Git

Đối chiếu với checkpoint trước sửa ngày 29/10/2026. Workspace C không có `.git`; các mục dưới đây là thay đổi nội dung so với checkpoint, không phải kết quả `git status` của HEAD.

## Tệp mới (21)

- [Workflow ở root kho](https://github.com/mlongzz/sgu_CongNghePhanMem/blob/main/.github/workflows/ci.yml)
- [README.md](../README.md)
- [backend/alembic/versions/0006_email_uniqueness.py](../backend/alembic/versions/0006_email_uniqueness.py)
- [backend/alembic/versions/0007_auth_sessions.py](../backend/alembic/versions/0007_auth_sessions.py)
- [backend/app/email_policy.py](../backend/app/email_policy.py)
- [backend/app/models/auth_session.py](../backend/app/models/auth_session.py)
- [backend/app/services/login_throttle.py](../backend/app/services/login_throttle.py)
- [backend/constraints.txt](../backend/constraints.txt)
- [backend/scripts/check_email_duplicates.py](../backend/scripts/check_email_duplicates.py)
- [backend/scripts/verify_postgres.py](../backend/scripts/verify_postgres.py)
- [backend/tests/test_acceptance_repairs.py](../backend/tests/test_acceptance_repairs.py)
- [backend/tests/test_auth_concurrency.py](../backend/tests/test_auth_concurrency.py)
- [docs/IMPLEMENTATION_STATUS.md](../docs/IMPLEMENTATION_STATUS.md)
- [docs/PRD.md](../docs/PRD.md)
- [docs/REPAIR_ACCEPTANCE_REPORT.md](../docs/REPAIR_ACCEPTANCE_REPORT.md)
- [docs/TESTING_GUIDE.md](../docs/TESTING_GUIDE.md)
- [multilingual-guide/src/components/JourneyPanel.tsx](../multilingual-guide/src/components/JourneyPanel.tsx)
- [multilingual-guide/src/types/css.d.ts](../multilingual-guide/src/types/css.d.ts)
- [multilingual-guide/tests/e2e/acceptance.spec.ts](../multilingual-guide/tests/e2e/acceptance.spec.ts)
- [scripts/check_docs.py](../scripts/check_docs.py)
- [scripts/prepare_handoff.py](../scripts/prepare_handoff.py)

## Tệp đã sửa (40)

- [.gitignore](../.gitignore)
- [backend/.dockerignore](../backend/.dockerignore)
- [backend/.env.example](../backend/.env.example)
- [backend/DEPLOYMENT.md](../backend/DEPLOYMENT.md)
- [backend/Dockerfile](../backend/Dockerfile)
- [backend/alembic/env.py](../backend/alembic/env.py)
- [backend/app/models/user.py](../backend/app/models/user.py)
- [backend/app/routers/admin.py](../backend/app/routers/admin.py)
- [backend/app/routers/auth.py](../backend/app/routers/auth.py)
- [backend/app/routers/journeys.py](../backend/app/routers/journeys.py)
- [backend/app/routers/users.py](../backend/app/routers/users.py)
- [backend/app/schemas/user.py](../backend/app/schemas/user.py)
- [backend/app/services/user_service.py](../backend/app/services/user_service.py)
- [backend/requirements.txt](../backend/requirements.txt)
- [backend/tests/e2e_server.py](../backend/tests/e2e_server.py)
- [backend/tests/test_journey_workflow.py](../backend/tests/test_journey_workflow.py)
- [backend/tests/test_migrations.py](../backend/tests/test_migrations.py)
- [multilingual-guide/.gitignore](../multilingual-guide/.gitignore)
- [multilingual-guide/AUTH_HANDOFF.md](../multilingual-guide/AUTH_HANDOFF.md)
- [multilingual-guide/README.md](../multilingual-guide/README.md)
- [multilingual-guide/app/journeys.tsx](../multilingual-guide/app/journeys.tsx)
- [multilingual-guide/scripts/run-e2e.cjs](../multilingual-guide/scripts/run-e2e.cjs)
- [multilingual-guide/src/admin/JourneyStopsEditor.tsx](../multilingual-guide/src/admin/JourneyStopsEditor.tsx)
- [multilingual-guide/src/admin/PlaceImageEditor.tsx](../multilingual-guide/src/admin/PlaceImageEditor.tsx)
- [multilingual-guide/src/components/AutoGuideControl.tsx](../multilingual-guide/src/components/AutoGuideControl.tsx)
- [multilingual-guide/src/components/JourneyProgressCard.tsx](../multilingual-guide/src/components/JourneyProgressCard.tsx)
- [multilingual-guide/src/components/MapDiscoveryPanel.tsx](../multilingual-guide/src/components/MapDiscoveryPanel.tsx)
- [multilingual-guide/src/components/MapScreen.tsx](../multilingual-guide/src/components/MapScreen.tsx)
- [multilingual-guide/src/components/MapScreen.web.tsx](../multilingual-guide/src/components/MapScreen.web.tsx)
- [multilingual-guide/src/components/auth/AuthScreen.tsx](../multilingual-guide/src/components/auth/AuthScreen.tsx)
- [multilingual-guide/src/context/AppContext.tsx](../multilingual-guide/src/context/AppContext.tsx)
- [multilingual-guide/src/context/JourneyContext.tsx](../multilingual-guide/src/context/JourneyContext.tsx)
- [multilingual-guide/src/hooks/useMapDiscovery.ts](../multilingual-guide/src/hooks/useMapDiscovery.ts)
- [multilingual-guide/src/services/api.ts](../multilingual-guide/src/services/api.ts)
- [multilingual-guide/src/services/journey.ts](../multilingual-guide/src/services/journey.ts)
- [multilingual-guide/src/services/journeyI18n.ts](../multilingual-guide/src/services/journeyI18n.ts)
- [multilingual-guide/tests/api-cancellation.test.cjs](../multilingual-guide/tests/api-cancellation.test.cjs)
- [multilingual-guide/tests/e2e/narration.spec.ts](../multilingual-guide/tests/e2e/narration.spec.ts)
- [multilingual-guide/tests/journey.test.cjs](../multilingual-guide/tests/journey.test.cjs)
- [multilingual-guide/tests/jsx-render.test.cjs](../multilingual-guide/tests/jsx-render.test.cjs)

## Bộ auth bắt buộc trong bản Git nhận bàn giao

Bản C có đủ 7 tệp; giữ lại thiết kế và chức năng đang có. Bản Git ở E không theo dõi các tệp auth và thư mục auth không có trên bản E. Không có quy tắc ignore áp dụng trong phép `git check-ignore` đã chạy; không đủ dữ liệu để kết luận tại sao main lịch sử bỏ sót. Khi đưa bản C vào Git, kiểm tra đủ các tệp sau:

- [AuthLayout.tsx](../multilingual-guide/src/components/auth/AuthLayout.tsx)
- [AuthScreen.tsx](../multilingual-guide/src/components/auth/AuthScreen.tsx)
- [AuthTextField.tsx](../multilingual-guide/src/components/auth/AuthTextField.tsx)
- [index.ts](../multilingual-guide/src/components/auth/index.ts)
- [LanguageSelector.tsx](../multilingual-guide/src/components/auth/LanguageSelector.tsx)
- [PasswordStrength.tsx](../multilingual-guide/src/components/auth/PasswordStrength.tsx)
- [PrimaryButton.tsx](../multilingual-guide/src/components/auth/PrimaryButton.tsx)

6/7 tệp auth giữ nguyên byte so với checkpoint; AuthScreen chỉ bổ sung thông báo khi logout không thu hồi được phiên máy chủ. `src/types/css.d.ts` và lockfile cũng phải có trong bộ mã.

## Workflow cũ và artifact

Workflow con `multilingual-guide/.github/workflows/frontend-ci.yml` được chuyển vào `.checkpoints/2026-10-29-before-acceptance/obsolete-workflows/frontend-ci.yml`, giữ bản trên ổ đĩa. Workflow chính ở root `.github/workflows/ci.yml`.

Đã ignore `.test-artifacts/`, gói `*.tgz`, cache và output. Không xóa `.test-artifacts` hoặc `expo-57.0.24.tgz` trên ổ đĩa. Không thực hiện untrack vì C không có Git; với repo khác, cần xem lại index trước khi bỏ theo dõi output. Không tự commit/push/tag/publish.
